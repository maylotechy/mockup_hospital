<?php
// ========================================================
// API Endpoint: Issue a WebSocket Connection Ticket
// Route: Backend proxy for POST /api/v1/ws-ticket
// ========================================================
//
// Browser WebSocket clients can't attach the RSA signature headers used by
// every REST call, so the frontend first asks this RSA-authenticated PHP
// endpoint for a short-lived, one-time ticket, then opens the WebSocket
// directly to IOL with that ticket as a query param.

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please log in again.'
    ], 401);
}

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'POST',
    '/api/v1/ws-ticket',
    '{}',
    $loggedInUser['facility']['code'],
    $loggedInUser['facility']['name']
);

if ($curlErrno || $httpCode < 200 || $httpCode >= 300 || !is_array($response) || empty($response['ticket'])) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Failed to obtain a real-time connection ticket.'
    ], $curlErrno ? 503 : ($httpCode ?: 500));
}

$iolHost = $_ENV['IOL_HOST'] ?? 'localhost';

sendJsonResponse([
    'success' => true,
    'ticket' => $response['ticket'],
    'ws_url' => 'ws://' . $iolHost . ':8081/ws/referrals?ticket=' . urlencode($response['ticket'])
]);
