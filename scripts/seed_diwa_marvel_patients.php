<?php

require_once __DIR__ . '/../backend/config.php';

const DIWA_FACILITY_CODE = 'HOSP-DIWA';

$patients = [
    ['Anthony', 'Edward', 'Stark', '1970-05-29', 'Male', 'Single', '09170000001'],
    ['Steven', 'Grant', 'Rogers', '1988-07-04', 'Male', 'Single', '09170000002'],
    ['Natasha', 'Alianovna', 'Romanoff', '1984-11-22', 'Female', 'Single', '09170000003'],
    ['Robert', 'Bruce', 'Banner', '1969-12-18', 'Male', 'Single', '09170000004'],
    ['Peter', 'Benjamin', 'Parker', '2001-08-10', 'Male', 'Single', '09170000005'],
    ['Carol', 'Susan', 'Danvers', '1985-04-24', 'Female', 'Single', '09170000006'],
    ['Stephen', 'Vincent', 'Strange', '1978-11-18', 'Male', 'Single', '09170000007'],
    ['Wanda', null, 'Maximoff', '1989-02-10', 'Female', 'Single', '09170000008'],
];

$pdo = getDbConnection();
$facilityStatement = $pdo->prepare('SELECT id FROM facilities WHERE code = :code LIMIT 1');
$facilityStatement->execute([':code' => DIWA_FACILITY_CODE]);
$facilityId = (int)$facilityStatement->fetchColumn();

if ($facilityId <= 0) {
    throw new RuntimeException('DiWA Center was not found using facility code ' . DIWA_FACILITY_CODE . '.');
}

$creatorStatement = $pdo->prepare("SELECT id FROM users WHERE facility_id = :facility_id AND role = 'doctor' ORDER BY id LIMIT 1");
$creatorStatement->execute([':facility_id' => $facilityId]);
$createdByUserId = $creatorStatement->fetchColumn();
$createdByUserId = $createdByUserId !== false ? (int)$createdByUserId : null;

$findExisting = $pdo->prepare('
    SELECT id
    FROM patients
    WHERE facility_id = :facility_id
      AND identity_blind_index = :identity_blind_index
    LIMIT 1
');
$insert = $pdo->prepare('
    INSERT INTO patients (
        facility_id,
        identity_ciphertext,
        identity_blind_index,
        identity_key_version,
        created_by_user_id
    ) VALUES (
        :facility_id,
        :identity_ciphertext,
        :identity_blind_index,
        :identity_key_version,
        :created_by_user_id
    )
');

$inserted = 0;
$skipped = 0;

$pdo->beginTransaction();
try {
    foreach ($patients as [$firstName, $middleName, $lastName, $dob, $gender, $civilStatus, $phone]) {
        $blindIndex = localPatientIdentityBlindIndex($firstName, $lastName, $dob);
        $findExisting->execute([
            ':facility_id' => $facilityId,
            ':identity_blind_index' => $blindIndex,
        ]);

        if ($findExisting->fetchColumn() !== false) {
            $skipped++;
            continue;
        }

        $identity = [
            'first_name' => $firstName,
            'middle_name' => $middleName,
            'last_name' => $lastName,
            'suffix' => null,
            'dob' => $dob,
            'gender' => $gender,
            'civil_status' => $civilStatus,
            'phone' => $phone,
            'region' => 'Region XI (Davao Region)',
            'province' => 'Davao del Sur',
            'city_municipality' => 'Davao City',
            'barangay' => 'Poblacion District',
            'zip_code' => '8000',
            'philhealth_member' => 'No',
            'philhealth_number' => null,
            'philhealth_status_type' => null,
            'is_4ps_member' => 'No',
        ];

        $insert->execute([
            ':facility_id' => $facilityId,
            ':identity_ciphertext' => encryptLocalPatientIdentity($identity),
            ':identity_blind_index' => $blindIndex,
            ':identity_key_version' => LOCAL_DATA_ENVELOPE_VERSION,
            ':created_by_user_id' => $createdByUserId,
        ]);
        $inserted++;
    }

    $pdo->commit();
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    throw $error;
}

echo "DiWA Center Marvel patient seed complete. Inserted: {$inserted}; skipped: {$skipped}.\n";

