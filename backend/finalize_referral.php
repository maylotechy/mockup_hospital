<?php
// ========================================================
// API Endpoint: Finalize Referral Selection
// Route: Backend proxy for PATCH /api/v1/referral/{id}/finalize
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
$hospitalName = isset($input['hospital_name']) ? trim((string)$input['hospital_name']) : '';

if (empty($referralId) || empty($hospitalName)) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Missing required fields: referral_id, hospital_name.'
    ], 400);
}

$payloadJson = json_encode(['hospital_name' => $hospitalName], JSON_UNESCAPED_SLASHES);

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'PATCH',
    "/api/v1/referral/{$referralId}/finalize",
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

if ($isSuccess) {
    logAuditEvent($loggedInUser, 'REFERRAL_FINALIZED', $referralId, null, "Chose {$hospitalName}");
}

sendJsonResponse([
    'success' => $isSuccess,
    'http_status' => $httpCode,
    'message' => $isSuccess ? 'Referral finalized successfully.' : 'Failed to finalize referral.',
    'iol_response' => $response
], $isSuccess ? 200 : $httpCode);
