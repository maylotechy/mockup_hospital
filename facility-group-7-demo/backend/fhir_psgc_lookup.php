<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- PSGC Cascading Lookup
// Look up regions, provinces, cities, barangays via terminology server
//
// NOTE: tx.fhirlab.net does not support CodeSystem/$expand or a plain
// filter=parent=X text search (verified live -- both return errors or
// empty results). The only mechanism that actually works is a POST to
// ValueSet/$expand with a Parameters body carrying a structured
// compose.include.filter {property: "parent", op: "=", value: code}.
// Confirmed live against real codes (e.g. Region XII -> South Cotabato
// -> City of Koronadal -> Assumption barangay all round-trip correctly).
//
// NOTE 2: the server hosts TWO CodeSystems under the same canonical url
// (https://psa.gov.ph/classification/psgc) -- the full one (id "PSGC",
// version "1Q-2026", 43769 concepts) and a sparse connectathon demo
// subset (id "psgc-r12-mini", version "2Q-2026", only a couple of
// barangays under some cities). Version resolution picks the mini one
// by default (confirmed live: General Santos returned only 2 of its 26
// barangays, NCR returned 0 cities). Pinning "version" explicitly to
// FG7_PSGC_DATASET_VERSION forces the full dataset and fixes this.
// ========================================================

require_once __DIR__ . '/config.php';

$level = trim($_GET['level'] ?? '');
$parent = trim($_GET['parent'] ?? '');

// The 18 current PH regions, verified live via filter=Region text search
// against tx.fhirlab.net (ValueSet/psgc) -- hardcoded since regions never
// change mid-project and this avoids an extra round trip for the top level.
$REGIONS = [
    ['code' => '0100000000', 'display' => 'Region I (Ilocos Region)'],
    ['code' => '0200000000', 'display' => 'Region II (Cagayan Valley)'],
    ['code' => '0300000000', 'display' => 'Region III (Central Luzon)'],
    ['code' => '0400000000', 'display' => 'Region IV-A (CALABARZON)'],
    ['code' => '1700000000', 'display' => 'MIMAROPA Region'],
    ['code' => '0500000000', 'display' => 'Region V (Bicol Region)'],
    ['code' => '0600000000', 'display' => 'Region VI (Western Visayas)'],
    ['code' => '0700000000', 'display' => 'Region VII (Central Visayas)'],
    ['code' => '0800000000', 'display' => 'Region VIII (Eastern Visayas)'],
    ['code' => '0900000000', 'display' => 'Region IX (Zamboanga Peninsula)'],
    ['code' => '1000000000', 'display' => 'Region X (Northern Mindanao)'],
    ['code' => '1100000000', 'display' => 'Region XI (Davao Region)'],
    ['code' => '1200000000', 'display' => 'Region XII (SOCCSKSARGEN)'],
    ['code' => '1300000000', 'display' => 'National Capital Region (NCR)'],
    ['code' => '1400000000', 'display' => 'Cordillera Administrative Region (CAR)'],
    ['code' => '1600000000', 'display' => 'Region XIII (Caraga)'],
    ['code' => '1800000000', 'display' => 'Negros Island Region (NIR)'],
    ['code' => '1900000000', 'display' => 'Bangsamoro Autonomous Region In Muslim Mindanao (BARMM)'],
];

function fg7PsgcChildren(string $parentCode): array {
    $params = [
        'resourceType' => 'Parameters',
        'parameter' => [
            [
                'name' => 'valueSet',
                'resource' => [
                    'resourceType' => 'ValueSet',
                    'compose' => [
                        'include' => [[
                            'system' => FG7_PSGC_CODING_SYSTEM,
                            'version' => FG7_PSGC_DATASET_VERSION,
                            'filter' => [['property' => 'parent', 'op' => '=', 'value' => $parentCode]],
                        ]],
                    ],
                ],
            ],
            ['name' => 'count', 'valueInteger' => 300],
        ],
    ];

    [$code, $response, $errno, $err] = sendFhirRequest(
        'POST', FG7_TX_BASE_URL, 'ValueSet/$expand', json_encode($params)
    );

    if ($errno || $code < 200 || $code >= 300) {
        return [false, [], $code, $err];
    }

    $results = [];
    foreach (($response['expansion']['contains'] ?? []) as $concept) {
        $results[] = [
            'code' => $concept['code'] ?? null,
            'display' => $concept['display'] ?? '(no display)',
        ];
    }
    return [true, $results, $code, null];
}

if ($level === 'regions') {
    sendJsonResponse([
        'success' => true,
        'level' => 'regions',
        'results' => $REGIONS,
    ]);

} elseif (in_array($level, ['provinces', 'cities', 'barangays'], true)) {
    if (!$parent) {
        sendJsonResponse(['success' => false, 'message' => 'Missing parent query parameter'], 400);
    }

    [$ok, $results, $httpCode, $err] = fg7PsgcChildren($parent);

    if (!$ok) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not fetch from terminology server',
            'http_status' => $httpCode,
            'error' => $err,
        ], $httpCode ?: 502);
    }

    sendJsonResponse([
        'success' => true,
        'level' => $level,
        'parent' => $parent,
        'results' => $results,
    ]);

} else {
    sendJsonResponse([
        'success' => false,
        'message' => 'Use level=regions, level=provinces&parent={regionCode}, level=cities&parent={provinceCode}, or level=barangays&parent={cityCode}',
    ], 400);
}
