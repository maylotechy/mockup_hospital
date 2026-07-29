<?php
// ========================================================
// API Endpoint: Get Hospital Patient(s)
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInHospital = getLoggedInHospital();

if ($loggedInHospital) {
    $hospitalId = (int)$loggedInHospital['id'];
} elseif (isset($_GET['hospital_id']) && $_GET['hospital_id'] !== '') {
    $hospitalId = (int)$_GET['hospital_id'];
} else {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in to view hospital patient records.'
    ], 401);
}

try {
    $pdo = getDbConnection();

    if (isset($_GET['id']) && $_GET['id'] !== '') {
        $patientId = (int)$_GET['id'];
        $stmt = $pdo->prepare('
            SELECT p.id, p.hospital_id, h.name as hospital_name, p.first_name, p.last_name, p.dob, p.gender, p.phone, p.created_at 
            FROM patients p
            JOIN hospitals h ON p.hospital_id = h.id
            WHERE p.id = :id AND p.hospital_id = :hospital_id
        ');
        $stmt->execute([':id' => $patientId, ':hospital_id' => $hospitalId]);
        $patient = $stmt->fetch();

        if ($patient) {
            sendJsonResponse([
                'success' => true,
                'data' => $patient
            ]);
        } else {
            sendJsonResponse([
                'success' => false,
                'message' => "Patient with ID {$patientId} not found in hospital registry."
            ], 404);
        }
    } else {
        $stmt = $pdo->prepare('
            SELECT p.id, p.hospital_id, h.name as hospital_name, p.first_name, p.last_name, p.dob, p.gender, p.phone, p.created_at 
            FROM patients p
            JOIN hospitals h ON p.hospital_id = h.id
            WHERE p.hospital_id = :hospital_id
            ORDER BY p.id ASC
        ');
        $stmt->execute([':hospital_id' => $hospitalId]);
        $patients = $stmt->fetchAll();

        sendJsonResponse([
            'success' => true,
            'hospital' => $loggedInHospital,
            'data' => $patients
        ]);
    }
} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while fetching patients: ' . $e->getMessage()
    ], 500);
}
