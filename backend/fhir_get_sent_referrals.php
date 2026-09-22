<?php
// ========================================================
// API Endpoint: List this facility's locally-recorded FHIR Connectathon test
// referral sends (see fhir_send_referral.php, which writes one row here per
// successful send). Local read only -- does not contact the sandbox. Fully
// separate from the IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
// ========================================================

require_once __DIR__ . '/config.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$facilityId = (int)($user['facility']['id'] ?? 0);
if ($facilityId <= 0) {
    sendJsonResponse(['success' => false, 'message' => 'Could not determine your facility from your session.'], 400);
}

$pdo = getDbConnection();
$stmt = $pdo->prepare('
    SELECT id, patient_name, service_request_ref, receiving_org_ref, receiving_org_name,
           referral_category, service_type, reason_text, http_status, created_at
    FROM fhir_sent_referrals
    WHERE facility_id = :facility_id
    ORDER BY created_at DESC
    LIMIT 100
');
$stmt->execute([':facility_id' => $facilityId]);

sendJsonResponse([
    'success' => true,
    'referrals' => $stmt->fetchAll(),
]);
