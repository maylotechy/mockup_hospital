<?php
// ========================================================
// API Endpoint: Search the HL7 FHIR Connectathon sandbox for an Organization
// by its real NHFR (National Health Facility Registry) code -- GET
// /Organization?identifier={nhfrSystem}|{code}. For the "Search by NHFR
// Code" box on the "FHIR: Organizations" tab, so a real receiving facility
// can be resolved directly instead of scrolling the full org list or
// falling back to the placeholder. Read-only. Fully separate from the
// IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
//
// mock_hospitals has no NHFR code of its own (see hackathon_tracker/
// TRACKER.md field-gap notes) -- this only searches for OTHER, real,
// already-NHFR-registered facilities, using FHIR_NHFR_ID_SYSTEM (fhir_shared.php),
// never our own FHIR_TEST_ID_SYSTEM.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$nhfrCode = trim((string)($_GET['code'] ?? ''));
if ($nhfrCode === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing required field: code.'], 400);
}

// Matches the unencoded system|value convention already proven live by
// buildDiwaOrganizationResource()'s conditionalUrl (fhir_shared.php) --
// sendFhirRequest() does no encoding of its own, it just concatenates $path
// onto the base URL and hands it straight to cURL.
$searchUrl = 'Organization?identifier=' . FHIR_NHFR_ID_SYSTEM . '|' . $nhfrCode;
[$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $searchUrl);

if ($curlErrno || $httpCode < 200 || $httpCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not reach the FHIR sandbox.',
        'http_status' => $httpCode,
        'curl_error' => $curlErrno ? $curlError : null,
    ], $httpCode ?: 502);
}

$organizations = [];
foreach (($response['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    if (($res['resourceType'] ?? '') !== 'Organization') {
        continue;
    }
    $organizations[] = [
        'id' => $res['id'] ?? null,
        'name' => $res['name'] ?? '(no name)',
        'alias' => $res['alias'] ?? [],
        'identifiers' => array_map(
            fn($i) => trim(($i['system'] ?? '') . '|' . ($i['value'] ?? ''), '|'),
            $res['identifier'] ?? []
        ),
    ];
}

sendJsonResponse([
    'success' => true,
    'nhfr_code' => $nhfrCode,
    'organizations' => $organizations,
]);
