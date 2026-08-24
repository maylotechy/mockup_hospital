<?php
// ========================================================
// API Endpoint: Mark Transferred-In Patient as Departed (Discharged/Transferred/etc.)
// Route: Backend proxy for PATCH /api/v1/referral/{id}/depart
// ========================================================

require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    sendJsonResponse([
        'success' => false,
        'message' => 'Invalid request method. Only PATCH is allowed.'
    ], 405);
}

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please log in again.'
    ], 401);
}

$input = $_POST;
$rawInput = file_get_contents('php://input');
if (empty($input) && !empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}

$referralId = isset($input['referral_id']) ? trim((string)$input['referral_id']) : '';
$outcome = isset($input['outcome']) ? trim((string)$input['outcome']) : '';
$remarks = isset($input['remarks']) ? trim((string)$input['remarks']) : '';

$validOutcomes = ['DISCHARGED', 'TRANSFERRED', 'DECEASED', 'LEFT_AMA'];
if (empty($referralId) || !in_array(strtoupper($outcome), $validOutcomes, true)) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Missing or invalid required fields: referral_id, outcome.'
    ], 400);
}

$pdo = getDbConnection();
$facilityId = (int)($loggedInUser['facility']['id'] ?? 0);

$localPatientStmt = $pdo->prepare('SELECT id, transferred_details_snapshot FROM patients WHERE source_referral_id = :rid AND facility_id = :fid LIMIT 1');
$localPatientStmt->execute([':rid' => $referralId, ':fid' => $facilityId]);
$localPatientRow = $localPatientStmt->fetch();

// Refuse to record a discharge/departure for a patient who's already been referred
// onward through the system -- the two facts would contradict each other on the
// original referring hospital's tracker (can't be both "sent home" and "sent
// elsewhere" for the same episode).
if ($localPatientRow && hasPatientBeenReferredOnward($pdo, $facilityId, (int)$localPatientRow['id'])) {
    sendJsonResponse([
        'success' => false,
        'message' => 'This patient has already been referred to another facility. Departure status cannot be recorded separately.'
    ], 409);
}

$payload = ['outcome' => strtoupper($outcome)];
if ($remarks !== '') {
    $payload['remarks'] = $remarks;
}
$payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES);

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'PATCH',
    "/api/v1/referral/{$referralId}/depart",
    $payloadJson,
    $loggedInUser['facility']['code'],
    $loggedInUser['facility']['name']
);

if ($curlErrno) {
    sendJsonResponse([
        'success' => false,
        'message' => $httpCode === 0 ? 'RSA signing failed on the server.' : 'Failed to reach IOL server.'
    ], $httpCode === 0 ? 500 : 503);
}

$isSuccess = ($httpCode >= 200 && $httpCode < 300);

// Mirror the departure onto the local snapshot too, so Patient Records (where this
// patient actually lives day-to-day, unlike the one-time Incoming Patients list) can
// show the current "Mark as Out" state without a fresh round-trip to IOL every time.
if ($isSuccess && $localPatientRow) {
    try {
        $snapshot = !empty($localPatientRow['transferred_details_snapshot']) ? json_decode($localPatientRow['transferred_details_snapshot'], true) : [];
        if (!is_array($snapshot)) {
            $snapshot = [];
        }
        $snapshot['departed_at'] = $response['departed_at'] ?? date('c');
        $snapshot['departure_outcome'] = strtoupper($outcome);
        $snapshot['departure_remarks'] = $remarks !== '' ? $remarks : null;

        $updStmt = $pdo->prepare('UPDATE patients SET transferred_details_snapshot = :snapshot WHERE id = :id');
        $updStmt->execute([':snapshot' => json_encode($snapshot), ':id' => $localPatientRow['id']]);
    } catch (Exception $e) {
        // Best-effort local mirror -- the authoritative record already succeeded at IOL above
    }
}

sendJsonResponse([
    'success' => $isSuccess,
    'http_status' => $httpCode,
    'message' => $isSuccess ? 'Patient departure recorded.' : ($response['detail'] ?? 'Failed to record patient departure.'),
    'iol_response' => $response
], $isSuccess ? 200 : $httpCode);
