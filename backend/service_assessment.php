<?php
// ========================================================
// API Endpoint: Facility Service Assessment (streamlined DOH HFP checklist)
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in.'
    ], 401);
}

$facilityId = (int)$loggedInUser['facility']['id'];
$method = $_SERVER['REQUEST_METHOD'];
$pdo = getDbConnection();

$boolFields = [
    'has_icu', 'has_nicu', 'has_er_trauma', 'has_delivery_room', 'has_hemodialysis',
    'has_blood_bank', 'has_ct_mri', 'has_cardiologist', 'has_obgyn', 'has_neurologist', 'has_general_surgeon'
];

try {
    if ($method === 'GET') {
        $stmt = $pdo->prepare('SELECT * FROM service_assessments WHERE facility_id = :facility_id LIMIT 1');
        $stmt->execute([':facility_id' => $facilityId]);
        $assessment = $stmt->fetch();

        sendJsonResponse([
            'success' => true,
            'is_assessment_completed' => (bool)$loggedInUser['facility']['is_assessment_completed'],
            'data' => $assessment ?: null
        ]);
    }

    if ($method === 'POST' || $method === 'PUT') {
        requireRole(['facility_admin']);

        $input = $_POST;
        $rawInput = file_get_contents('php://input');
        if (empty($input) && !empty($rawInput)) {
            $decoded = json_decode($rawInput, true);
            if (is_array($decoded)) {
                $input = $decoded;
            }
        }

        $authorizedBeds = isset($input['authorized_bed_capacity']) ? (int)$input['authorized_bed_capacity'] : 0;
        $functionalBeds = isset($input['functional_beds']) ? (int)$input['functional_beds'] : 0;

        if ($authorizedBeds < 0 || $functionalBeds < 0) {
            sendJsonResponse(['success' => false, 'message' => 'Bed counts cannot be negative.'], 400);
        }

        $boolValues = [];
        foreach ($boolFields as $field) {
            $boolValues[$field] = !empty($input[$field]) && $input[$field] !== 'false' && $input[$field] !== '0';
        }

        $pdo->beginTransaction();

        $columns = array_merge(['facility_id', 'authorized_bed_capacity', 'functional_beds'], $boolFields, ['submitted_by_user_id']);
        $placeholders = array_map(fn($c) => ":$c", $columns);
        $updateAssignments = array_map(fn($c) => "$c = VALUES($c)", array_diff($columns, ['facility_id']));

        $sql = 'INSERT INTO service_assessments (' . implode(', ', $columns) . ')
                VALUES (' . implode(', ', $placeholders) . ')
                ON DUPLICATE KEY UPDATE ' . implode(', ', $updateAssignments);

        $params = [
            ':facility_id' => $facilityId,
            ':authorized_bed_capacity' => $authorizedBeds,
            ':functional_beds' => $functionalBeds,
            ':submitted_by_user_id' => (int)$loggedInUser['id']
        ];
        foreach ($boolFields as $field) {
            $params[":$field"] = $boolValues[$field] ? 1 : 0;
        }

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        $facilityUpdateStmt = $pdo->prepare('UPDATE facilities SET is_assessment_completed = TRUE WHERE id = :id');
        $facilityUpdateStmt->execute([':id' => $facilityId]);

        $pdo->commit();

        // Keep the session's cached facility snapshot in sync
        $_SESSION['user']['facility']['is_assessment_completed'] = true;

        sendJsonResponse([
            'success' => true,
            'message' => 'Service assessment saved successfully.'
        ]);
    }

    sendJsonResponse(['success' => false, 'message' => 'Invalid request method.'], 405);

} catch (Exception $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while saving the service assessment: ' . $e->getMessage()
    ], 500);
}
