<?php

require_once __DIR__ . '/../backend/local_data_encryption.php';

$_ENV['LOCAL_DATA_ENCRYPTION_KEY'] = base64_encode(random_bytes(32));
$_ENV['LOCAL_DATA_INDEX_KEY'] = base64_encode(random_bytes(32));

function assertEncryptionTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$plaintext = 'Juan Dela Cruz';
$encrypted = encryptLocalSensitiveValue($plaintext, 'patients.full_name');

assertEncryptionTest($encrypted !== $plaintext, 'Ciphertext must not equal plaintext.');
assertEncryptionTest(isLocalEncryptedValue($encrypted), 'Ciphertext must use the versioned envelope prefix.');
assertEncryptionTest(
    decryptLocalSensitiveValue($encrypted, 'patients.full_name') === $plaintext,
    'Encrypted values must decrypt with the correct field context.'
);
assertEncryptionTest(
    decryptLocalSensitiveValue('Legacy Patient', 'patients.full_name') === 'Legacy Patient',
    'Legacy plaintext must remain readable during migration.'
);

$wrongContextRejected = false;
try {
    decryptLocalSensitiveValue($encrypted, 'patients.phone');
} catch (RuntimeException $exception) {
    $wrongContextRejected = true;
}
assertEncryptionTest($wrongContextRejected, 'Ciphertext must be bound to its field context.');

$tampered = substr($encrypted, 0, -1) . (substr($encrypted, -1) === 'A' ? 'B' : 'A');
$tamperRejected = false;
try {
    decryptLocalSensitiveValue($tampered, 'patients.full_name');
} catch (RuntimeException $exception) {
    $tamperRejected = true;
}
assertEncryptionTest($tamperRejected, 'Tampered ciphertext must be rejected.');

$indexA = localSensitiveBlindIndex('  Juan   Dela Cruz ', 'patients.identity');
$indexB = localSensitiveBlindIndex('juan dela cruz', 'patients.identity');
$indexOtherContext = localSensitiveBlindIndex('juan dela cruz', 'patients.phone');
assertEncryptionTest($indexA === $indexB, 'Blind index normalization must be deterministic.');
assertEncryptionTest($indexA !== $indexOtherContext, 'Blind indexes must be separated by context.');

$identity = [
    'first_name' => 'Juan',
    'last_name' => 'Dela Cruz',
    'dob' => '1990-01-01',
    'phone' => '+639171234567',
];
$identityCiphertext = encryptLocalPatientIdentity($identity);
assertEncryptionTest(
    decryptLocalPatientIdentity($identityCiphertext) === $identity,
    'Patient identity documents must round-trip without losing fields.'
);

$namedPatient = [
    'first_name' => 'Anthony',
    'middle_name' => 'Edward',
    'last_name' => 'Stark',
    'suffix' => 'Jr.',
];
assertEncryptionTest(
    localPatientFullName($namedPatient) === 'Anthony Edward Stark Jr.',
    'Patient full names must retain middle names and suffixes.'
);
assertEncryptionTest(
    normalizeLocalPersonName('  ANTHONY   Edward Stark Jr. ') === normalizeLocalPersonName('Anthony Edward Stark Jr.'),
    'Electronic-consent name comparison must ignore capitalization and repeated whitespace.'
);
assertEncryptionTest(
    localPatientAgeYears('1966-10-08', new DateTimeImmutable('2026-10-08')) === 60,
    'Age calculation must recognize a patient on their 60th birthday.'
);
assertEncryptionTest(
    !isLocalPatientSeniorCitizen('1966-10-09', new DateTimeImmutable('2026-10-08')),
    'A patient must not be marked senior before their 60th birthday.'
);
assertEncryptionTest(
    isLocalPatientSeniorCitizen('1966-10-08', new DateTimeImmutable('2026-10-08')),
    'A patient aged 60 or older must be marked as a senior citizen.'
);

$snapshot = ['full_name' => 'Juan Dela Cruz', 'diagnosis' => 'Example'];
assertEncryptionTest(
    decryptLocalTransferSnapshot(encryptLocalTransferSnapshot($snapshot)) === $snapshot,
    'Transferred-patient snapshots must be encrypted and decrypted locally.'
);

echo "Local data encryption tests passed.\n";
