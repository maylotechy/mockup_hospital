<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Receive Referrals
// Poll FHIR sandbox for ServiceRequests sent to us
// ========================================================

require_once __DIR__ . '/config.php';

$ourOrgId = trim($_GET['org_id'] ?? '');
if (!$ourOrgId) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Provide org_id query parameter (from registration)',
    ], 400);
}

$ourOrgRef = "Organization/$ourOrgId";

// Get PractitionerRoles that reference our org
[$roleCode, $roleResp, $roleErrno, $roleErr] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL, 'PractitionerRole?organization=' . urlencode($ourOrgRef) . '&_count=100'
);

if ($roleErrno || $roleCode < 200 || $roleCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not query FHIR server for PractitionerRoles',
        'http_status' => $roleCode,
    ], $roleCode ?: 502);
}

$roleIds = [];
foreach (($roleResp['entry'] ?? []) as $entry) {
    $res = $entry['resource'] ?? [];
    if (($res['resourceType'] ?? '') === 'PractitionerRole' && !empty($res['id'])) {
        $roleIds[] = 'PractitionerRole/' . $res['id'];
    }
}

// Search ServiceRequests where performer is one of our roles or us directly
$performerValues = $roleIds;
$performerValues[] = $ourOrgRef;
$performerParam = implode(',', array_map('urlencode', $performerValues));

[$srCode, $srResp, $srErrno, $srErr] = sendFhirRequest(
    'GET', FHIR_EREFERRAL_BASE_URL,
    "ServiceRequest?performer={$performerParam}&_include=ServiceRequest:subject&_sort=-_lastUpdated&_count=50"
);

if ($srErrno || $srCode < 200 || $srCode >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not query FHIR server for ServiceRequests',
        'http_status' => $srCode,
    ], $srCode ?: 502);
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

    // Look up the Task tracking this referral (created alongside it at send
    // time) so the frontend can show the right "next step" button -- Task
    // carries received/accepted (ServiceRequest.status has no such values).
    $task = $serviceRequestId ? fg7FindTaskForServiceRequest($serviceRequestId) : null;
    $taskStatus = $task['status'] ?? null;
    $encounter = ($serviceRequestId && in_array($taskStatus, ['accepted', 'completed'], true))
        ? fg7FindEncounterForServiceRequest($serviceRequestId)
        : null;

    $referrals[] = [
        'service_request_id' => $serviceRequestId,
        'status' => $sr['status'] ?? 'unknown',
        'priority' => $sr['priority'] ?? 'routine',
        'category' => $sr['category'][0]['text'] ?? $sr['category'][0]['coding'][0]['display'] ?? 'Unknown',
        'reason' => $sr['reasonCode'][0]['text'] ?? $sr['reasonCode'][0]['coding'][0]['display'] ?? 'No reason given',
        'authored_on' => $sr['authoredOn'] ?? null,
        'patient_name' => $patientName,
        'patient_id' => $patientId,
        'task_id' => $task['id'] ?? null,
        'task_status' => $taskStatus,
        'encounter_id' => $encounter['id'] ?? null,
    ];
}

sendJsonResponse([
    'success' => true,
    'our_organization_ref' => $ourOrgRef,
    'referral_count' => count($referrals),
    'referrals' => $referrals,
]);
