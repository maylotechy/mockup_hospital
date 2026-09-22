<?php
// ========================================================
// API Endpoint: Poll the HL7 FHIR Connectathon sandbox for referrals sent TO
// our own registered Organization -- i.e. the receiving side of the loop.
// Read-only (two GETs), filtered by facilities.fhir_organization_id so we
// never pull the whole sandbox. Fully separate from the IOL/IRDSS flow; see
// hackathon_tracker/TRACKER.md.
//
// How it finds "referrals sent to us": ServiceRequest.performer can point at
// EITHER a PractitionerRole whose .organization is us (our own adapter's
// convention), OR at our Organization directly (confirmed live 2026-09-15 --
// a real referral from another Connectathon participant used a direct
// Organization reference and would have been silently missed by an
// PractitionerRole-only search). So this searches for both shapes in one call:
//   1. GET /PractitionerRole?organization={ourOrgRef} -- every role anyone has
//      ever pointed at us.
//   2. GET /ServiceRequest?performer={role1,role2,...,ourOrgRef}&_include=... --
//      every referral whose performer is one of those roles OR us directly,
//      with the Patient pulled into the same response via _include (avoids an
//      N+1 Patient fetch per referral).
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$facilityId = (int)($user['facility']['id'] ?? 0);
if ($facilityId <= 0) {
    sendJsonResponse(['success' => false, 'message' => 'Could not determine your facility from your session.'], 400);
}

$pdo = getDbConnection();
$stmt = $pdo->prepare('SELECT fhir_organization_id FROM facilities WHERE id = :id');
$stmt->execute([':id' => $facilityId]);
$ourOrgRef = $stmt->fetchColumn();

if (!$ourOrgRef) {
    sendJsonResponse([
        'success' => true,
        'registered' => false,
        'referrals' => [],
        'message' => 'Register your facility as an Organization first (FHIR: Organizations tab) -- there\'s nothing to filter by yet.',
    ]);
}

[$roleHttpCode, $roleResponse, $roleErrno, $roleErr] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL, 'PractitionerRole?organization=' . urlencode($ourOrgRef) . '&_count=100'
);
if ($roleErrno || $roleHttpCode < 200 || $roleHttpCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not reach the FHIR sandbox.',
        'http_status' => $roleHttpCode,
        'curl_error' => $roleErrno ? $roleErr : null,
    ], $roleHttpCode ?: 502);
}

$roleIds = [];
foreach (($roleResponse['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    if (($res['resourceType'] ?? '') === 'PractitionerRole' && !empty($res['id'])) {
        $roleIds[] = 'PractitionerRole/' . $res['id'];
    }
}

// Always include our own Organization reference directly, even if no roles
// point at us yet -- a referral can address us without ever creating a
// PractitionerRole at all (see the Baguio example above).
$performerValues = $roleIds;
$performerValues[] = $ourOrgRef;
$performerParam = implode(',', array_map('urlencode', $performerValues));
[$srHttpCode, $srResponse, $srErrno, $srErr] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL,
    "ServiceRequest?performer={$performerParam}&_include=ServiceRequest:subject&_sort=-_lastUpdated&_count=50"
);
if ($srErrno || $srHttpCode < 200 || $srHttpCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not reach the FHIR sandbox.',
        'http_status' => $srHttpCode,
        'curl_error' => $srErrno ? $srErr : null,
    ], $srHttpCode ?: 502);
}

$patientsById = [];
$serviceRequests = [];
foreach (($srResponse['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    $type = $res['resourceType'] ?? '';
    if ($type === 'Patient') {
        $patientsById[$res['id']] = $res;
    } elseif ($type === 'ServiceRequest') {
        $serviceRequests[] = $res;
    }
}

$referrals = [];
foreach ($serviceRequests as $sr) {
    $patientId = fhirRefId($sr['subject']['reference'] ?? null);
    $referrals[] = [
        'service_request_id' => $sr['id'] ?? null,
        'status' => $sr['status'] ?? null,
        'category' => $sr['category'][0]['text'] ?? null,
        'reason' => $sr['reasonCode'][0]['text'] ?? null,
        'authored_on' => $sr['authoredOn'] ?? null,
        'patient_name' => isset($patientsById[$patientId]) ? fhirHumanName($patientsById[$patientId]['name'] ?? []) : null,
    ];
}

sendJsonResponse([
    'success' => true,
    'registered' => true,
    'our_organization_ref' => $ourOrgRef,
    'referrals' => $referrals,
]);
