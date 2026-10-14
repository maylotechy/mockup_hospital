<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../backend/config.php';
require_once __DIR__ . '/../backend/terminology_service.php';
require_once __DIR__ . '/../backend/clinical_urgency.php';

$pdo = getDbConnection();
$patient = $pdo->query('SELECT id, facility_id FROM patients ORDER BY id LIMIT 1')->fetch();
if (!$patient) throw new RuntimeException('A local patient fixture is required.');
$source = file_get_contents(__DIR__ . '/../backend/send_referral.php');
if (!preg_match('~INSERT INTO initiated_referrals\s+\(.*?\)\s+VALUES\s+\(.*?\)~s', $source, $match)) {
    throw new RuntimeException('Production referral insert was not found.');
}
preg_match_all('~:[a-z_][a-z0-9_]*~', $match[0], $placeholders);
$params = array_fill_keys($placeholders[0], null);
$text = trim(str_repeat('Possible pneumonia. ', 30));
$diagnosis = resolveClinicalDiagnosis(['diagnosis' => $text, 'diagnosis_system' => 'http://snomed.info/sct',
    'diagnosis_code' => '233604007', 'diagnosis_display' => 'Wrong label']);
$params[':hospital_id'] = $patient['facility_id'];
$params[':patient_id'] = $patient['id'];
$params[':reason'] = 'Synthetic phase 4 test';
$params[':status'] = 'AWAITING';
$params[':sync_status'] = 'SENT';
$params[':patient_name_ciphertext'] = encryptLocalSensitiveValue('Synthetic patient', 'initiated_referrals.patient_name');
foreach ($diagnosis as $key => $value) $params[':' . $key] = $key === 'diagnosis' ? mb_substr($value, 0, 255) : $value;
$complaintText = trim(str_repeat('Severe chest pain radiating to the left arm. ', 12));
$complaint = resolveChiefComplaint(['chief_complaint' => $complaintText,
    'chief_complaint_system' => 'http://snomed.info/sct', 'chief_complaint_code' => '29857009']);
$params[':chief_complaint'] = mb_substr($complaintText, 0, 255);
foreach ($complaint as $key => $value) $params[':' . $key] = $value;
$urgency = resolveClinicalUrgency(['triage_code' => '1', 'condition_severity_code' => '24484000']);
foreach ($urgency as $key => $value) if ($key !== 'priority_override_reason') $params[':' . $key] = $value;
$pdo->beginTransaction();
try {
    $pdo->prepare($match[0])->execute($params);
    $id = (int)$pdo->lastInsertId();
    $read = $pdo->prepare('SELECT * FROM initiated_referrals WHERE id = ?');
    $read->execute([$id]);
    $stored = $read->fetch();
    if ($stored['diagnosis_code'] !== '233604007' || $stored['diagnosis_system'] !== 'http://snomed.info/sct' ||
        $stored['diagnosis_display'] !== 'Pneumonia' || $stored['diagnosis_text'] !== $text ||
        $stored['chief_complaint_code'] !== '29857009' || $stored['chief_complaint_display'] !== 'Chest pain' ||
        $stored['chief_complaint_text'] !== $complaintText ||
        $stored['triage_code'] !== '1' || $stored['referral_priority'] !== 'routine' ||
        $stored['condition_severity_code'] !== '24484000' ||
        $stored['patient_name'] !== null ||
        decryptLocalSensitiveValue($stored['patient_name_ciphertext'], 'initiated_referrals.patient_name') !== 'Synthetic patient') {
        throw new RuntimeException('Local coded diagnosis or encrypted identity did not round-trip.');
    }
} finally {
    $pdo->rollBack();
}
echo "DIAGNOSIS_DATABASE_ROUNDTRIP_OK (rolled back)\n";
