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
    p.philhealth_member, p.philhealth_number, p.philhealth_status_type, p.philsys_id, p.is_4ps_member,
    p.source_referral_id, p.transferred_details_snapshot,
    p.created_by_user_id, p.created_at, p.updated_at,
    nok.name as next_of_kin_name, nok.relationship as next_of_kin_relationship, nok.phone as next_of_kin_phone
';
// Each patient has at most one next-of-kin contact today (Add Patient only
// collects one) -- LEFT JOIN keyed to the most recently added row is safe as
// long as that stays true; a real one-to-many UI would need GROUP_CONCAT instead.
$patientJoins = '
    LEFT JOIN (
        SELECT pc1.* FROM patient_contacts pc1
        INNER JOIN (SELECT patient_id, MAX(id) as max_id FROM patient_contacts GROUP BY patient_id) pc2
            ON pc1.patient_id = pc2.patient_id AND pc1.id = pc2.max_id
    ) nok ON nok.patient_id = p.id
';

/**
 * Flattens the transferred-in patient's departure state out of its JSON snapshot
 * (referral_id, departed_at, departure_outcome, departure_remarks) so the Patient
 * Records table can decide whether to show "Mark as Out" without sending the whole
 * snapshot blob down for every row. $referredOnwardIds marks patients this facility
 * has already sent a referral for -- shown as "Referred Onward" instead of offering
 * a discharge action that would contradict it.
 */
function enrichPatientTransferFields($row, $referredOnwardIds = []) {
    $row['is_transferred_in'] = !empty($row['source_referral_id']);
    $row['departed_at'] = null;
    $row['departure_outcome'] = null;
    $row['departure_remarks'] = null;

    if (!empty($row['transferred_details_snapshot'])) {
        $snapshot = json_decode($row['transferred_details_snapshot'], true);
        if (is_array($snapshot)) {
            $row['departed_at'] = $snapshot['departed_at'] ?? null;
            $row['departure_outcome'] = $snapshot['departure_outcome'] ?? null;
            $row['departure_remarks'] = $snapshot['departure_remarks'] ?? null;
        }
    }

    $row['already_referred_onward'] = in_array((int)$row['id'], $referredOnwardIds, true);

    unset($row['transferred_details_snapshot']);
    return $row;
}

try {
    $pdo = getDbConnection();

    $referredOnwardStmt = $pdo->prepare('SELECT DISTINCT patient_id FROM initiated_referrals WHERE hospital_id = :fid AND sync_status = "SENT"');
    $referredOnwardStmt->execute([':fid' => $facilityId]);
    $referredOnwardIds = array_map('intval', array_column($referredOnwardStmt->fetchAll(), 'patient_id'));

    if (isset($_GET['id']) && $_GET['id'] !== '') {
        $patientId = (int)$_GET['id'];
        $stmt = $pdo->prepare("
            SELECT {$patientColumns}
            FROM patients p
            JOIN facilities f ON p.facility_id = f.id
            {$patientJoins}
            WHERE p.id = :id AND p.facility_id = :facility_id
        ");
        $stmt->execute([':id' => $patientId, ':facility_id' => $facilityId]);
        $patient = $stmt->fetch();

        if ($patient) {
            sendJsonResponse([
                'success' => true,
                'data' => enrichPatientTransferFields($patient, $referredOnwardIds)
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
            {$patientJoins}
            WHERE p.facility_id = :facility_id
            ORDER BY p.id ASC
        ");
        $stmt->execute([':facility_id' => $facilityId]);
        $patients = array_map(fn($p) => enrichPatientTransferFields($p, $referredOnwardIds), $stmt->fetchAll());

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
