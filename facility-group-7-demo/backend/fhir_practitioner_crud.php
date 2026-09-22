<?php
// FACILITY-GROUP-7 Demo -- organization practitioners
// Practitioner stores the person; PractitionerRole links that person to an organization.

require_once __DIR__ . '/config.php';

$action = trim($_GET['action'] ?? '');

if ($action === 'create') {
    $body = json_decode(file_get_contents('php://input'), true) ?? [];
    $orgId = trim($body['organization_id'] ?? '');
    $given = trim($body['given'] ?? '');
    $family = trim($body['family'] ?? '');
    $prefix = trim($body['prefix'] ?? '');
    $role = trim($body['role'] ?? '');
    $license = trim($body['license_number'] ?? '');

    if (!$orgId || !$given || !$family || !$role) {
        sendJsonResponse(['success' => false, 'message' => 'Organization, first name, last name, and role are required.'], 400);
    }

    [$orgCode, $org] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Organization/' . urlencode($orgId));
    if ($orgCode < 200 || $orgCode >= 300 || ($org['resourceType'] ?? '') !== 'Organization') {
        sendJsonResponse(['success' => false, 'message' => 'Organization was not found on the FHIR server.'], 404);
    }

    $practitionerUuid = 'urn:uuid:' . fg7GenUuidV4();
    $roleUuid = 'urn:uuid:' . fg7GenUuidV4();
    $displayName = trim(($prefix ? "$prefix " : '') . "$given $family");
    $identifiers = [[
        'system' => FG7_ID_SYSTEM,
        'value' => FG7_ID_PREFIX . 'PRACTITIONER-' . fg7GenUuidV4(),
    ]];
    if ($license !== '') {
        $identifiers[] = [
            'system' => 'https://facility-group-7-demo/fhir/practitioner-license',
            'value' => $license,
        ];
    }

    $name = ['use' => 'official', 'text' => $displayName, 'family' => $family, 'given' => [$given]];
    if ($prefix !== '') $name['prefix'] = [$prefix];

    $bundle = [
        'resourceType' => 'Bundle',
        'type' => 'transaction',
        'entry' => [
            [
                'fullUrl' => $practitionerUuid,
                'resource' => [
                    'resourceType' => 'Practitioner',
                    'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
                    'identifier' => $identifiers,
                    'active' => true,
                    'name' => [$name],
                ],
                'request' => ['method' => 'POST', 'url' => 'Practitioner'],
            ],
            [
                'fullUrl' => $roleUuid,
                'resource' => [
                    'resourceType' => 'PractitionerRole',
                    'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
                    'active' => true,
                    'practitioner' => ['reference' => $practitionerUuid, 'display' => $displayName],
                    'organization' => ['reference' => "Organization/$orgId", 'display' => $org['name'] ?? null],
                    'code' => [fg7PractitionerRoleCoding($role)],
                ],
                'request' => ['method' => 'POST', 'url' => 'PractitionerRole'],
            ],
        ],
    ];

    [$code, $response, $errno, $err] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, '', json_encode($bundle));
    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not register practitioner', 'http_status' => $code, 'error' => $err, 'sandbox_response' => $response], $code ?: 502);
    }

    $practitionerLocation = $response['entry'][0]['response']['location'] ?? null;
    $roleLocation = $response['entry'][1]['response']['location'] ?? null;
    sendJsonResponse([
        'success' => true,
        'message' => 'Practitioner added to the organization',
        'practitioner_id' => $practitionerLocation ? explode('/', $practitionerLocation)[1] ?? null : null,
        'practitioner_role_id' => $roleLocation ? explode('/', $roleLocation)[1] ?? null : null,
    ]);
}

if ($action === 'list') {
    $orgId = trim($_GET['org_id'] ?? '');
    if (!$orgId) sendJsonResponse(['success' => false, 'message' => 'Provide org_id.'], 400);

    $url = 'PractitionerRole?organization=' . rawurlencode("Organization/$orgId")
        . '&_include=PractitionerRole:practitioner&_count=100';
    [$code, $response, $errno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $url);
    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse(['success' => false, 'message' => 'Could not load organization practitioners', 'http_status' => $code], $code ?: 502);
    }

    $practitionersById = [];
    $roles = [];
    foreach (($response['entry'] ?? []) as $entry) {
        $resource = $entry['resource'] ?? [];
        if (($resource['resourceType'] ?? '') === 'Practitioner' && !empty($resource['id'])) {
            $practitionersById[$resource['id']] = $resource;
        } elseif (($resource['resourceType'] ?? '') === 'PractitionerRole') {
            $roles[] = $resource;
        }
    }

    $results = [];
    foreach ($roles as $roleResource) {
        $practitionerId = fg7RefId($roleResource['practitioner']['reference'] ?? null);
        if (!$practitionerId) continue; // Skip generic receiving roles.
        if (!isset($practitionersById[$practitionerId])) {
            [$pCode, $pResource] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Practitioner/' . urlencode($practitionerId));
            if ($pCode >= 200 && $pCode < 300 && ($pResource['resourceType'] ?? '') === 'Practitioner') {
                $practitionersById[$practitionerId] = $pResource;
            }
        }
        $practitioner = $practitionersById[$practitionerId] ?? [];
        if (!$practitioner) continue;

        $license = null;
        foreach (($practitioner['identifier'] ?? []) as $identifier) {
            if (($identifier['system'] ?? '') === 'https://facility-group-7-demo/fhir/practitioner-license') {
                $license = $identifier['value'] ?? null;
            }
        }
        $coding = $roleResource['code'][0]['coding'][0] ?? [];
        $roleKeyByCode = [
            '158965000' => 'doctor', '265937000' => 'nurse', '309453006' => 'midwife',
            '46255001' => 'pharmacist', '386629007' => 'medtech', '159282002' => 'labaide',
            '106289002' => 'dentist', '4162009' => 'dentalaide', '28229004' => 'optometrist',
            '3253' => 'bhw', 'PCW' => 'pcw',
        ];
        $results[] = [
            'practitioner_id' => $practitionerId,
            'practitioner_role_id' => $roleResource['id'] ?? null,
            'name' => fg7HumanName($practitioner['name'] ?? null) ?? ($roleResource['practitioner']['display'] ?? 'Unknown practitioner'),
            'role_code' => $coding['code'] ?? null,
            'role_key' => $roleKeyByCode[$coding['code'] ?? ''] ?? 'doctor',
            'role_display' => $roleResource['code'][0]['text'] ?? ($coding['display'] ?? 'Unknown role'),
            'license_number' => $license,
        ];
    }

    sendJsonResponse(['success' => true, 'practitioners' => $results, 'total' => count($results)]);
}

sendJsonResponse(['success' => false, 'message' => 'Unknown action. Use create or list.'], 400);
