<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Referral Timeline (Shopee-style tracker)
//
// Returns a FIXED set of milestone steps -- sent, received, accepted,
// encounter, completed -- always all five, so a referral that's only just
// been sent still shows the full tracker with the first step lit up and the
// receiving hospital named, instead of a sparse list that only grows once
// something happens. Steps not yet reached come back with completed=false
// and time=null; the frontend renders those as greyed-out/pending.
//
// Timestamps come from real FHIR resource _history (verified live: each
// version's meta.lastUpdated is an actual timestamped state change), same
// source as the previous freeform-events version of this endpoint.
// ========================================================

require_once __DIR__ . '/config.php';

$serviceRequestId = trim($_GET['service_request_id'] ?? '');
if (!$serviceRequestId) {
    sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id query parameter'], 400);
}

[$srCode, $sr, $srErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, "ServiceRequest/$serviceRequestId");
if ($srErrno || $srCode < 200 || $srCode >= 300 || ($sr['resourceType'] ?? '') !== 'ServiceRequest') {
    sendJsonResponse(['success' => false, 'message' => $srCode === 404 ? 'Referral not found' : 'Could not fetch referral', 'http_status' => $srCode], $srCode ?: 502);
}

// Resolve the receiving hospital's display name: ServiceRequest.performer ->
// PractitionerRole.organization -> Organization.name (performer can also
// reference an Organization directly, depending on how the bundle was built).
$receivingOrgName = null;
$receivingOrgRef = null;
$performerRef = $sr['performer'][0]['reference'] ?? null;
if ($performerRef) {
    [$perfType, $perfId] = array_pad(explode('/', $performerRef), 2, null);
    if ($perfType === 'PractitionerRole' && $perfId) {
        [$prCode, $prRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, "PractitionerRole/$perfId");
        if ($prCode >= 200 && $prCode < 300) {
            $receivingOrgRef = $prRes['organization']['reference'] ?? null;
        }
    } elseif ($perfType === 'Organization') {
        $receivingOrgRef = $performerRef;
    }
    if ($receivingOrgRef) {
        [$orgCode, $orgRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $receivingOrgRef);
        if ($orgCode >= 200 && $orgCode < 300 && ($orgRes['resourceType'] ?? '') === 'Organization') {
            $receivingOrgName = $orgRes['name'] ?? null;
        }
    }
}

$sentTime = $sr['authoredOn'] ?? null;
$receivedTime = null;
$receivedNote = null;
$acceptedTime = null;
$acceptedNote = null;
$completedTime = null;
$completedNote = null;

$task = fg7FindTaskForServiceRequest($serviceRequestId);
if ($task) {
    [$taskCode, $taskHistory] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, "Task/{$task['id']}/_history");
    if ($taskCode >= 200 && $taskCode < 300) {
        $versions = array_reverse($taskHistory['entry'] ?? []); // oldest first
        $previousNotes = [];
        foreach ($versions as $entry) {
            $res = $entry['resource'] ?? [];
            $status = $res['status'] ?? '';
            $currentNotes = array_map(fn($n) => $n['text'] ?? '', $res['note'] ?? []);
            $newNote = implode(' ', array_slice($currentNotes, count($previousNotes)));
            $previousNotes = $currentNotes;
            $when = $res['meta']['lastUpdated'] ?? null;

            if ($status === 'received' && !$receivedTime) { $receivedTime = $when; $receivedNote = $newNote ?: null; }
            if ($status === 'accepted' && !$acceptedTime) { $acceptedTime = $when; $acceptedNote = $newNote ?: null; }
            if ($status === 'completed' && !$completedTime) { $completedTime = $when; $completedNote = $newNote ?: null; }
        }
    }
}

$encounter = fg7FindEncounterForServiceRequest($serviceRequestId);
$encounterTime = $encounter['period']['start'] ?? null;

// ServiceRequest itself closes last -- if that happened, it's the true
// "completed" timestamp (it's always at or after the Task's own completion).
if (($sr['status'] ?? '') === 'completed') {
    [$srHistCode, $srHistory] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, "ServiceRequest/$serviceRequestId/_history");
    if ($srHistCode >= 200 && $srHistCode < 300) {
        foreach (($srHistory['entry'] ?? []) as $entry) {
            $res = $entry['resource'] ?? [];
            if (($res['status'] ?? '') === 'completed') {
                $completedTime = $res['meta']['lastUpdated'] ?? $completedTime;
                break; // entries come back newest-first; this is the closing version
            }
        }
    }
}

$steps = [
    [
        'key' => 'sent',
        'label' => 'Referral Sent',
        'completed' => true, // always true -- if we can fetch it, it was sent
        'time' => $sentTime,
        'detail' => $receivingOrgName ? "Sent to $receivingOrgName" : 'Sent to receiving facility',
    ],
    [
        'key' => 'received',
        'label' => 'Received by Receiving Facility',
        'completed' => $receivedTime !== null,
        'time' => $receivedTime,
        'detail' => $receivedNote,
    ],
    [
        'key' => 'accepted',
        'label' => 'Accepted for Care',
        'completed' => $acceptedTime !== null,
        'time' => $acceptedTime,
        'detail' => $acceptedNote,
    ],
    [
        'key' => 'encounter',
        'label' => 'Patient Seen',
        'completed' => $encounterTime !== null,
        'time' => $encounterTime,
        'detail' => $encounter ? 'Receiving encounter recorded' : null,
    ],
    [
        'key' => 'completed',
        'label' => 'Referral Completed',
        'completed' => $completedTime !== null,
        'time' => $completedTime,
        'detail' => $completedNote,
    ],
];

$currentStepIndex = 0;
foreach ($steps as $i => $step) {
    if ($step['completed']) $currentStepIndex = $i;
}

sendJsonResponse([
    'success' => true,
    'service_request_id' => $serviceRequestId,
    'receiving_organization_name' => $receivingOrgName,
    'receiving_organization_ref' => $receivingOrgRef,
    'steps' => $steps,
    'current_step_index' => $currentStepIndex,
]);
