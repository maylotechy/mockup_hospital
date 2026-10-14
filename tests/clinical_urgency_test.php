<?php
require_once __DIR__ . '/../backend/clinical_urgency.php';
foreach ([1 => 'routine', 2 => 'routine', 3 => 'urgent', 4 => 'asap', 5 => 'stat'] as $code => $priority) {
    $result = resolveClinicalUrgency(['triage_code' => (string)$code]);
    if ($result['referral_priority'] !== $priority) throw new RuntimeException('Wrong triage mapping.');
}
$result = resolveClinicalUrgency(['triage_code' => '1', 'condition_severity_code' => '24484000']);
if ($result['triage_code'] !== '1' || $result['referral_priority'] !== 'routine') throw new RuntimeException('Condition severity changed urgency.');
foreach ([['triage_code' => '6'], ['triage_code' => '3', 'referral_priority' => 'stat'],
    ['triage_code' => '3', 'referral_priority' => 'wrong'], ['triage_code' => '3', 'condition_severity_code' => '233604007']] as $bad) {
    try { resolveClinicalUrgency($bad); } catch (InvalidArgumentException $e) { continue; }
    throw new RuntimeException('Invalid urgency accepted.');
}
if (resolveClinicalUrgency(['triage_code' => '3', 'referral_priority' => 'stat', 'priority_override_reason' => 'Doctor decision'])['referral_priority'] !== 'stat')
    throw new RuntimeException('Valid override rejected.');
echo "CLINICAL_URGENCY_PHP_OK\n";
