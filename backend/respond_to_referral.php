<?php
// ========================================================
// API Endpoint: Accept or Redirect an Incoming Referral
// Route: Backend proxy for PATCH /api/v1/referral/{id}/respond
// ========================================================

require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'PATCH') {
    sendJsonResponse(['success' => false, 'message' => 'Invalid request method. Only PATCH is allowed.'], 405);
}

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
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
$decision = isset($input['decision']) ? trim((string)$input['decision']) : '';

if (empty($referralId) || !in_array($decision, ['ACCEPTED', 'REDIRECTED'], true)) {
    sendJsonResponse(['success' => false, 'message' => "Missing or invalid required fields: referral_id, decision (must be 'ACCEPTED' or 'REDIRECTED')."], 400);
}

$payloadJson = json_encode(['decision' => $decision], JSON_UNESCAPED_SLASHES);

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'PATCH',
    "/api/v1/referral/{$referralId}/respond",
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
    logAuditEvent(
        $loggedInUser,
        $decision === 'ACCEPTED' ? 'REFERRAL_ACCEPTED' : 'REFERRAL_REJECTED',
        $referralId
    );
}

sendJsonResponse([
    'success' => $isSuccess,
    'http_status' => $httpCode,
    'message' => $isSuccess ? "Referral successfully {$decision}." : ($response['detail'] ?? 'Failed to submit referral decision.'),
    'iol_response' => $response
], $isSuccess ? 200 : $httpCode);
