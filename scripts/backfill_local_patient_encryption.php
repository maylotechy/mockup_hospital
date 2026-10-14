<?php

require_once __DIR__ . '/../backend/config.php';

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$pdo = getDbConnection();
$counts = [
    'patients' => 0,
    'snapshots' => 0,
    'initiated_referrals' => 0,
    'audit_logs' => 0,
    'consents' => 0,
];

try {
    $pdo->beginTransaction();

    $patients = $pdo->query('SELECT * FROM patients FOR UPDATE')->fetchAll();
    $patientUpdate = $pdo->prepare('
        UPDATE patients SET
            identity_ciphertext = :identity_ciphertext,
            identity_blind_index = :identity_blind_index,
            identity_key_version = :identity_key_version,
            transferred_snapshot_ciphertext = :snapshot_ciphertext,
            first_name = NULL,
            middle_name = NULL,
            last_name = NULL,
            suffix = NULL,
            dob = NULL,
            gender = NULL,
            civil_status = NULL,
            phone = NULL,
            region = NULL,
            province = NULL,
            city_municipality = NULL,
            barangay = NULL,
            zip_code = NULL,
            philhealth_member = NULL,
            philhealth_number = NULL,
            philhealth_status_type = NULL,
            is_4ps_member = NULL,
            transferred_address = NULL,
            transferred_details_snapshot = NULL
        WHERE id = :id
    ');

    foreach ($patients as $patient) {
        if (!empty($patient['identity_ciphertext'])) {
            decryptLocalPatientIdentity($patient['identity_ciphertext']);
            continue;
        }

        $identity = [
            'first_name' => $patient['first_name'],
            'middle_name' => $patient['middle_name'],
            'last_name' => $patient['last_name'],
            'suffix' => $patient['suffix'],
            'dob' => $patient['dob'],
            'gender' => $patient['gender'],
            'civil_status' => $patient['civil_status'],
            'phone' => $patient['phone'],
            'region' => $patient['region'],
            'province' => $patient['province'],
            'city_municipality' => $patient['city_municipality'],
            'barangay' => $patient['barangay'],
            'zip_code' => $patient['zip_code'],
            'philhealth_member' => $patient['philhealth_member'],
            'philhealth_number' => $patient['philhealth_number'],
            'philhealth_status_type' => $patient['philhealth_status_type'],
            'is_4ps_member' => $patient['is_4ps_member'],
            'transferred_address' => $patient['transferred_address'],
        ];
        $identityCiphertext = encryptLocalPatientIdentity($identity);
        if (decryptLocalPatientIdentity($identityCiphertext) !== $identity) {
            throw new RuntimeException("Patient {$patient['id']} failed encryption verification.");
        }

        $snapshotCiphertext = $patient['transferred_snapshot_ciphertext'] ?: null;
        if (!$snapshotCiphertext && !empty($patient['transferred_details_snapshot'])) {
            $snapshot = json_decode($patient['transferred_details_snapshot'], true, 512, JSON_THROW_ON_ERROR);
            $snapshotCiphertext = encryptLocalTransferSnapshot($snapshot);
            if (decryptLocalTransferSnapshot($snapshotCiphertext) !== $snapshot) {
                throw new RuntimeException("Patient {$patient['id']} snapshot failed encryption verification.");
            }
            $counts['snapshots']++;
        }

        $patientUpdate->execute([
            ':identity_ciphertext' => $identityCiphertext,
            ':identity_blind_index' => localPatientIdentityBlindIndex(
                (string)$patient['first_name'],
                (string)$patient['last_name'],
                (string)$patient['dob']
            ),
            ':identity_key_version' => LOCAL_DATA_ENVELOPE_VERSION,
            ':snapshot_ciphertext' => $snapshotCiphertext,
            ':id' => $patient['id'],
        ]);
        $counts['patients']++;
    }

    $simpleBackfills = [
        [
            'table' => 'initiated_referrals',
            'id' => 'id',
            'plaintext' => 'patient_name',
            'ciphertext' => 'patient_name_ciphertext',
            'context' => 'initiated_referrals.patient_name',
            'count' => 'initiated_referrals',
        ],
        [
            'table' => 'audit_logs',
            'id' => 'id',
            'plaintext' => 'patient_name',
            'ciphertext' => 'patient_name_ciphertext',
            'context' => 'audit_logs.patient_name',
            'count' => 'audit_logs',
        ],
    ];

    foreach ($simpleBackfills as $definition) {
        $rows = $pdo->query(
            "SELECT {$definition['id']} AS row_id, {$definition['plaintext']} AS plaintext "
            . "FROM {$definition['table']} "
            . "WHERE {$definition['plaintext']} IS NOT NULL AND {$definition['plaintext']} <> '' "
            . "AND {$definition['ciphertext']} IS NULL FOR UPDATE"
        )->fetchAll();
        $update = $pdo->prepare(
            "UPDATE {$definition['table']} SET {$definition['ciphertext']} = :ciphertext, "
            . "{$definition['plaintext']} = NULL WHERE {$definition['id']} = :id"
        );
        foreach ($rows as $row) {
            $ciphertext = encryptLocalSensitiveValue($row['plaintext'], $definition['context']);
            if (decryptLocalSensitiveValue($ciphertext, $definition['context']) !== $row['plaintext']) {
                throw new RuntimeException("{$definition['table']} row {$row['row_id']} failed encryption verification.");
            }
            $update->execute([':ciphertext' => $ciphertext, ':id' => $row['row_id']]);
            $counts[$definition['count']]++;
        }
    }

    $consents = $pdo->query('
        SELECT id, signer_name, representative_relationship
        FROM referral_consents
        WHERE (signer_name IS NOT NULL AND signer_name <> "")
           OR (representative_relationship IS NOT NULL AND representative_relationship <> "")
        FOR UPDATE
    ')->fetchAll();
    $consentUpdate = $pdo->prepare('
        UPDATE referral_consents SET
            signer_name_ciphertext = COALESCE(signer_name_ciphertext, :signer_name_ciphertext),
            representative_relationship_ciphertext = COALESCE(representative_relationship_ciphertext, :relationship_ciphertext),
            signer_name = NULL,
            representative_relationship = NULL
        WHERE id = :id
    ');
    foreach ($consents as $consent) {
        $signerCiphertext = $consent['signer_name']
            ? encryptLocalSensitiveValue($consent['signer_name'], 'referral_consents.signer_name')
            : null;
        $relationshipCiphertext = $consent['representative_relationship']
            ? encryptLocalSensitiveValue($consent['representative_relationship'], 'referral_consents.representative_relationship')
            : null;
        if ($signerCiphertext && decryptLocalSensitiveValue($signerCiphertext, 'referral_consents.signer_name') !== $consent['signer_name']) {
            throw new RuntimeException("Consent {$consent['id']} signer failed encryption verification.");
        }
        if ($relationshipCiphertext && decryptLocalSensitiveValue($relationshipCiphertext, 'referral_consents.representative_relationship') !== $consent['representative_relationship']) {
            throw new RuntimeException("Consent {$consent['id']} relationship failed encryption verification.");
        }
        $consentUpdate->execute([
            ':signer_name_ciphertext' => $signerCiphertext,
            ':relationship_ciphertext' => $relationshipCiphertext,
            ':id' => $consent['id'],
        ]);
        $counts['consents']++;
    }

    $pdo->commit();
    echo json_encode(['status' => 'ok', 'encrypted' => $counts], JSON_PRETTY_PRINT) . PHP_EOL;
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, "Local patient encryption backfill failed: {$exception->getMessage()}" . PHP_EOL);
    exit(1);
}

