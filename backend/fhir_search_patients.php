<?php
// ========================================================
// API Endpoint: Browse patients already on the HL7 FHIR Connectathon sandbox
// (most-recently-touched first). Read-only -- GET /Patient. For the "FHIR:
// Patients" tab, so staff can sanity-check what's already there before
// sending -- this is informational only, NOT a duplicate-prevention gate
// (our own sends already dedupe via conditional PUT by our own identifier;
// a different team's same-named patient is still a separate record here,
// since matching only happens on shared identifiers). Fully separate from
// the IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

[$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient?_count=20&_sort=-_lastUpdated');

if ($curlErrno || $httpCode < 200 || $httpCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not reach the FHIR sandbox.',
        'http_status' => $httpCode,
        'curl_error' => $curlErrno ? $curlError : null,
    ], $httpCode ?: 502);
}

$patients = [];
foreach (($response['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    if (($res['resourceType'] ?? '') !== 'Patient') {
        continue;
    }
    $patients[] = fhirSimplifyPatient($res);
}

sendJsonResponse([
    'success' => true,
    'endpoint' => FHIR_EREFERRAL_BASE_URL,
    'total' => $response['total'] ?? count($patients),
    'patients' => $patients,
]);
