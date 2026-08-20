<?php
// ========================================================
// API Endpoint: Manage Facility Staff Users (Facility Admin only)
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in.'
    ], 401);
}

requireRole(['facility_admin']);

$facilityId = (int)$loggedInUser['facility']['id'];
$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDbConnection();

function readJsonBody() {
    $input = $_POST;
    $rawInput = file_get_contents('php://input');
    if (empty($input) && !empty($rawInput)) {
        $decoded = json_decode($rawInput, true);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    }
    return $input;
}

try {
    if ($method === 'GET') {
        $stmt = $pdo->prepare('
            SELECT id, username, full_name, role, license_number, trainings, is_active, created_at
            FROM users
            WHERE facility_id = :facility_id
            ORDER BY role, full_name
        ');
        $stmt->execute([':facility_id' => $facilityId]);
        sendJsonResponse([
            'success' => true,
            'data' => $stmt->fetchAll()
        ]);
    }

    if ($method === 'POST') {
        $input = readJsonBody();
        $username = isset($input['username']) ? trim((string)$input['username']) : '';
        $password = isset($input['password']) ? (string)$input['password'] : '';
        $fullName = isset($input['full_name']) ? trim((string)$input['full_name']) : '';
        $role = isset($input['role']) ? trim((string)$input['role']) : '';
        // Clinical credentials only apply to Doctor/Nurse -- ignored for Facility Admin
        $isClinicalRole = in_array($role, ['doctor', 'nurse'], true);
        $licenseNumber = ($isClinicalRole && !empty($input['license_number'])) ? trim((string)$input['license_number']) : null;
        $trainings = ($isClinicalRole && !empty($input['trainings'])) ? trim((string)$input['trainings']) : null;

        $errors = [];
        if (empty($username)) $errors[] = 'Username is required.';
        if (strlen($password) < 6) $errors[] = 'Password must be at least 6 characters.';
        if (empty($fullName)) $errors[] = 'Full name is required.';
        if (!in_array($role, ['facility_admin', 'doctor', 'nurse'], true)) $errors[] = 'Invalid role.';

        if (!empty($errors)) {
            sendJsonResponse(['success' => false, 'message' => implode(' ', $errors)], 400);
        }

        $checkStmt = $pdo->prepare('SELECT id FROM users WHERE username = :username LIMIT 1');
        $checkStmt->execute([':username' => $username]);
        if ($checkStmt->fetch()) {
            sendJsonResponse(['success' => false, 'message' => 'That username is already taken.'], 409);
        }

        $insertStmt = $pdo->prepare('
            INSERT INTO users (facility_id, username, password, full_name, role, license_number, trainings)
            VALUES (:facility_id, :username, :password, :full_name, :role, :license_number, :trainings)
        ');
        $insertStmt->execute([
            ':facility_id'     => $facilityId,
            ':username'        => $username,
            ':password'        => password_hash($password, PASSWORD_DEFAULT),
            ':full_name'       => $fullName,
            ':license_number'  => $licenseNumber,
            ':trainings'       => $trainings,
            ':role'        => $role
        ]);

        sendJsonResponse([
            'success' => true,
            'message' => 'User account created successfully.',
            'data' => ['id' => (int)$pdo->lastInsertId()]
        ]);
    }

    if ($method === 'PATCH' || $method === 'PUT') {
        $input = readJsonBody();
        $targetId = isset($input['id']) ? (int)$input['id'] : 0;
        $action = isset($input['action']) ? trim((string)$input['action']) : '';

        if ($targetId <= 0) {
            sendJsonResponse(['success' => false, 'message' => 'Missing user id.'], 400);
        }

        $targetStmt = $pdo->prepare('SELECT id, role, is_active FROM users WHERE id = :id AND facility_id = :facility_id LIMIT 1');
        $targetStmt->execute([':id' => $targetId, ':facility_id' => $facilityId]);
        $target = $targetStmt->fetch();

        if (!$target) {
            sendJsonResponse(['success' => false, 'message' => 'User not found in this facility.'], 404);
        }

        if ($action === 'toggle_active') {
            $nextActive = !((bool)$target['is_active']);

            if (!$nextActive && $target['role'] === 'facility_admin') {
                if ($targetId === (int)$loggedInUser['id']) {
                    sendJsonResponse(['success' => false, 'message' => 'You cannot deactivate your own account.'], 400);
                }
                $adminCountStmt = $pdo->prepare("
                    SELECT COUNT(*) as cnt FROM users
                    WHERE facility_id = :facility_id AND role = 'facility_admin' AND is_active = TRUE AND id != :id
                ");
                $adminCountStmt->execute([':facility_id' => $facilityId, ':id' => $targetId]);
                if ((int)$adminCountStmt->fetch()['cnt'] === 0) {
                    sendJsonResponse(['success' => false, 'message' => 'A facility must have at least one active admin.'], 400);
                }
            }

            $updateStmt = $pdo->prepare('UPDATE users SET is_active = :is_active WHERE id = :id AND facility_id = :facility_id');
            $updateStmt->execute([':is_active' => $nextActive, ':id' => $targetId, ':facility_id' => $facilityId]);

            sendJsonResponse(['success' => true, 'message' => $nextActive ? 'User activated.' : 'User deactivated.']);
        }

        if ($action === 'reset_password') {
            $newPassword = isset($input['new_password']) ? (string)$input['new_password'] : '';
            if (strlen($newPassword) < 6) {
                sendJsonResponse(['success' => false, 'message' => 'Password must be at least 6 characters.'], 400);
            }
            $updateStmt = $pdo->prepare('UPDATE users SET password = :password WHERE id = :id AND facility_id = :facility_id');
            $updateStmt->execute([
                ':password' => password_hash($newPassword, PASSWORD_DEFAULT),
                ':id' => $targetId,
                ':facility_id' => $facilityId
            ]);
            sendJsonResponse(['success' => true, 'message' => 'Password reset successfully.']);
        }

        sendJsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
    }

    if ($method === 'DELETE') {
        $targetId = isset($_GET['id']) ? (int)$_GET['id'] : 0;
        if ($targetId <= 0) {
            sendJsonResponse(['success' => false, 'message' => 'Missing user id.'], 400);
        }

        if ($targetId === (int)$loggedInUser['id']) {
            sendJsonResponse(['success' => false, 'message' => 'You cannot delete your own account.'], 400);
        }

        $targetStmt = $pdo->prepare('SELECT id, role FROM users WHERE id = :id AND facility_id = :facility_id LIMIT 1');
        $targetStmt->execute([':id' => $targetId, ':facility_id' => $facilityId]);
        $target = $targetStmt->fetch();

        if (!$target) {
            sendJsonResponse(['success' => false, 'message' => 'User not found in this facility.'], 404);
        }

        if ($target['role'] === 'facility_admin') {
            $adminCountStmt = $pdo->prepare("
                SELECT COUNT(*) as cnt FROM users
                WHERE facility_id = :facility_id AND role = 'facility_admin' AND is_active = TRUE AND id != :id
            ");
            $adminCountStmt->execute([':facility_id' => $facilityId, ':id' => $targetId]);
            if ((int)$adminCountStmt->fetch()['cnt'] === 0) {
                sendJsonResponse(['success' => false, 'message' => 'A facility must have at least one active admin.'], 400);
            }
        }

        $deleteStmt = $pdo->prepare('DELETE FROM users WHERE id = :id AND facility_id = :facility_id');
        $deleteStmt->execute([':id' => $targetId, ':facility_id' => $facilityId]);

        sendJsonResponse(['success' => true, 'message' => 'User removed successfully.']);
    }

    sendJsonResponse(['success' => false, 'message' => 'Invalid request method.'], 405);

} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while managing users: ' . $e->getMessage()
    ], 500);
}
