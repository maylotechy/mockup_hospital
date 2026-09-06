<?php
require_once __DIR__ . '/config.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized.'], 401);
}

$referralId = trim((string)($_GET['referral_id'] ?? ''));
if ($referralId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing referral_id.'], 400);
}

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'GET',
    "/api/v1/referral/{$referralId}/attachments",
    '',
    $user['facility']['code'],
    $user['facility']['name']
);

if ($curlErrno) {
    sendJsonResponse(['success' => false, 'message' => 'Failed to reach IOL server.'], 503);
}
sendRawJsonResponse($response, $httpCode);
