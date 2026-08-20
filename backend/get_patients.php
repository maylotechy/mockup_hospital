<?php
// ========================================================
// API Endpoint: Get Facility Patient(s)
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();

if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in to view patient records.'
    ], 401);
}

$facilityId = (int)$loggedInUser['facility']['id'];

$patientColumns = '
    p.id, p.facility_id, f.name as facility_name,
    p.first_name, p.middle_name, p.last_name, p.suffix,
    p.dob, p.gender, p.civil_status, p.phone,
    p.region, p.province, p.city_municipality, p.barangay, p.zip_code,
    p.philhealth_member, p.philhealth_number, p.philhealth_status_type, p.is_4ps_member,
    p.created_by_user_id, p.created_at, p.updated_at
';

try {
    $pdo = getDbConnection();

    if (isset($_GET['id']) && $_GET['id'] !== '') {
        $patientId = (int)$_GET['id'];
        $stmt = $pdo->prepare("
            SELECT {$patientColumns}
            FROM patients p
            JOIN facilities f ON p.facility_id = f.id
            WHERE p.id = :id AND p.facility_id = :facility_id
        ");
        $stmt->execute([':id' => $patientId, ':facility_id' => $facilityId]);
        $patient = $stmt->fetch();

        if ($patient) {
            sendJsonResponse([
                'success' => true,
                'data' => $patient
            ]);
        } else {
            sendJsonResponse([
                'success' => false,
                'message' => "Patient with ID {$patientId} not found in facility registry."
            ], 404);
        }
    } else {
        $stmt = $pdo->prepare("
            SELECT {$patientColumns}
            FROM patients p
            JOIN facilities f ON p.facility_id = f.id
            WHERE p.facility_id = :facility_id
            ORDER BY p.id ASC
        ");
        $stmt->execute([':facility_id' => $facilityId]);
        $patients = $stmt->fetchAll();

        sendJsonResponse([
            'success' => true,
            'facility' => $loggedInUser['facility'],
            'data' => $patients
        ]);
    }
} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while fetching patients: ' . $e->getMessage()
    ], 500);
}
