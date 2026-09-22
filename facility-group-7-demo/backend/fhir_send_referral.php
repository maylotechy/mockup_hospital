<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Send Referral
// Build and send ServiceRequest bundle to FHIR sandbox
// ========================================================

require_once __DIR__ . '/config.php';

$body = json_decode(file_get_contents('php://input'), true) ?? [];

// Extract form fields
$patientId = trim($body['patient_id'] ?? '');
$practitionerName = trim($body['practitioner_name'] ?? '');
$practitionerRole = trim($body['practitioner_role'] ?? '');
$practitionerRoleId = trim($body['practitioner_role_id'] ?? '');
$sendingOrgId = trim($body['sending_org_id'] ?? '');
$receivingOrgId = trim($body['receiving_org_id'] ?? '');
$category = trim($body['category'] ?? 'outpatient');
$serviceType = trim($body['service_type'] ?? 'consultation');
$reason = trim($body['reason_text'] ?? '');
$chiefComplaint = trim($body['chief_complaint'] ?? '');
$workingImpression = trim($body['working_impression'] ?? '');
$sourceServiceRequestId = trim($body['source_service_request_id'] ?? '');

// Vitals (optional)
$vitalBpSystolic = isset($body['vital_bp_systolic']) && $body['vital_bp_systolic'] !== '' ? (float)$body['vital_bp_systolic'] : null;
$vitalBpDiastolic = isset($body['vital_bp_diastolic']) && $body['vital_bp_diastolic'] !== '' ? (float)$body['vital_bp_diastolic'] : null;
$vitalHr = isset($body['vital_hr']) && $body['vital_hr'] !== '' ? (float)$body['vital_hr'] : null;
$vitalRr = isset($body['vital_rr']) && $body['vital_rr'] !== '' ? (float)$body['vital_rr'] : null;
$vitalO2sat = isset($body['vital_o2sat']) && $body['vital_o2sat'] !== '' ? (float)$body['vital_o2sat'] : null;
$vitalTempC = isset($body['vital_temp_c']) && $body['vital_temp_c'] !== '' ? (float)$body['vital_temp_c'] : null;
$vitalWeightKg = isset($body['vital_weight_kg']) && $body['vital_weight_kg'] !== '' ? (float)$body['vital_weight_kg'] : null;

if (!$patientId || !$practitionerName || !$practitionerRole || !$sendingOrgId || !$receivingOrgId
    || !$category || !$serviceType || !$chiefComplaint || !$workingImpression || !$reason) {
    sendJsonResponse(['success' => false, 'message' => 'Missing required referral fields.'], 400);
}
if ($sendingOrgId === $receivingOrgId) {
    sendJsonResponse(['success' => false, 'message' => 'Choose a different receiving organization.'], 400);
}
if ($sourceServiceRequestId !== '') {
    [$sourceCode, $sourceReferral, $sourceErrno] = sendFhirRequest(
        'GET', FHIR_EREFERRAL_BASE_URL, 'ServiceRequest/' . urlencode($sourceServiceRequestId)
    );
    $sourcePatientId = fg7RefId($sourceReferral['subject']['reference'] ?? null);
    if ($sourceErrno || $sourceCode < 200 || $sourceCode >= 300 || $sourcePatientId !== $patientId) {
        sendJsonResponse(['success' => false, 'message' => 'The onward referral does not match the original patient.'], 400);
    }
}
if ($practitionerRoleId !== '') {
    [$roleCode, $registeredRole, $roleErrno] = sendFhirRequest(
        'GET', FHIR_EREFERRAL_BASE_URL, 'PractitionerRole/' . urlencode($practitionerRoleId)
    );
    $registeredOrgId = fg7RefId($registeredRole['organization']['reference'] ?? null);
    if ($roleErrno || $roleCode < 200 || $roleCode >= 300 || $registeredOrgId !== $sendingOrgId) {
        sendJsonResponse(['success' => false, 'message' => 'The selected practitioner is not registered with the sending organization.'], 400);
    }
}

// Patient must already exist on the FHIR server (created via Add Patient) -- fetch and reference it directly
[$patCode, $patResponse, $patErrno, $patErr] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($patientId));

if ($patErrno || $patCode < 200 || $patCode >= 300 || ($patResponse['resourceType'] ?? '') !== 'Patient') {
    sendJsonResponse([
        'success' => false,
        'message' => $patCode === 404 ? "Patient not found on server: $patientId" : 'Could not fetch patient from FHIR server',
        'http_status' => $patCode,
    ], $patCode ?: 502);
}

$nowIso = date('c');

// Reference the existing Patient/Organizations directly -- no need to (re)create them in this bundle
$patientUuid = "Patient/$patientId";
$sendingOrgUuid = "Organization/$sendingOrgId";
$receivingOrgUuid = "Organization/$receivingOrgId";

// UUIDs for the new resources created by this referral
$encounterUuid = 'urn:uuid:' . fg7GenUuidV4();
$ccConditionUuid = 'urn:uuid:' . fg7GenUuidV4();
$diagConditionUuid = 'urn:uuid:' . fg7GenUuidV4();
$practitionerUuid = 'urn:uuid:' . fg7GenUuidV4();
$sendingRoleUuid = $practitionerRoleId !== '' ? "PractitionerRole/$practitionerRoleId" : 'urn:uuid:' . fg7GenUuidV4();
$receivingRoleUuid = 'urn:uuid:' . fg7GenUuidV4();
$serviceRequestUuid = 'urn:uuid:' . fg7GenUuidV4();
$taskUuid = 'urn:uuid:' . fg7GenUuidV4();

$encounterResource = [
    'resourceType' => 'Encounter',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter']],
    'status' => 'planned',
    'class' => ['system' => 'http://terminology.hl7.org/CodeSystem/v3-ActCode', 'code' => 'AMB', 'display' => 'ambulatory'],
    'subject' => ['reference' => $patientUuid],
];

$ccConditionResource = [
    'resourceType' => 'Condition',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition']],
    'clinicalStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code' => 'active']]],
    'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-category', 'code' => 'problem-list-item', 'display' => 'Problem List Item']]]],
    'code' => ['text' => $chiefComplaint ?: 'Chief Complaint'],
    'subject' => ['reference' => $patientUuid],
    'encounter' => ['reference' => $encounterUuid],
];

$diagConditionResource = [
    'resourceType' => 'Condition',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition']],
    'clinicalStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code' => 'active']]],
    'verificationStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-ver-status', 'code' => 'provisional', 'display' => 'Provisional']]],
    'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-category', 'code' => 'encounter-diagnosis', 'display' => 'Encounter Diagnosis']]]],
    'code' => ['text' => $workingImpression ?: 'Working Impression'],
    'subject' => ['reference' => $patientUuid],
    'encounter' => ['reference' => $encounterUuid],
];

// Build vital observations -- LOINC-coded valueQuantity, same as the main
// mock_hospitals app's buildFhirReferralTestBundle() (backend/fhir_send_referral.php)
// and the official training bundle sample (BP as an 85354-9 panel w/ components).
$vitalDefs = [
    $vitalBpSystolic !== null && $vitalBpDiastolic !== null ? [
        'resourceType' => 'Observation',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation']],
        'status' => 'final',
        'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/observation-category', 'code' => 'vital-signs', 'display' => 'Vital Signs']]]],
        'code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '85354-9', 'display' => 'Blood pressure panel with all children optional']]],
        'subject' => ['reference' => $patientUuid],
        'encounter' => ['reference' => $encounterUuid],
        'effectiveDateTime' => $nowIso,
        'component' => [
            ['code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '8480-6', 'display' => 'Systolic blood pressure']]], 'valueQuantity' => ['value' => $vitalBpSystolic, 'unit' => 'mmHg', 'system' => 'http://unitsofmeasure.org', 'code' => 'mm[Hg]']],
            ['code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '8462-4', 'display' => 'Diastolic blood pressure']]], 'valueQuantity' => ['value' => $vitalBpDiastolic, 'unit' => 'mmHg', 'system' => 'http://unitsofmeasure.org', 'code' => 'mm[Hg]']],
        ],
    ] : null,
    $vitalHr !== null ? fg7VitalObservation('8867-4', 'Heart rate', $vitalHr, 'beats/minute', '/min', $patientUuid, $encounterUuid, $nowIso) : null,
    $vitalRr !== null ? fg7VitalObservation('9279-1', 'Respiratory rate', $vitalRr, 'breaths/minute', '/min', $patientUuid, $encounterUuid, $nowIso) : null,
    $vitalO2sat !== null ? fg7VitalObservation('2708-6', 'Oxygen saturation in Arterial blood', $vitalO2sat, '%', '%', $patientUuid, $encounterUuid, $nowIso) : null,
    $vitalTempC !== null ? fg7VitalObservation('8310-5', 'Body temperature', $vitalTempC, 'Celsius', 'Cel', $patientUuid, $encounterUuid, $nowIso) : null,
    $vitalWeightKg !== null ? fg7VitalObservation('29463-7', 'Body weight', $vitalWeightKg, 'kg', 'kg', $patientUuid, $encounterUuid, $nowIso) : null,
];

$observationEntries = [];
foreach (array_filter($vitalDefs) as $obsResource) {
    $observationEntries[] = ['uuid' => 'urn:uuid:' . fg7GenUuidV4(), 'resource' => $obsResource];
}

// Practitioner
$practitionerResource = [
    'resourceType' => 'Practitioner',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
    'identifier' => [[
        'system' => FG7_ID_SYSTEM,
        'value' => FG7_ID_PREFIX . 'PRACTITIONER-' . md5($practitionerName),
    ]],
    'name' => [['text' => $practitionerName, 'family' => explode(' ', $practitionerName)[0] ?? $practitionerName]],
    'active' => true,
];

// Sending PractitionerRole (our demo org's practitioner)
$sendingRoleResource = [
    'resourceType' => 'PractitionerRole',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
    'practitioner' => ['reference' => $practitionerUuid],
    'organization' => ['reference' => $sendingOrgUuid],
    'code' => [fg7PractitionerRoleCoding($practitionerRole)],
];

// Receiving PractitionerRole (generic receiver)
$receivingRoleResource = [
    'resourceType' => 'PractitionerRole',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
    'organization' => ['reference' => $receivingOrgUuid],
    'code' => [fg7PractitionerRoleCoding('doctor')],
];

// ServiceRequest
$serviceRequestResource = [
    'resourceType' => 'ServiceRequest',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request']],
    'status' => 'active',
    'intent' => 'order',
    'priority' => fg7ReferralPriority($category),
    'category' => [fg7ReferralCategoryCoding($category)],
    'code' => ['coding' => [['system' => 'http://snomed.info/sct', 'code' => '3457005', 'display' => 'Patient referral']], 'text' => 'eReferral'],
    'subject' => ['reference' => $patientUuid],
    'encounter' => ['reference' => $encounterUuid],
    'occurrenceDateTime' => $nowIso,
    'authoredOn' => $nowIso,
    'requester' => ['reference' => $sendingRoleUuid],
    'performer' => [['reference' => $receivingRoleUuid]],
    'reasonCode' => [fg7ServiceTypeCoding($serviceType)],
    'reasonReference' => [['reference' => $diagConditionUuid]],
    'note' => [['text' => $reason]],
];
if ($sourceServiceRequestId !== '') {
    $serviceRequestResource['basedOn'] = [['reference' => "ServiceRequest/$sourceServiceRequestId"]];
}

// Task (referral tracking) -- ereferral-task profile requires Task.requester
// (verified live via a 422: "Task.requester: minimum required = 1, but only found 0"),
// same fields the main app's Task already carries.
$taskResource = [
    'resourceType' => 'Task',
    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task']],
    'status' => 'requested',
    'intent' => 'order',
    'code' => ['coding' => [['system' => 'http://snomed.info/sct', 'code' => '3457005', 'display' => 'Patient referral']], 'text' => 'eReferral (FACILITY-GROUP-7 demo)'],
    'focus' => ['reference' => $serviceRequestUuid],
    'for' => ['reference' => $patientUuid],
    'authoredOn' => $nowIso,
    'lastModified' => $nowIso,
    'requester' => ['reference' => $sendingRoleUuid],
    'owner' => ['reference' => $receivingRoleUuid],
];

// Build bundle (Patient and receiving Organization already exist on the server -- referenced directly, not re-created)
$entries = [];
$entries[] = ['fullUrl' => $encounterUuid, 'resource' => $encounterResource, 'request' => ['method' => 'POST', 'url' => 'Encounter']];
$entries[] = ['fullUrl' => $ccConditionUuid, 'resource' => $ccConditionResource, 'request' => ['method' => 'POST', 'url' => 'Condition']];
$entries[] = ['fullUrl' => $diagConditionUuid, 'resource' => $diagConditionResource, 'request' => ['method' => 'POST', 'url' => 'Condition']];
foreach ($observationEntries as $obs) {
    $entries[] = ['fullUrl' => $obs['uuid'], 'resource' => $obs['resource'], 'request' => ['method' => 'POST', 'url' => 'Observation']];
}
if ($practitionerRoleId === '') {
    $entries[] = ['fullUrl' => $practitionerUuid, 'resource' => $practitionerResource, 'request' => ['method' => 'POST', 'url' => 'Practitioner']];
    $entries[] = ['fullUrl' => $sendingRoleUuid, 'resource' => $sendingRoleResource, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']];
}
$entries[] = ['fullUrl' => $receivingRoleUuid, 'resource' => $receivingRoleResource, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']];
$entries[] = ['fullUrl' => $serviceRequestUuid, 'resource' => $serviceRequestResource, 'request' => ['method' => 'POST', 'url' => 'ServiceRequest']];
$entries[] = ['fullUrl' => $taskUuid, 'resource' => $taskResource, 'request' => ['method' => 'POST', 'url' => 'Task']];

$bundle = [
    'resourceType' => 'Bundle',
    'type' => 'transaction',
    'timestamp' => $nowIso,
    'entry' => $entries,
];

// Check if dry_run
$dryRun = (bool)($body['dry_run'] ?? false);
if ($dryRun) {
    sendJsonResponse([
        'success' => true,
        'bundle' => $bundle,
        'message' => 'Preview bundle (dry run, not sent)',
    ]);
}

// Send to sandbox
[$code, $response, $errno, $err] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, '', json_encode($bundle));

if ($errno || $code < 200 || $code >= 300) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Could not send referral to FHIR server',
        'http_status' => $code,
        'error' => $err,
        'sandbox_response' => $response,
    ], $code ?: 502);
}

$serviceRequestRef = null;
foreach (($response['entry'] ?? []) as $i => $entry) {
    if (($bundle['entry'][$i]['resource']['resourceType'] ?? '') === 'ServiceRequest') {
        $serviceRequestRef = $entry['response']['location'] ?? null;
        break;
    }
}

sendJsonResponse([
    'success' => true,
    'message' => 'Referral sent successfully',
    'service_request_ref' => $serviceRequestRef,
    'bundle_response' => $response,
]);
