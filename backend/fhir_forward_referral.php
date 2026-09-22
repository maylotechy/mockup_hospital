<?php
// Creates a new onward eReferral while leaving the received referral untouched.
// The new ServiceRequest references the same Patient, Encounter, and clinical
// resources and points back to the received ServiceRequest through basedOn.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    sendJsonResponse(['success' => false, 'message' => 'Invalid request method. Only POST is allowed.'], 405);
}

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['doctor', 'nurse']);

$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = $_POST;

$sourceId = trim((string)($input['source_service_request_id'] ?? ''));
$targetOrgRef = trim((string)($input['receiving_org_ref'] ?? ''));
$targetOrgName = mb_substr(trim((string)($input['receiving_org_display_name'] ?? '')), 0, 255);
$dryRun = !empty($input['dry_run']);

if (!preg_match('/^[A-Za-z0-9\-.]{1,64}$/', $sourceId)) {
    sendJsonResponse(['success' => false, 'message' => 'Missing or invalid source ServiceRequest ID.'], 422);
}
if (!preg_match('#^Organization/[A-Za-z0-9\-.]{1,64}$#', $targetOrgRef)) {
    sendJsonResponse(['success' => false, 'message' => 'Please select a valid receiving Organization.'], 422);
}

try {
    $pdo = getDbConnection();
    $facilityStmt = $pdo->prepare('SELECT id, name, fhir_organization_id FROM facilities WHERE id = :id');
    $facilityStmt->execute([':id' => (int)($user['facility']['id'] ?? 0)]);
    $facility = $facilityStmt->fetch();
    $ourOrgRef = trim((string)($facility['fhir_organization_id'] ?? ''));

    if (!preg_match('#^Organization/[A-Za-z0-9\-.]{1,64}$#', $ourOrgRef)) {
        sendJsonResponse(['success' => false, 'message' => 'Register your facility as a FHIR Organization before referring onward.'], 422);
    }
    if ($targetOrgRef === $ourOrgRef) {
        sendJsonResponse(['success' => false, 'message' => 'The receiving hospital must be different from your own facility.'], 422);
    }

    // Resolve the selected destination server-side. The display name supplied by
    // the browser is convenience data only and is never trusted as proof that an
    // Organization exists.
    [$targetCode, $targetOrg, $targetErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $targetOrgRef);
    if ($targetErrno || $targetCode < 200 || $targetCode >= 300 || !is_array($targetOrg) || ($targetOrg['resourceType'] ?? '') !== 'Organization') {
        sendJsonResponse(['success' => false, 'message' => 'The selected receiving Organization could not be found on the FHIR sandbox.'], 422);
    }
    $targetOrgName = mb_substr(trim((string)($targetOrg['name'] ?? $targetOrgName)), 0, 255);

    // Server-side re-fetch prevents a browser from replacing the received
    // clinical data with a different payload.
    $detail = fetchFhirReferralDetail($sourceId);
    if (!$detail['success']) {
        sendJsonResponse($detail, $detail['http_status'] ?? 502);
    }
    if (!fhirServiceRequestTargetsOrganization($detail['service_request'] ?? [], $ourOrgRef)) {
        sendJsonResponse(['success' => false, 'message' => 'This referral was not addressed to your facility and cannot be referred onward here.'], 403);
    }

    $bundle = buildFhirOnwardReferralBundle($detail, $sourceId, $targetOrgRef, $user, $ourOrgRef);

    if ($dryRun) {
        sendJsonResponse([
            'success' => true,
            'dry_run' => true,
            'endpoint' => FHIR_EREFERRAL_BASE_URL,
            'source_service_request_ref' => 'ServiceRequest/' . $sourceId,
            'receiving_org_ref' => $targetOrgRef,
            'receiving_org_name' => $targetOrgName,
            'bundle_sent' => $bundle,
            'message' => 'Preview only -- nothing was sent to the sandbox.',
        ]);
    }

    $bundleJson = json_encode($bundle, JSON_UNESCAPED_SLASHES);
    [$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, '', $bundleJson);
    $isSuccess = !$curlErrno && $httpCode >= 200 && $httpCode < 300;
    $createdRef = $isSuccess
        ? fhirExtractCreatedRef($bundle, is_array($response) ? $response : null, 'ServiceRequest')
        : null;

    if ($isSuccess) {
        $patientName = fhirHumanName($detail['patient']['name'] ?? null) ?? 'Unknown patient';
        logAuditEvent(
            $user,
            'FHIR_REFERRAL_FORWARDED',
            null,
            $patientName,
            'From ServiceRequest/' . $sourceId . ' to ' . $targetOrgRef . ($targetOrgName !== '' ? ' (' . $targetOrgName . ')' : '')
        );
    }

    sendJsonResponse([
        'success' => $isSuccess,
        'dry_run' => false,
        'http_status' => $httpCode,
        'curl_error' => $curlErrno ? $curlError : null,
        'endpoint' => FHIR_EREFERRAL_BASE_URL,
        'source_service_request_ref' => 'ServiceRequest/' . $sourceId,
        'service_request_ref' => $createdRef,
        'receiving_org_ref' => $targetOrgRef,
        'receiving_org_name' => $targetOrgName,
        'bundle_sent' => $bundle,
        'sandbox_response' => $response,
    ], $isSuccess ? 200 : ($httpCode ?: 502));
} catch (Throwable $e) {
    sendJsonResponse(['success' => false, 'message' => 'Could not build/send the onward FHIR referral: ' . $e->getMessage()], 500);
}

function fhirServiceRequestTargetsOrganization(array $serviceRequest, string $organizationRef): bool {
    foreach (($serviceRequest['performer'] ?? []) as $performer) {
        $ref = (string)($performer['reference'] ?? '');
        if ($ref === $organizationRef) return true;
        if (!preg_match('#^PractitionerRole/[A-Za-z0-9\-.]{1,64}$#', $ref)) continue;
        [$code, $role, $errno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $ref);
        if (!$errno && $code >= 200 && $code < 300 && is_array($role) && ($role['organization']['reference'] ?? null) === $organizationRef) {
            return true;
        }
    }
    return false;
}

function buildFhirOnwardReferralBundle(array $detail, string $sourceId, string $targetOrgRef, array $user, string $ourOrgRef): array {
    $original = $detail['service_request'] ?? [];
    $patientRef = $original['subject']['reference'] ?? '';
    if (!preg_match('#^Patient/[A-Za-z0-9\-.]{1,64}$#', $patientRef)) {
        throw new RuntimeException('The received referral does not contain a valid Patient reference.');
    }

    $now = gmdate('c');
    $sendingPractitionerUuid = 'urn:uuid:' . genFhirUuidV4();
    $receivingPractitionerUuid = 'urn:uuid:' . genFhirUuidV4();
    $sendingRoleUuid = 'urn:uuid:' . genFhirUuidV4();
    $receivingRoleUuid = 'urn:uuid:' . genFhirUuidV4();
    $serviceRequestUuid = 'urn:uuid:' . genFhirUuidV4();
    $taskUuid = 'urn:uuid:' . genFhirUuidV4();
    $provenanceUuid = 'urn:uuid:' . genFhirUuidV4();
    $userId = (string)($user['id'] ?? 'unknown');

    $sendingPractitioner = [
        'resourceType' => 'Practitioner',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
        'identifier' => [['system' => FHIR_TEST_ID_SYSTEM, 'value' => FHIR_TEST_ID_PREFIX . 'PRACTITIONER-' . $userId]],
        'name' => [['use' => 'official', 'text' => FHIR_TEST_NAME_PREFIX . ($user['full_name'] ?? 'Unknown')]],
    ];
    $receivingPractitioner = [
        'resourceType' => 'Practitioner',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
        'identifier' => [['system' => FHIR_TEST_ID_SYSTEM, 'value' => FHIR_TEST_ID_PREFIX . 'PRACTITIONER-PLACEHOLDER-RECEIVING']],
        'name' => [['use' => 'official', 'text' => FHIR_TEST_NAME_PREFIX . 'PlaceholderReceivingPractitioner']],
    ];
    $sendingRole = [
        'resourceType' => 'PractitionerRole',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
        'practitioner' => ['reference' => $sendingPractitionerUuid],
        'organization' => ['reference' => $ourOrgRef],
        'code' => [fhirPractitionerRoleCoding((string)($user['role'] ?? 'doctor'))],
    ];
    $receivingRole = [
        'resourceType' => 'PractitionerRole',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
        'practitioner' => ['reference' => $receivingPractitionerUuid],
        'organization' => ['reference' => $targetOrgRef],
        'code' => [fhirPractitionerRoleCoding('doctor')],
    ];

    $serviceRequest = [
        'resourceType' => 'ServiceRequest',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request']],
        'status' => 'active',
        'intent' => 'order',
        'basedOn' => [['reference' => 'ServiceRequest/' . $sourceId]],
        'subject' => ['reference' => $patientRef],
        'occurrenceDateTime' => $now,
        'authoredOn' => $now,
        'requester' => ['reference' => $sendingRoleUuid],
        'performer' => [['reference' => $receivingRoleUuid]],
    ];
    foreach (['category', 'priority', 'encounter', 'reasonCode', 'reasonReference', 'note'] as $field) {
        if (array_key_exists($field, $original)) $serviceRequest[$field] = $original[$field];
    }

    $supportingInfo = [];
    foreach (['conditions', 'observations', 'procedures', 'diagnostic_reports'] as $key) {
        foreach (($detail[$key] ?? []) as $resource) {
            $type = $resource['resourceType'] ?? '';
            $id = $resource['id'] ?? '';
            if (preg_match('/^[A-Za-z][A-Za-z0-9]+$/', $type) && preg_match('/^[A-Za-z0-9\-.]{1,64}$/', $id)) {
                $supportingInfo[] = ['reference' => $type . '/' . $id];
            }
        }
    }
    if ($supportingInfo) $serviceRequest['supportingInfo'] = $supportingInfo;

    $task = [
        'resourceType' => 'Task',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task']],
        'status' => 'requested',
        'intent' => 'order',
        'code' => ['coding' => [['system' => 'http://snomed.info/sct', 'code' => '3457005', 'display' => 'Patient referral']], 'text' => 'Onward eReferral (mock_hospitals FHIR Connectathon test)'],
        'focus' => ['reference' => $serviceRequestUuid],
        'for' => ['reference' => $patientRef],
        'authoredOn' => $now,
        'lastModified' => $now,
        'requester' => ['reference' => $sendingRoleUuid],
        'owner' => ['reference' => $receivingRoleUuid],
        'note' => [['text' => 'Onward referral based on ServiceRequest/' . $sourceId]],
    ];
    $provenance = [
        'resourceType' => 'Provenance',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-provenance']],
        'target' => [['reference' => $serviceRequestUuid]],
        'recorded' => $now,
        'activity' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', 'code' => 'CREATE', 'display' => 'create']]],
        'agent' => [[
            'type' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', 'code' => 'author', 'display' => 'Author']]],
            'who' => ['reference' => $sendingRoleUuid],
            'onBehalfOf' => ['reference' => $ourOrgRef],
        ]],
    ];

    return [
        'resourceType' => 'Bundle',
        'type' => 'transaction',
        'timestamp' => $now,
        'entry' => [
            ['fullUrl' => $sendingPractitionerUuid, 'resource' => $sendingPractitioner, 'request' => ['method' => 'PUT', 'url' => 'Practitioner?identifier=' . FHIR_TEST_ID_SYSTEM . '|' . FHIR_TEST_ID_PREFIX . 'PRACTITIONER-' . $userId]],
            ['fullUrl' => $receivingPractitionerUuid, 'resource' => $receivingPractitioner, 'request' => ['method' => 'PUT', 'url' => 'Practitioner?identifier=' . FHIR_TEST_ID_SYSTEM . '|' . FHIR_TEST_ID_PREFIX . 'PRACTITIONER-PLACEHOLDER-RECEIVING']],
            ['fullUrl' => $sendingRoleUuid, 'resource' => $sendingRole, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']],
            ['fullUrl' => $receivingRoleUuid, 'resource' => $receivingRole, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']],
            ['fullUrl' => $serviceRequestUuid, 'resource' => $serviceRequest, 'request' => ['method' => 'POST', 'url' => 'ServiceRequest']],
            ['fullUrl' => $taskUuid, 'resource' => $task, 'request' => ['method' => 'POST', 'url' => 'Task']],
            ['fullUrl' => $provenanceUuid, 'resource' => $provenance, 'request' => ['method' => 'POST', 'url' => 'Provenance']],
        ],
    ];
}
