<?php
// ========================================================
// API Endpoint: Staff Login & Session Status
// ========================================================

require_once __DIR__ . '/config.php';

/**
 * Maps IOL's free-text facility_type (Postgres data is inconsistent -- e.g.
 * both 'Level 3' and 'Level 3 Hospital' exist) onto MySQL's strict tier_level
 * ENUM ('BHS', 'RHU', 'Level 1 Hospital', 'Level 2 Hospital', 'Level 3 Hospital').
 * Returns null for empty/unrecognized input so callers can fall back safely
 * instead of writing a value that violates the column's ENUM constraint.
 */
function normalizeTierLevel($rawType) {
    if (empty($rawType)) return null;
    $t = strtoupper(trim($rawType));
    if (strpos($t, 'BHS') !== false || strpos($t, 'BARANGAY') !== false) return 'BHS';
    if (strpos($t, 'RHU') !== false || strpos($t, 'RURAL') !== false) return 'RHU';
    if (strpos($t, '3') !== false) return 'Level 3 Hospital';
    if (strpos($t, '2') !== false) return 'Level 2 Hospital';
    if (strpos($t, '1') !== false) return 'Level 1 Hospital';
    return null;
}

/**
 * Builds the {user, facility} response shape shared by the GET session-check
 * and POST login success responses.
 */
function buildAuthResponsePayload($user) {
    return [
        'user' => [
            'id'        => $user['id'],
            'username'  => $user['username'],
            'full_name' => $user['full_name'],
            'role'      => $user['role'],
            'license_number' => $user['license_number'] ?? null
        ],
        'facility' => $user['facility']
    ];
}

// Check session status via GET
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $user = getLoggedInUser();
    if ($user) {
        // Older active sessions may predate license-number support. Refresh the
        // clinical user's value so the printable form works without a logout/login.
        if (!array_key_exists('license_number', $user) && !empty($user['id'])
            && in_array(strtolower((string)($user['role'] ?? '')), ['doctor', 'nurse'], true)) {
            try {
                $licensePdo = getDbConnection();
                $licenseStmt = $licensePdo->prepare('SELECT license_number FROM users WHERE id = :id LIMIT 1');
                $licenseStmt->execute([':id' => (int)$user['id']]);
                $licenseRow = $licenseStmt->fetch();
                $user['license_number'] = $licenseRow['license_number'] ?? null;
                $_SESSION['user']['license_number'] = $user['license_number'];
            } catch (Exception $e) {
                $user['license_number'] = null;
            }
        }
        sendJsonResponse(array_merge([
            'authenticated' => true
        ], buildAuthResponsePayload($user)));
    } else {
        sendJsonResponse([
            'authenticated' => false,
            'user' => null,
            'facility' => null
        ]);
    }
}

// Only accept POST for login execution
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse([
        'success' => false,
        'message' => 'Invalid request method.'
    ], 405);
}

// Extract POST inputs (support both form and raw JSON body)
$input = $_POST;
$rawInput = file_get_contents('php://input');
if (empty($input) && !empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}

$username = isset($input['username']) ? trim((string)$input['username']) : '';
$password = isset($input['password']) ? trim((string)$input['password']) : '';

if (empty($username) || empty($password)) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Please provide both username and password.'
    ], 400);
}

try {
    $pdo = getDbConnection();

    // 1. Try local MySQL users lookup first (for Doctors and Nurses)
    // Facility Admins authenticate centrally via IRDSS (IOL PostgreSQL)
    $stmt = $pdo->prepare('
        SELECT u.id, u.username, u.password, u.full_name, u.role, u.license_number, u.is_active,
               f.id as facility_id, f.code as facility_code, f.name as facility_name,
               f.tier_level, f.is_assessment_completed, f.api_key
        FROM users u
        JOIN facilities f ON u.facility_id = f.id
        WHERE u.username = :username AND LOWER(u.role) != "facility_admin"
        LIMIT 1
    ');
    $stmt->execute([':username' => $username]);
    $row = $stmt->fetch();

    if ($row && password_verify($password, $row['password'])) {

        if (!$row['is_active']) {
            sendJsonResponse([
                'success' => false,
                'message' => 'This account has been deactivated. Please contact your facility administrator.'
            ], 403);
        }

        // Save session for local user (Doctor/Nurse)
        $_SESSION['user'] = [
            'id'        => (int)$row['id'],
            'username'  => $row['username'],
            'full_name' => $row['full_name'],
            'role'      => $row['role'],
            'license_number' => $row['license_number'],
            'facility'  => [
                'id'                      => (int)$row['facility_id'],
                'code'                    => $row['facility_code'],
                'name'                    => $row['facility_name'],
                'tier_level'              => $row['tier_level'],
                'is_assessment_completed' => (bool)$row['is_assessment_completed'],
                'api_key'                 => $row['api_key']
            ]
        ];

        sendJsonResponse(array_merge([
            'success' => true,
            'message' => "Welcome back, {$row['full_name']}!"
        ], buildAuthResponsePayload($_SESSION['user'])));
    }

    // 2. If local lookup fails, delegate authentication to central IRDSS (IOL)
    $ch = curl_init(IOL_AUTH_LOGIN_URL);
    $payloadJson = json_encode(['username' => $username, 'password' => $password]);

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payloadJson,
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_CONNECTTIMEOUT => 3
    ]);

    $responseJson = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && !empty($responseJson)) {
        $iolData = json_decode($responseJson, true);
        if (is_array($iolData) && !empty($iolData['facility_name'])) {
            $iolFacilityName = trim($iolData['facility_name']);
            $iolFacilityCode = $iolData['facility_code'] ?? null;

            // 1. Try local facility lookup by name
            $facStmt = $pdo->prepare('
                SELECT id, code, name, tier_level, is_assessment_completed, api_key
                FROM facilities
                WHERE LOWER(name) = LOWER(:name)
                LIMIT 1
            ');
            $facStmt->execute([':name' => $iolFacilityName]);
            $facRow = $facStmt->fetch();

            // 2. Try code lookup if name match fails
            if (!$facRow && $iolFacilityCode) {
                $facStmtCode = $pdo->prepare('
                    SELECT id, code, name, tier_level, is_assessment_completed, api_key
                    FROM facilities
                    WHERE LOWER(code) = LOWER(:code)
                    LIMIT 1
                ');
                $facStmtCode->execute([':code' => $iolFacilityCode]);
                $facRow = $facStmtCode->fetch();
            }

            // 3. Facility already exists locally -- refresh its cached tier_level from
            // IOL's live value so a level change made in the central admin panel takes
            // effect on the facility_admin's very next login, instead of staying stuck
            // at whatever was captured the first time this facility ever logged in.
            if ($facRow) {
                $freshTier = normalizeTierLevel($iolData['facility_type'] ?? null);
                if ($freshTier !== null && $freshTier !== $facRow['tier_level']) {
                    $updTierStmt = $pdo->prepare('UPDATE facilities SET tier_level = :tier WHERE id = :id');
                    $updTierStmt->execute([':tier' => $freshTier, ':id' => $facRow['id']]);
                    $facRow['tier_level'] = $freshTier;
                }
            }

            // 4. Auto-provision facility in local MySQL if missing
            if (!$facRow) {
                $facCode = $iolFacilityCode ? $iolFacilityCode : ('FAC-' . str_pad((string)($iolData['facility_id'] ?? rand(100, 999)), 6, '0', STR_PAD_LEFT));
                $facTier = normalizeTierLevel($iolData['facility_type'] ?? null) ?? 'Level 1 Hospital';
                $facApiKey = 'irdss_api_key_' . strtolower(preg_replace('/[^a-zA-Z0-9]/', '', $iolFacilityName));

                try {
                    $insStmt = $pdo->prepare('
                        INSERT INTO facilities (code, name, tier_level, is_assessment_completed, api_key)
                        VALUES (:code, :name, :tier, FALSE, :api_key)
                    ');
                    $insStmt->execute([
                        ':code' => $facCode,
                        ':name' => $iolFacilityName,
                        ':tier' => $facTier,
                        ':api_key' => $facApiKey
                    ]);
                    $newFacId = $pdo->lastInsertId();

                    $facRow = [
                        'id'                      => (int)$newFacId,
                        'code'                    => $facCode,
                        'name'                    => $iolFacilityName,
                        'tier_level'              => $facTier,
                        'is_assessment_completed' => false,
                        'api_key'                 => $facApiKey
                    ];
                } catch (Exception $e) {
                    // Fallback in-memory facility shape if MySQL insert fails
                    $facRow = [
                        'id'                      => (int)($iolData['facility_id'] ?? 1),
                        'code'                    => $facCode,
                        'name'                    => $iolFacilityName,
                        'tier_level'              => $facTier,
                        'is_assessment_completed' => false,
                        'api_key'                 => $facApiKey
                    ];
                }
            }

            $userRole = strtolower($iolData['role'] ?? 'facility_admin');

            // Resolve this facility_admin's own local users.id (not the central facility_id --
            // reusing that here would collide with unrelated local users.id values across
            // facilities and break "is this me" checks like the Manage Users staff list).
            $localAdminId = null;
            $localAdminStmt = $pdo->prepare('
                SELECT id FROM users WHERE username = :username AND facility_id = :facility_id LIMIT 1
            ');
            $localAdminStmt->execute([':username' => $username, ':facility_id' => $facRow['id']]);
            $localAdminRow = $localAdminStmt->fetch();
            if ($localAdminRow) {
                $localAdminId = (int)$localAdminRow['id'];
            }

            $_SESSION['user'] = [
                'id'           => $localAdminId ?? (int)($iolData['facility_id'] ?? 9000),
                'username'     => $username,
                'full_name'    => $iolFacilityName . ' Admin',
                'role'         => $userRole,
                'access_token' => $iolData['access_token'] ?? null,
                'facility'     => [
                    'id'                      => (int)$facRow['id'],
                    'code'                    => $facRow['code'],
                    'name'                    => $facRow['name'],
                    'tier_level'              => $facRow['tier_level'],
                    'is_assessment_completed' => (bool)$facRow['is_assessment_completed'],
                    'api_key'                 => $facRow['api_key']
                ]
            ];

            sendJsonResponse(array_merge([
                'success' => true,
                'message' => "Welcome back, {$iolFacilityName} Admin!"
            ], buildAuthResponsePayload($_SESSION['user'])));
        }
    }

    // Extract exact detail from IRDSS response if available
    $errMsg = 'Invalid username or password.';
    if (!empty($responseJson)) {
        $parsed = json_decode($responseJson, true);
        if (is_array($parsed) && !empty($parsed['detail'])) {
            $errMsg = $parsed['detail'];
        }
    }

    sendJsonResponse([
        'success' => false,
        'message' => $errMsg
    ], ($httpCode >= 400 && $httpCode < 600) ? $httpCode : 401);


} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Login error: ' . $e->getMessage()
    ], 500);
}
