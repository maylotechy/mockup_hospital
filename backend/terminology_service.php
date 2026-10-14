<?php

function terminologyRegistry(): array {
    return [
        'diagnosis' => [
            'url' => 'https://irdss.gov.ph/fhir/ValueSet/referral-diagnosis',
            'version' => '0.1.0',
            'file' => __DIR__ . '/../terminology/ValueSet-irdss-referral-diagnosis.json',
        ],
        'chief-complaint' => [
            'url' => 'https://irdss.gov.ph/fhir/ValueSet/chief-complaint',
            'version' => '0.1.0',
            'file' => __DIR__ . '/../terminology/ValueSet-irdss-chief-complaint.json',
        ],
    ];
}

function loadTerminologySnapshot(string $valueSetKey): array {
    $registry = terminologyRegistry();
    if (!isset($registry[$valueSetKey])) {
        throw new InvalidArgumentException("Unsupported ValueSet '{$valueSetKey}'.");
    }

    $definition = $registry[$valueSetKey];
    $raw = @file_get_contents($definition['file']);
    $resource = $raw !== false ? json_decode($raw, true) : null;
    if (!is_array($resource)) {
        throw new RuntimeException('Controlled terminology snapshot is unavailable.');
    }
    if (($resource['url'] ?? null) !== $definition['url'] ||
        ($resource['version'] ?? null) !== $definition['version']) {
        throw new RuntimeException('Controlled terminology snapshot version mismatch.');
    }
    return [$definition, $resource];
}

function snapshotTerminologyConcepts(string $valueSetKey): array {
    [, $resource] = loadTerminologySnapshot($valueSetKey);
    $concepts = [];
    foreach (($resource['compose']['include'] ?? []) as $include) {
        $system = $include['system'] ?? null;
        foreach (($include['concept'] ?? []) as $concept) {
            if (!$system || empty($concept['code']) || empty($concept['display'])) {
                continue;
            }
            $concepts[] = [
                'system' => $system,
                'code' => (string)$concept['code'],
                'display' => (string)$concept['display'],
            ];
        }
    }
    return $concepts;
}

function searchTerminologySnapshot(string $valueSetKey, string $query, int $count = 20): array {
    [$definition] = loadTerminologySnapshot($valueSetKey);
    $needle = mb_strtolower(trim($query));
    $matches = array_values(array_filter(
        snapshotTerminologyConcepts($valueSetKey),
        static function (array $concept) use ($needle): bool {
            return $needle === '' ||
                str_contains(mb_strtolower($concept['display']), $needle) ||
                str_contains(mb_strtolower($concept['code']), $needle);
        }
    ));

    return [
        'value_set' => $valueSetKey,
        'url' => $definition['url'],
        'version' => $definition['version'],
        'source' => 'snapshot',
        'degraded' => true,
        'concepts' => array_slice($matches, 0, max(1, min($count, 50))),
    ];
}

function validateTerminologySnapshot(
    string $valueSetKey,
    string $system,
    string $code
): array {
    [$definition] = loadTerminologySnapshot($valueSetKey);
    $match = null;
    foreach (snapshotTerminologyConcepts($valueSetKey) as $concept) {
        if ($concept['system'] === $system && $concept['code'] === $code) {
            $match = $concept;
            break;
        }
    }

    return [
        'value_set' => $valueSetKey,
        'url' => $definition['url'],
        'version' => $definition['version'],
        'valid' => $match !== null,
        'system' => $system,
        'code' => $code,
        'display' => $match['display'] ?? null,
        'message' => $match ? null : 'Code is outside the configured ValueSet.',
        'source' => 'snapshot',
        'degraded' => true,
    ];
}

function resolveClinicalDiagnosis(array $input): array {
    $text = trim((string)($input['diagnosis_text'] ?? $input['diagnosis'] ?? ''));
    $system = trim((string)($input['diagnosis_system'] ?? ''));
    $code = trim((string)($input['diagnosis_code'] ?? ''));
    if (mb_strlen($text) > 2000 || strlen($system) > 255 || strlen($code) > 100) {
        throw new InvalidArgumentException('Diagnosis exceeds the allowed length.');
    }
    $display = null;
    if ($system !== '' || $code !== '') {
        if ($system === '' || $code === '') {
            throw new InvalidArgumentException('Select a diagnosis again or use text only.');
        }
        $result = validateTerminologySnapshot('diagnosis', $system, $code);
        if (!$result['valid']) {
            throw new InvalidArgumentException('Choose a diagnosis from the allowed results or use free text.');
        }
        $display = $result['display']; // Never trust the client-provided label.
    }
    return ['diagnosis_system' => $system ?: null, 'diagnosis_code' => $code ?: null,
        'diagnosis_display' => $display, 'diagnosis_text' => $text !== '' ? $text : null,
        'diagnosis' => $text !== '' ? $text : $display];
}

function resolveChiefComplaint(array $input): array {
    $text = trim((string)($input['chief_complaint'] ?? ''));
    if ($text === '' || mb_strlen($text) > 2000) {
        throw new InvalidArgumentException('Enter the chief complaint narrative (up to 2,000 characters).');
    }
    $system = trim((string)($input['chief_complaint_system'] ?? ''));
    $code = trim((string)($input['chief_complaint_code'] ?? ''));
    $display = null;
    if ($system !== '' || $code !== '') {
        if ($system === '' || $code === '' || strlen($system) > 255 || strlen($code) > 100) {
            throw new InvalidArgumentException('Select the symptom again or keep the complaint text only.');
        }
        $result = validateTerminologySnapshot('chief-complaint', $system, $code);
        if (!$result['valid']) throw new InvalidArgumentException('Choose a symptom from the allowed results or keep text only.');
        $display = $result['display'];
    }
    return ['chief_complaint_system' => $system ?: null, 'chief_complaint_code' => $code ?: null,
        'chief_complaint_display' => $display, 'chief_complaint_text' => $text];
}
