<?php

require_once __DIR__ . '/../backend/config.php';

function assertEncryptedDatabase(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$pdo = getDbConnection();

// Exercise a real encrypted local write/read without leaving test data behind.
// This keeps the verification meaningful even immediately after a database cleanup.
$facilityId = (int)$pdo->query('SELECT id FROM facilities ORDER BY id LIMIT 1')->fetchColumn();
assertEncryptedDatabase($facilityId > 0, 'At least one facility is required for the encrypted database test.');

$testIdentity = [
    'first_name' => 'Encryption',
    'middle_name' => null,
    'last_name' => 'Roundtrip',
    'suffix' => null,
    'dob' => '2000-01-01',
    'gender' => 'Other',
    'civil_status' => 'Single',
    'phone' => '0000000000',
    'region' => 'Test Region',
    'province' => 'Test Province',
    'city_municipality' => 'Test City',
    'barangay' => 'Test Barangay',
    'zip_code' => '0000',
    'philhealth_member' => 'No',
    'philhealth_number' => null,
    'philhealth_status_type' => null,
    'is_4ps_member' => 'No',
];

$pdo->beginTransaction();
try {
    $insert = $pdo->prepare('
        INSERT INTO patients (
            facility_id, identity_ciphertext, identity_blind_index, identity_key_version
        ) VALUES (
            :facility_id, :identity_ciphertext, :identity_blind_index, :identity_key_version
        )
    ');
    $insert->execute([
        ':facility_id' => $facilityId,
        ':identity_ciphertext' => encryptLocalPatientIdentity($testIdentity),
        ':identity_blind_index' => localPatientIdentityBlindIndex(
            $testIdentity['first_name'],
            $testIdentity['last_name'],
            $testIdentity['dob']
        ),
        ':identity_key_version' => LOCAL_DATA_ENVELOPE_VERSION,
    ]);

    $testPatientId = (int)$pdo->lastInsertId();
    $read = $pdo->prepare('
        SELECT id, identity_ciphertext, identity_blind_index, identity_key_version,
               first_name, last_name, dob, phone, philhealth_number
        FROM patients
        WHERE id = :id
    ');
    $read->execute([':id' => $testPatientId]);
    $stored = $read->fetch();

    assertEncryptedDatabase((bool)$stored, 'Encrypted patient round-trip row was not found.');
    assertEncryptedDatabase($stored['first_name'] === null, 'Test patient first name leaked into plaintext.');
    assertEncryptedDatabase($stored['last_name'] === null, 'Test patient last name leaked into plaintext.');
    assertEncryptedDatabase($stored['dob'] === null, 'Test patient date of birth leaked into plaintext.');
    assertEncryptedDatabase($stored['phone'] === null, 'Test patient phone leaked into plaintext.');
    assertEncryptedDatabase($stored['philhealth_number'] === null, 'Test patient PhilHealth number leaked into plaintext.');

    $hydrated = hydrateLocalPatientRow($stored);
    assertEncryptedDatabase($hydrated['first_name'] === $testIdentity['first_name'], 'Encrypted first name did not round-trip.');
    assertEncryptedDatabase($hydrated['last_name'] === $testIdentity['last_name'], 'Encrypted last name did not round-trip.');
    assertEncryptedDatabase($hydrated['dob'] === $testIdentity['dob'], 'Encrypted date of birth did not round-trip.');
} finally {
    $pdo->rollBack();
}

$patients = $pdo->query('
    SELECT identity_ciphertext, transferred_snapshot_ciphertext
    FROM patients
')->fetchAll();
foreach ($patients as $patient) {
    assertEncryptedDatabase(!empty($patient['identity_ciphertext']), 'Every patient must have encrypted identity data.');
    $identity = decryptLocalPatientIdentity($patient['identity_ciphertext']);
    assertEncryptedDatabase(array_key_exists('first_name', $identity), 'Encrypted patient identity must be readable.');
    if (!empty($patient['transferred_snapshot_ciphertext'])) {
        decryptLocalTransferSnapshot($patient['transferred_snapshot_ciphertext']);
    }
}

$plainPatientCount = (int)$pdo->query('
    SELECT COUNT(*) FROM patients
    WHERE first_name IS NOT NULL OR last_name IS NOT NULL OR dob IS NOT NULL
       OR phone IS NOT NULL OR philhealth_number IS NOT NULL
       OR transferred_address IS NOT NULL OR transferred_details_snapshot IS NOT NULL
')->fetchColumn();
assertEncryptedDatabase($plainPatientCount === 0, 'Patient plaintext remains in local patient columns.');

$protectedColumns = [
    ['initiated_referrals', 'patient_name', 'patient_name_ciphertext', 'initiated_referrals.patient_name'],
    ['audit_logs', 'patient_name', 'patient_name_ciphertext', 'audit_logs.patient_name'],
];
foreach ($protectedColumns as [$table, $plaintext, $ciphertext, $context]) {
    $plainCount = (int)$pdo->query("SELECT COUNT(*) FROM {$table} WHERE {$plaintext} IS NOT NULL")->fetchColumn();
    assertEncryptedDatabase($plainCount === 0, "Plaintext remains in {$table}.{$plaintext}.");
    $values = $pdo->query("SELECT {$ciphertext} AS ciphertext FROM {$table} WHERE {$ciphertext} IS NOT NULL")->fetchAll();
    foreach ($values as $value) {
        decryptLocalSensitiveValue($value['ciphertext'], $context);
    }
}

$consents = $pdo->query('
    SELECT signer_name, representative_relationship,
           signer_name_ciphertext, representative_relationship_ciphertext
    FROM referral_consents
')->fetchAll();
foreach ($consents as $consent) {
    assertEncryptedDatabase($consent['signer_name'] === null, 'Plaintext consent signer remains.');
    assertEncryptedDatabase($consent['representative_relationship'] === null, 'Plaintext consent relationship remains.');
    if ($consent['signer_name_ciphertext']) {
        decryptLocalSensitiveValue($consent['signer_name_ciphertext'], 'referral_consents.signer_name');
    }
    if ($consent['representative_relationship_ciphertext']) {
        decryptLocalSensitiveValue(
            $consent['representative_relationship_ciphertext'],
            'referral_consents.representative_relationship'
        );
    }
}

echo 'Encrypted local database verification passed for ' . count($patients) . " patient record(s).\n";
