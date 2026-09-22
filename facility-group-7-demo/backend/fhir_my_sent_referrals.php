<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- My Sent Referrals
// List ServiceRequests we sent (requester = our org's PractitionerRoles)
// Mirrors fhir_receive_referrals.php but keyed on "requester" (sending side)
// instead of "performer" (receiving side).
// ========================================================

require_once __DIR__ . '/config.php';

$ourOrgId = trim($_GET['org_id'] ?? '');
if (!$ourOrgId) {
    sendJsonResponse(['success' => false, 'message' => 'Provide org_id query parameter (from registration)'], 400);
}

$ourOrgRef = "Organization/$ourOrgId";

[$roleCode, $roleResp, $roleErrno] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL, 'PractitionerRole?organization=' . urlencode($ourOrgRef) . '&_count=100'
);
if ($roleErrno || $roleCode < 200 || $roleCode >= 300) {
    sendJsonResponse(['success' => false, 'message' => 'Could not query FHIR server for PractitionerRoles', 'http_status' => $roleCode], $roleCode ?: 502);
}

$roleIds = [];
foreach (($roleResp['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    if (($res['resourceType'] ?? '') === 'PractitionerRole' && !empty($res['id'])) {
        $roleIds[] = 'PractitionerRole/' . $res['id'];
    }
}

if (!$roleIds) {
    sendJsonResponse(['success' => true, 'our_organization_ref' => $ourOrgRef, 'referral_count' => 0, 'referrals' => []]);
}

$requesterParam = implode(',', array_map('urlencode', $roleIds));

[$srCode, $srResp, $srErrno] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL,
    "ServiceRequest?requester={$requesterParam}&_include=ServiceRequest:subject&_sort=-_lastUpdated&_count=50"
);
if ($srErrno || $srCode < 200 || $srCode >= 300) {
    sendJsonResponse(['success' => false, 'message' => 'Could not query FHIR server for ServiceRequests', 'http_status' => $srCode], $srCode ?: 502);
}

$patientsById = [];
$serviceRequests = [];
foreach (($srResp['entry'] ?? []) as $entry) {
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
    $serviceRequestId = $sr['id'] ?? null;
    $patientId = fg7RefId($sr['subject']['reference'] ?? null);
    $patientName = isset($patientsById[$patientId]) ? fg7HumanName($patientsById[$patientId]['name'] ?? []) : 'Unknown Patient';
    $performerRef = $sr['performer'][0]['reference'] ?? null;

    $task = $serviceRequestId ? fg7FindTaskForServiceRequest($serviceRequestId) : null;

    $referrals[] = [
        'service_request_id' => $serviceRequestId,
        'status' => $sr['status'] ?? 'unknown',
        'priority' => $sr['priority'] ?? 'routine',
        'category' => $sr['category'][0]['text'] ?? $sr['category'][0]['coding'][0]['display'] ?? 'Unknown',
        'reason' => $sr['reasonCode'][0]['text'] ?? $sr['reasonCode'][0]['coding'][0]['display'] ?? 'No reason given',
        'authored_on' => $sr['authoredOn'] ?? null,
        'patient_name' => $patientName,
        'patient_id' => $patientId,
        'receiving_performer_ref' => $performerRef,
        'task_status' => $task['status'] ?? null,
    ];
}

sendJsonResponse([
    'success' => true,
    'our_organization_ref' => $ourOrgRef,
    'referral_count' => count($referrals),
    'referrals' => $referrals,
]);
