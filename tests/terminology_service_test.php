<?php

require_once __DIR__ . '/../backend/terminology_service.php';

$search = searchTerminologySnapshot('chief-complaint', 'head', 20);
if (count($search['concepts']) !== 1 || $search['concepts'][0]['code'] !== '25064002') {
    throw new RuntimeException('Snapshot search did not return the expected chief complaint.');
}

$valid = validateTerminologySnapshot(
    'diagnosis',
    'http://snomed.info/sct',
    '233604007'
);
$invalid = validateTerminologySnapshot(
    'diagnosis',
    'http://snomed.info/sct',
    '25064002'
);

if (!$valid['valid'] || $valid['display'] !== 'Pneumonia' || $invalid['valid']) {
    throw new RuntimeException('Snapshot validation did not enforce ValueSet membership.');
}

$diagnosis = resolveClinicalDiagnosis(['diagnosis' => 'Possible pneumonia',
    'diagnosis_system' => 'http://snomed.info/sct', 'diagnosis_code' => '233604007',
    'diagnosis_display' => 'Tampered']);
if ($diagnosis['diagnosis_display'] !== 'Pneumonia' || $diagnosis['diagnosis_text'] !== 'Possible pneumonia') {
    throw new RuntimeException('Diagnosis label or clinician text was not preserved correctly.');
}
if (resolveClinicalDiagnosis(['diagnosis' => 'Unknown illness'])['diagnosis_code'] !== null ||
    resolveClinicalDiagnosis([])['diagnosis'] !== null) {
    throw new RuntimeException('Free text or absent diagnosis acquired a default code.');
}
foreach ([['diagnosis_code' => '233604007'],
    ['diagnosis_system' => 'http://snomed.info/sct', 'diagnosis_code' => '25064002'],
    ['diagnosis' => str_repeat('x', 2001)]] as $bad) {
    try { resolveClinicalDiagnosis($bad); }
    catch (InvalidArgumentException $e) { continue; }
    throw new RuntimeException('Invalid diagnosis was accepted.');
}
echo "PHP_TERMINOLOGY_AND_DIAGNOSIS_OK\n";
$complaint = resolveChiefComplaint(['chief_complaint' => 'Severe headache lasting two days',
    'chief_complaint_system' => 'http://snomed.info/sct', 'chief_complaint_code' => '25064002',
    'chief_complaint_display' => 'Wrong']);
if ($complaint['chief_complaint_text'] !== 'Severe headache lasting two days' ||
    $complaint['chief_complaint_display'] !== 'Headache') throw new RuntimeException('Symptom replaced narrative or trusted a label.');
if (resolveChiefComplaint(['chief_complaint' => 'Complex symptoms'])['chief_complaint_code'] !== null)
    throw new RuntimeException('Text-only complaint acquired a code.');
foreach ([['chief_complaint' => ' '], ['chief_complaint' => 'Test', 'chief_complaint_code' => '25064002'],
    ['chief_complaint' => 'Test', 'chief_complaint_system' => 'http://snomed.info/sct', 'chief_complaint_code' => '233604007']] as $bad) {
    try { resolveChiefComplaint($bad); } catch (InvalidArgumentException $e) { continue; }
    throw new RuntimeException('Invalid complaint was accepted.');
}
echo "PHP_CHIEF_COMPLAINT_OK\n";
