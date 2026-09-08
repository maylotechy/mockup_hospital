<?php
// ========================================================
// API Endpoint: Get Facility Admin Analytics (top reasons/senders/receivers, monthly volume)
// Route: Backend proxy for GET /api/v1/referral/analytics
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$query = [];
foreach (['start_date', 'end_date'] as $dateParam) {
    if (isset($_GET[$dateParam]) && $_GET[$dateParam] !== '') {
        $value = trim((string) $_GET[$dateParam]);
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $value);
        if (!$parsed || $parsed->format('Y-m-d') !== $value) {
            sendJsonResponse(['success' => false, 'message' => "$dateParam must use YYYY-MM-DD format."], 422);
        }
        $query[$dateParam] = $value;
    }
}

if (isset($query['start_date'], $query['end_date']) && $query['start_date'] > $query['end_date']) {
    sendJsonResponse(['success' => false, 'message' => 'Start date must be on or before end date.'], 422);
}

$path = '/api/v1/referral/analytics';
if ($query) {
    $path .= '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
}

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'GET',
    $path,
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
