<?php
// ========================================================
// API Endpoint: Get Referrals Initiated by This Facility
// Route: Backend proxy for GET /api/v1/referral/mine
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/referral_patient_display.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

[$httpCode, $response, $curlErrno, $curlError] = sendSignedIolRequest(
    'GET',
    '/api/v1/referral/mine',
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

if ($isSuccess && is_array($response) && array_is_list($response)) {
    try {
        $response = addReferralPatientDisplayIds(getDbConnection(), (int)$loggedInUser['facility']['id'], $response);
    } catch (Throwable $error) {
        error_log('Unable to resolve local referral patient display IDs.');
        foreach ($response as &$referral) {
            $referral['patient_display_id'] = str_starts_with((string)($referral['patient_id'] ?? ''), 'tx_')
                ? 'Unavailable' : ($referral['patient_id'] ?? 'Unavailable');
        }
        unset($referral);
    }
}

sendRawJsonResponse($response, $isSuccess ? 200 : $httpCode);
