<?php
// ========================================================
// API Endpoint: List Organizations already on the HL7 FHIR Connectathon
// sandbox (FHIRLab). Read-only -- GET /Organization -- used by the
// "FHIR: Organizations" tab and by the Send Test tab's receiving-org
// picker. Fully separate from the IOL/IRDSS flow; see
// hackathon_tracker/TRACKER.md.
// ========================================================

require_once __DIR__ . '/config.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

// The sandbox is shared across every Connectathon participant since June and
// already holds 130+ Organizations with no guaranteed default sort order, so a
// plain _count=50 (no sort) can silently omit an org you just registered --
// confirmed 2026-09-15 (see hackathon_tracker/TRACKER.md). Sorting newest-first
// means anything just written here always lands on page one; _count is raised
// well above the current total as a stopgap. This still isn't true pagination --
// if the sandbox's total ever exceeds _count, older entries fall off the end.
// A real fix would follow the Bundle's "next" link or add a server-side search
// (by name/identifier) instead of fetching everything client-side.
[$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Organization?_count=200&_sort=-_lastUpdated');

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
    'endpoint' => FHIR_EREFERRAL_BASE_URL,
    'total' => $response['total'] ?? count($organizations),
    'organizations' => $organizations,
]);
