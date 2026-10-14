<?php
function clinicalUrgencyPolicy(): array {
    $root = __DIR__ . '/../terminology/';
    $triage = json_decode(file_get_contents($root . 'CodeSystem-irdss-triage-acuity.json'), true, 32, JSON_THROW_ON_ERROR);
    $mapping = json_decode(file_get_contents($root . 'ConceptMap-irdss-triage-to-request-priority.json'), true, 32, JSON_THROW_ON_ERROR);
    $severity = json_decode(file_get_contents($root . 'snapshots/ValueSet-fhir-condition-severity-4.0.1.json'), true, 32, JSON_THROW_ON_ERROR);
    $priorities = [];
    foreach ($mapping['group'][0]['element'] as $element) $priorities[$element['code']] = $element['target'][0]['code'];
    return ['triage_system' => $triage['url'], 'version' => $triage['version'], 'triage' => $triage['concept'],
        'mapping' => $priorities, 'priorities' => ['routine', 'urgent', 'asap', 'stat'],
        'condition_severity_system' => $severity['compose']['include'][0]['system'],
        'condition_severity' => $severity['compose']['include'][0]['concept']];
}

function resolveClinicalUrgency(array $input): array {
    $policy = clinicalUrgencyPolicy();
    $code = trim((string)($input['triage_code'] ?? $input['severity'] ?? ''));
    $labels = array_column($policy['triage'], 'display', 'code');
    if (!isset($labels[$code])) throw new InvalidArgumentException('Select a valid triage acuity level (1–5).');
    $system = (string)($input['triage_system'] ?? $policy['triage_system']);
    if ($system !== $policy['triage_system']) throw new InvalidArgumentException('Unsupported triage scale.');
    $priority = trim((string)($input['referral_priority'] ?? $policy['mapping'][$code]));
    if (!in_array($priority, $policy['priorities'], true)) throw new InvalidArgumentException('Select a valid referral priority.');
    $reason = trim((string)($input['priority_override_reason'] ?? ''));
    if (mb_strlen($reason) > 500 || ($priority !== $policy['mapping'][$code] && $reason === ''))
        throw new InvalidArgumentException('Explain why you changed the suggested referral priority (up to 500 characters).');
    $condition = trim((string)($input['condition_severity_code'] ?? ''));
    $conditionLabels = array_column($policy['condition_severity'], 'display', 'code');
    if ($condition !== '' && (!isset($conditionLabels[$condition]) ||
        ($input['condition_severity_system'] ?? $policy['condition_severity_system']) !== $policy['condition_severity_system']))
        throw new InvalidArgumentException('Select a valid condition severity or leave it unspecified.');
    return ['triage_system' => $system, 'triage_code' => $code, 'triage_display' => $labels[$code],
        'referral_priority' => $priority, 'condition_severity_system' => $condition !== '' ? $policy['condition_severity_system'] : null,
        'condition_severity_code' => $condition ?: null, 'condition_severity_display' => $conditionLabels[$condition] ?? null,
        'priority_override_reason' => $priority !== $policy['mapping'][$code] ? $reason : null];
}

function urgencyRoutingFields(array $fields, array $user): array {
    return ['triage' => ['system' => $fields['triage_system'], 'code' => $fields['triage_code'], 'display' => $fields['triage_display']],
        'referral_priority' => $fields['referral_priority'], 'condition_severity' => $fields['condition_severity_code'] ? [
            'system' => $fields['condition_severity_system'], 'code' => $fields['condition_severity_code'], 'display' => $fields['condition_severity_display']] : null,
        'priority_override_reason' => $fields['priority_override_reason'],
        'clinical_actor' => ['user_id' => (string)$user['id'], 'role' => strtoupper($user['role'])]];
}
