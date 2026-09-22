<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Receiving-side referral workflow
//
// Drives a referral through its FHIR lifecycle on the RECEIVING side:
//   requested -> received -> accepted -> (Encounter created) -> completed (Task)
//   -> completed (ServiceRequest)
//
// Task.status carries received/accepted/completed (ServiceRequest.status has
// no "received"/"accepted" values -- only Task does, per the task-status
// ValueSet), so every step except the last PATCHes the Task tracking the
// referral (found via Task.focus=ServiceRequest/{id}, created alongside the
// ServiceRequest at send time). The final step marks the ServiceRequest
// itself completed, closing out the order.
// ========================================================

require_once __DIR__ . '/config.php';

$action = trim($_GET['action'] ?? '');
$body = json_decode(file_get_contents('php://input'), true) ?? [];

function fg7NowIso(): string {
    return date('c');
}

if ($action === 'mark_received') {
    $serviceRequestId = trim($body['service_request_id'] ?? '');
    $receivingOrgId = trim($body['receiving_org_id'] ?? '');
    $receivingOrgName = trim($body['receiving_org_name'] ?? '');

    if (!$serviceRequestId || !$receivingOrgId) {
        sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id or receiving_org_id'], 400);
    }

    $task = fg7FindTaskForServiceRequest($serviceRequestId);
    if (!$task) {
        // Some interoperating systems send only a ServiceRequest and omit the
        // optional workflow Task. Create our receiving-side tracking Task on
        // first acknowledgement so those referrals can use the same lifecycle.
        [$srCode, $serviceRequest, $srErrno] = sendFhirRequest(
            'GET', FHIR_EREFERRAL_BASE_URL, 'ServiceRequest/' . urlencode($serviceRequestId)
        );
        if ($srErrno || $srCode < 200 || $srCode >= 300 || ($serviceRequest['resourceType'] ?? '') !== 'ServiceRequest') {
            sendJsonResponse(['success' => false, 'message' => "ServiceRequest/$serviceRequestId could not be loaded"], $srCode ?: 502);
        }

        $patientRef = $serviceRequest['subject']['reference'] ?? null;
        $requester = $serviceRequest['requester'] ?? null;
        if (!$patientRef || !$requester) {
            sendJsonResponse(['success' => false, 'message' => 'The external referral is missing its patient or requester reference'], 422);
        }

        $nowIso = fg7NowIso();
        $ownerValue = ['reference' => "Organization/$receivingOrgId"];
        if ($receivingOrgName) $ownerValue['display'] = $receivingOrgName;
        $taskResource = [
            'resourceType' => 'Task',
            'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task']],
            'status' => 'received',
            'intent' => 'order',
            'code' => [
                'coding' => [[
                    'system' => 'http://snomed.info/sct',
                    'code' => '3457005',
                    'display' => 'Patient referral',
                ]],
                'text' => 'Receiving-side referral tracking',
            ],
            'focus' => ['reference' => "ServiceRequest/$serviceRequestId"],
            'for' => ['reference' => $patientRef],
            'authoredOn' => $serviceRequest['authoredOn'] ?? $nowIso,
            'lastModified' => $nowIso,
            'requester' => $requester,
            'owner' => $ownerValue,
            'note' => [['text' => 'External referral received by this facility. Receiving-side Task created for workflow tracking.']],
        ];

        [$createCode, $createdTask, $createErrno, $createErr] = sendFhirRequest(
            'POST', FHIR_EREFERRAL_BASE_URL, 'Task', json_encode($taskResource)
        );
        if ($createErrno || $createCode < 200 || $createCode >= 300) {
            sendJsonResponse([
                'success' => false,
                'message' => 'The referral has no Task and a receiving-side Task could not be created',
                'http_status' => $createCode,
                'error' => $createErr,
                'sandbox_response' => $createdTask,
            ], $createCode ?: 502);
        }

        sendJsonResponse([
            'success' => true,
            'message' => 'External referral marked as received',
            'task_id' => $createdTask['id'] ?? null,
            'task_status' => 'received',
            'task_created' => true,
        ]);
    }

    $ownerValue = ['reference' => "Organization/$receivingOrgId"];
    if ($receivingOrgName) $ownerValue['display'] = $receivingOrgName;
    $noteText = 'Referral received by the receiving facility. Pending review.';

    // JSON Patch "add" on /note/- appends, but requires /note to already exist
    // as an array -- fall back to setting the whole array when it's absent.
    $patchOps = [
        ['op' => 'replace', 'path' => '/status', 'value' => 'received'],
        ['op' => 'replace', 'path' => '/lastModified', 'value' => fg7NowIso()],
        ['op' => empty($task['owner']) ? 'add' : 'replace', 'path' => '/owner', 'value' => $ownerValue],
    ];
    $patchOps[] = empty($task['note'])
        ? ['op' => 'add', 'path' => '/note', 'value' => [['text' => $noteText]]]
        : ['op' => 'add', 'path' => '/note/-', 'value' => ['text' => $noteText]];

    [$code, $response, $errno, $err] = fg7JsonPatch('Task', $task['id'], $patchOps);

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not mark referral as received', 'http_status' => $code, 'sandbox_response' => $response], $code ?: 502);
    }

    sendJsonResponse(['success' => true, 'message' => 'Referral marked as received', 'task_id' => $task['id'], 'task_status' => 'received']);

} elseif ($action === 'accept') {
    $serviceRequestId = trim($body['service_request_id'] ?? '');
    if (!$serviceRequestId) {
        sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id'], 400);
    }

    $task = fg7FindTaskForServiceRequest($serviceRequestId);
    if (!$task) {
        sendJsonResponse(['success' => false, 'message' => "No Task found tracking ServiceRequest/$serviceRequestId"], 404);
    }

    $noteText = 'Referral accepted for urgent evaluation and management.';
    $patchOps = [
        ['op' => 'replace', 'path' => '/status', 'value' => 'accepted'],
        ['op' => 'replace', 'path' => '/lastModified', 'value' => fg7NowIso()],
    ];
    $patchOps[] = empty($task['note'])
        ? ['op' => 'add', 'path' => '/note', 'value' => [['text' => $noteText]]]
        : ['op' => 'add', 'path' => '/note/-', 'value' => ['text' => $noteText]];

    [$code, $response, $errno, $err] = fg7JsonPatch('Task', $task['id'], $patchOps);

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not accept referral', 'http_status' => $code, 'sandbox_response' => $response], $code ?: 502);
    }

    sendJsonResponse(['success' => true, 'message' => 'Referral accepted', 'task_id' => $task['id'], 'task_status' => 'accepted']);

} elseif ($action === 'create_encounter') {
    $serviceRequestId = trim($body['service_request_id'] ?? '');
    $patientId = trim($body['patient_id'] ?? '');
    $receivingOrgId = trim($body['receiving_org_id'] ?? '');

    if (!$serviceRequestId || !$patientId || !$receivingOrgId) {
        sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id, patient_id, or receiving_org_id'], 400);
    }

    $task = fg7FindTaskForServiceRequest($serviceRequestId);
    if (!$task || !in_array($task['status'] ?? '', ['accepted', 'completed'], true)) {
        sendJsonResponse(['success' => false, 'message' => 'Accept the referral before adding the patient to your records'], 409);
    }
    $taskOwnerId = fg7RefId($task['owner']['reference'] ?? null);
    if ($taskOwnerId && $taskOwnerId !== $receivingOrgId) {
        sendJsonResponse(['success' => false, 'message' => 'This referral belongs to a different receiving organization'], 403);
    }

    [$srCode, $serviceRequest, $srErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'ServiceRequest/' . urlencode($serviceRequestId));
    $referredPatientId = fg7RefId($serviceRequest['subject']['reference'] ?? null);
    if ($srErrno || $srCode < 200 || $srCode >= 300 || $referredPatientId !== $patientId) {
        sendJsonResponse(['success' => false, 'message' => 'The patient does not match this referral'], 400);
    }

    // Idempotent -- if an encounter already exists for this referral, reuse it
    // instead of creating a duplicate.
    $existing = fg7FindEncounterForServiceRequest($serviceRequestId);
    if ($existing) {
        sendJsonResponse(['success' => true, 'message' => 'Patient is already in this facility\'s records', 'encounter_id' => $existing['id']]);
    }

    // NOTE: Encounter has no .note element in base FHIR R4 (unlike Condition/
    // Observation/Task/ServiceRequest, which all do) -- confirmed live via a
    // 422 "Unrecognized property 'note'" when it was included.
    $nowIso = fg7NowIso();
    $encounterResource = [
        'resourceType' => 'Encounter',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter']],
        'status' => 'finished',
        'class' => ['system' => 'http://terminology.hl7.org/CodeSystem/v3-ActCode', 'code' => 'AMB', 'display' => 'ambulatory'],
        'subject' => ['reference' => "Patient/$patientId"],
        'basedOn' => [['reference' => "ServiceRequest/$serviceRequestId"]],
        'period' => ['start' => $nowIso, 'end' => $nowIso],
        'serviceProvider' => ['reference' => "Organization/$receivingOrgId"],
    ];

    [$code, $response, $errno, $err] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, 'Encounter', json_encode($encounterResource));

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not create receiving encounter', 'http_status' => $code, 'sandbox_response' => $response], $code ?: 502);
    }

    sendJsonResponse(['success' => true, 'message' => 'Patient added to this facility\'s records', 'encounter_id' => $response['id'] ?? null]);

} elseif ($action === 'complete_task') {
    $serviceRequestId = trim($body['service_request_id'] ?? '');
    $receivingEncounterId = trim($body['receiving_encounter_id'] ?? '');

    if (!$serviceRequestId || !$receivingEncounterId) {
        sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id or receiving_encounter_id'], 400);
    }

    $task = fg7FindTaskForServiceRequest($serviceRequestId);
    if (!$task) {
        sendJsonResponse(['success' => false, 'message' => "No Task found tracking ServiceRequest/$serviceRequestId"], 404);
    }

    $noteText = 'Referral completed; receiving encounter recorded.';
    $patchOps = [
        ['op' => 'replace', 'path' => '/status', 'value' => 'completed'],
        ['op' => 'replace', 'path' => '/lastModified', 'value' => fg7NowIso()],
        [
            'op' => empty($task['output']) ? 'add' : 'replace',
            'path' => '/output',
            'value' => [[
                'type' => ['text' => 'Referral completion encounter'],
                'valueReference' => ['reference' => "Encounter/$receivingEncounterId"],
            ]],
        ],
    ];
    $patchOps[] = empty($task['note'])
        ? ['op' => 'add', 'path' => '/note', 'value' => [['text' => $noteText]]]
        : ['op' => 'add', 'path' => '/note/-', 'value' => ['text' => $noteText]];

    [$code, $response, $errno, $err] = fg7JsonPatch('Task', $task['id'], $patchOps);

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not complete task', 'http_status' => $code, 'sandbox_response' => $response], $code ?: 502);
    }

    sendJsonResponse(['success' => true, 'message' => 'Task marked completed', 'task_id' => $task['id'], 'task_status' => 'completed']);

} elseif ($action === 'complete_referral') {
    $serviceRequestId = trim($body['service_request_id'] ?? '');
    if (!$serviceRequestId) {
        sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id'], 400);
    }

    $patchOps = [
        ['op' => 'replace', 'path' => '/status', 'value' => 'completed'],
    ];

    [$code, $response, $errno, $err] = fg7JsonPatch('ServiceRequest', $serviceRequestId, $patchOps);

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not close referral', 'http_status' => $code, 'sandbox_response' => $response], $code ?: 502);
    }

    sendJsonResponse(['success' => true, 'message' => 'Referral closed', 'service_request_status' => 'completed']);

} else {
    sendJsonResponse([
        'success' => false,
        'message' => 'Use action=mark_received, action=accept, action=create_encounter, action=complete_task, or action=complete_referral',
    ], 400);
}
