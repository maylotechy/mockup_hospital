<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../backend/config.php';
require_once __DIR__ . '/../backend/referral_patient_display.php';
$pdo = getDbConnection();
$row = $pdo->query('SELECT transfer_id, facility_id, patient_id FROM patient_transfer_outbox LIMIT 1')->fetch(PDO::FETCH_ASSOC);
if (!$row) throw new RuntimeException('A transfer fixture is required.');
$input = [['referral_id'=>'not-a-local-referral', 'patient_id'=>$row['transfer_id']]];
$result = addReferralPatientDisplayIds($pdo, (int)$row['facility_id'], $input);
$expected = '#'.str_pad((string)$row['patient_id'],5,'0',STR_PAD_LEFT);
if ($result[0]['patient_display_id'] !== $expected || $result[0]['patient_id'] !== $row['transfer_id'])
    throw new RuntimeException('Local display ID resolution changed the transfer identifier.');
$other = addReferralPatientDisplayIds($pdo, -1, $input);
if ($other[0]['patient_display_id'] !== 'Unavailable') throw new RuntimeException('Cross-facility patient ID leak.');
echo "REFERRAL_PATIENT_DISPLAY_OK (facility-scoped; transfer token unchanged)\n";
$incoming = addReceivingPatientDisplayIds($pdo, -1, $input);
if ($incoming[0]['patient_display_id'] !== 'Not registered yet') throw new RuntimeException('Receiving view exposed a transfer token.');
$patient = $pdo->query('SELECT id, facility_id, source_referral_id FROM patients WHERE source_referral_id IS NOT NULL LIMIT 1')->fetch(PDO::FETCH_ASSOC);
if ($patient) {
    $incoming = addReceivingPatientDisplayIds($pdo, (int)$patient['facility_id'], [['referral_id'=>$patient['source_referral_id'], 'patient_id'=>'tx_test']]);
    if ($incoming[0]['patient_display_id'] !== '#'.str_pad((string)$patient['id'],5,'0',STR_PAD_LEFT))
        throw new RuntimeException('Receiving patient ID did not match the local record.');
}
echo "RECEIVING_PATIENT_DISPLAY_OK\n";
