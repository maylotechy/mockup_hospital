<?php
// ========================================================
// API Endpoint: List Source Referral IDs Already Referred Onward
// ========================================================
//
// Used by the Incoming Patients list to hide "Mark as Out" for a transferred-in
// patient who's already been referred onward through the system -- the same
// contradiction guard already enforced server-side by mark_patient_departed.php,
// surfaced here so the button doesn't show in the first place.

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in.'
    ], 401);
}

$facilityId = (int)($loggedInUser['facility']['id'] ?? 0);

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('
        SELECT DISTINCT p.source_referral_id
        FROM patients p
        JOIN initiated_referrals ir ON ir.patient_id = p.id AND ir.hospital_id = p.facility_id
        WHERE p.facility_id = :fid AND p.source_referral_id IS NOT NULL AND ir.sync_status = "SENT"
    ');
    $stmt->execute([':fid' => $facilityId]);

    sendJsonResponse([
        'success' => true,
        'data' => array_column($stmt->fetchAll(), 'source_referral_id')
    ]);
} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred: ' . $e->getMessage()
    ], 500);
}
