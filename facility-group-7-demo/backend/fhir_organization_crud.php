<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Organization CRUD
// Register and search organizations on FHIR sandbox
// ========================================================

require_once __DIR__ . '/config.php';

$action = trim($_GET['action'] ?? '');

if ($action === 'register') {
    // POST: Register our demo organization (conditional PUT, upsert by our identifier)
    $identifierValue = FG7_ID_PREFIX . 'ORG-DEMO';

    $orgResource = [
        'resourceType' => 'Organization',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization']],
        'identifier' => [[
            'system' => FG7_ID_SYSTEM,
            'value' => $identifierValue,
        ]],
        'name' => FG7_ORG_NAME,
        'alias' => ['FG7-Demo'],
        'address' => [['text' => FG7_ORG_ADDRESS, 'country' => 'PH']],
    ];

    $conditionalUrl = 'Organization?identifier=' . FG7_ID_SYSTEM . '|' . $identifierValue;

    [$code, $response, $errno, $err] = sendFhirRequest('PUT', FHIR_EREFERRAL_BASE_URL, $conditionalUrl, json_encode($orgResource));

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not register organization on FHIR server',
            'http_status' => $code,
            'error' => $err,
        ], $code ?: 502);
    }

    $orgId = $response['id'] ?? null;
    sendJsonResponse([
        'success' => true,
        'org_id' => $orgId,
        'org_ref' => "Organization/$orgId",
        'org_name' => FG7_ORG_NAME,
        'message' => "Organization registered with id: $orgId",
    ]);

} elseif ($action === 'list') {
    // GET: Browse all organizations on sandbox (simplified, like Connectathon)
    //
    // _count must comfortably exceed the sandbox's total Organization count,
    // not just be "big enough for us" -- this is a shared Connectathon sandbox
    // every team writes to, so a plain "top N most recently updated" window
    // is a moving target: an org that's in the window on one request can drop
    // out of it moments later purely from OTHER teams' unrelated writes.
    // Verified live: the server has no hard cap and returned all 176
    // Organizations currently on the sandbox for a single _count=300/500
    // request (no pagination needed) -- confirmed this is what caused DIWA
    // Center to appear in the Organizations table but not always in the
    // Send Referral dropdown, since both call this endpoint independently
    // and _count=100 was smaller than the then-current total.
    [$code, $response, $errno, $err] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Organization?_count=500&_sort=-_lastUpdated');

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not fetch organizations from FHIR server',
            'http_status' => $code,
        ], $code ?: 502);
    }

    $organizations = [];
    foreach (($response['entry'] ?? []) as $entry) {
        $res = $entry['resource'] ?? [];
        if (($res['resourceType'] ?? '') !== 'Organization') continue;

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
        'organizations' => $organizations,
        'total' => count($organizations),
    ]);

} elseif ($action === 'search') {
    // GET: Search organizations by name (query parameter)
    $query = trim($_GET['query'] ?? '');
    if (!$query) {
        sendJsonResponse(['success' => false, 'message' => 'Missing query parameter'], 400);
    }

    [$code, $response, $errno, $err] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Organization?name=' . urlencode($query) . '&_count=20');

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not search organizations',
            'http_status' => $code,
        ], $code ?: 502);
    }

    $organizations = [];
    foreach (($response['entry'] ?? []) as $entry) {
        $res = $entry['resource'] ?? [];
        if (($res['resourceType'] ?? '') !== 'Organization') continue;

        $organizations[] = [
            'id' => $res['id'] ?? null,
            'name' => $res['name'] ?? '(no name)',
            'identifiers' => array_map(
                fn($i) => trim(($i['system'] ?? '') . '|' . ($i['value'] ?? ''), '|'),
                $res['identifier'] ?? []
            ),
        ];
    }

    sendJsonResponse([
        'success' => true,
        'query' => $query,
        'organizations' => $organizations,
    ]);

} else {
    sendJsonResponse(['success' => false, 'message' => 'Unknown action. Use action=register, action=list, or action=search'], 400);
}
