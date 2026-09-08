<?php
// ========================================================
// API Endpoint: Get Pending Incoming Referrals for This Facility
// Route: Backend proxy for GET /api/v1/referral/incoming
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'GET',
    '/api/v1/referral/incoming',
    '',
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

sendRawJsonResponse($response, $isSuccess ? 200 : $httpCode);
