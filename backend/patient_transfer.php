<?php
/** Hospital-only identity exchange. Central IRDSS issues authorization, never the identity. */

function transferKeyDirectory(): string {
    return __DIR__ . '/../storage/patient_transfer';
}

function transferDecode(string $value): string {
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    if ($decoded === false) throw new RuntimeException('Invalid transfer encoding.');
    return $decoded;
}

function verifyPatientTransferTicket(string $ticket): array {
    if (strlen($ticket) > 8192) throw new RuntimeException('Invalid transfer authorization.');
    $parts = explode('.', $ticket);
    if (count($parts) !== 3) throw new RuntimeException('Invalid transfer authorization.');
    [$header, $payload, $signature] = $parts;
    $metadata = json_decode(transferDecode($header), true, 32, JSON_THROW_ON_ERROR);
    if (($metadata['alg'] ?? '') !== 'RS256' || ($metadata['typ'] ?? '') !== 'JWT') {
        throw new RuntimeException('Unsupported transfer authorization.');
    }
    $publicKey = file_get_contents(transferKeyDirectory() . '/iol-authorization-public.pem');
    if (openssl_verify($header . '.' . $payload, transferDecode($signature), $publicKey, OPENSSL_ALGO_SHA256) !== 1) {
        throw new RuntimeException('Invalid transfer authorization signature.');
    }
    $claims = json_decode(transferDecode($payload), true, 32, JSON_THROW_ON_ERROR);
    $now = time();
    if (($claims['iss'] ?? '') !== 'irdss-iol' || ($claims['aud'] ?? '') !== 'irdss-patient-transfer'
        || ($claims['scope'] ?? '') !== 'patient:read' || ($claims['exp'] ?? 0) <= $now
        || ($claims['iat'] ?? PHP_INT_MAX) > $now + 5 || $claims['exp'] - $claims['iat'] > 60
        || !preg_match('/^tx_[a-f0-9]{32}$/', $claims['transfer_id'] ?? '')
        || !preg_match('/^ref_[A-Za-z0-9_-]+$/', $claims['referral_id'] ?? '')
        || !is_int($claims['source_local_id'] ?? null) || !is_int($claims['recipient_local_id'] ?? null)) {
        throw new RuntimeException('Expired or invalid transfer authorization.');
    }
    return $claims;
}

function transferLocalKeypair(int $facilityId): string {
    if ($facilityId <= 0) throw new RuntimeException('Invalid receiving facility.');
    $keypair = base64_decode(trim(file_get_contents(transferKeyDirectory() . '/facility-' . $facilityId . '.key')), true);
    if ($keypair === false || strlen($keypair) !== SODIUM_CRYPTO_BOX_KEYPAIRBYTES) {
        throw new RuntimeException('Hospital transfer key is unavailable.');
    }
    return $keypair;
}

function prepareDirectPatientTransfer(PDO $pdo, array $patient, array $payload, string $fullName): array {
    // Require installed receiver keys and pinned IoL authorization key before changing workflow.
    transferLocalKeypair((int)$patient['facility_id']);
    if (!is_file(transferKeyDirectory() . '/iol-authorization-public.pem')) {
        throw new RuntimeException('Hospital transfer authorization is not configured.');
    }
    $transferId = 'tx_' . bin2hex(random_bytes(16));
    $snapshot = [
        'full_name' => $fullName, 'date_of_birth' => $patient['dob'],
        'first_name' => $patient['first_name'], 'middle_name' => $patient['middle_name'] ?? null,
        'last_name' => $patient['last_name'], 'suffix' => $patient['suffix'] ?? null,
        'gender' => $patient['gender'],
    ];
    foreach (['region', 'province', 'city_municipality', 'barangay', 'zip_code', 'is_4ps_member'] as $field) {
        $snapshot[$field] = $patient[$field] ?? null;
    }
    $identityFields = [
        'phone' => 'phone', 'address' => 'address', 'civilStatus' => 'civil_status',
        'philhealthNumber' => 'philhealth_number', 'philhealthStatus' => 'philhealth_status',
        'consentSignerName' => 'consent_signer_name',
        'consentRepresentativeRelationship' => 'consent_representative_relationship',
    ];
    $routingExtensions = [];
    foreach ($payload['patient_record']['extension'] as $extension) {
        $name = basename($extension['url']);
        if (isset($identityFields[$name])) {
            $snapshot[$identityFields[$name]] = $extension['valueString'] ?? null;
        } else {
            $routingExtensions[] = $extension;
        }
    }
    // Preserve the complete original referral document at the sender, encrypted at rest.
    $snapshot['referral_document'] = $payload;
    $statement = $pdo->prepare('INSERT INTO patient_transfer_outbox
        (transfer_id, facility_id, patient_id, snapshot_ciphertext) VALUES (?, ?, ?, ?)');
    $statement->execute([
        $transferId, $patient['facility_id'], $patient['id'],
        encryptLocalSensitiveValue(json_encode($snapshot, JSON_THROW_ON_ERROR), 'transfer-outbox:' . $transferId),
    ]);
    $birthDate = new DateTimeImmutable($patient['dob']);
    $today = new DateTimeImmutable('today');
    $age = $birthDate->diff($today);
    $payload['identity_mode'] = 'DIRECT';
    // Tokens are facility scoped; identity never goes to the central token computation.
    $payload['patient_token'] = localPatientIdentityBlindIndex(
        (string)$patient['facility_id'] . ':' . $patient['first_name'], $patient['last_name'], $patient['dob']
    );
    $payload['age_years'] = $age->y;
    $payload['age_months'] = $age->y * 12 + $age->m;
    $payload['age_days'] = $age->days;
    $payload['patient_record']['id'] = $transferId;
    $payload['patient_record']['name'] = [];
    unset($payload['patient_record']['birthDate'], $payload['subject']['display']);
    $payload['subject']['reference'] = 'Patient/' . $transferId;
    $payload['patient_record']['extension'] = $routingExtensions;
    if (isset($payload['clinical_bundle'])) {
        // New submissions carry clinical facts in resources, not duplicate custom extensions.
        // The encrypted sender snapshot above retains the original document for compatibility.
        $resourceFields = ['diagnosis','chiefComplaint','vitalBloodPressure','vitalHeartRate',
            'vitalRespiratoryRate','vitalTemperature','vitalOxygenSaturation','vitalHeight','vitalWeight'];
        $payload['patient_record']['extension'] = array_values(array_filter($routingExtensions,
            static fn($extension) => !in_array(basename($extension['url']), $resourceFields, true)));
        foreach ($payload['clinical_bundle']['entry'] as &$entry) {
            if ($entry['resource']['resourceType']==='Patient') {
                $entry['resource']['identifier']=[['system'=>'https://irdss.gov.ph/identifier/transfer','value'=>$transferId]];
            }
        }
        unset($entry);
    }
    return [$payload, $transferId];
}

function decryptDirectPatientDetails(array $details, array $user): array {
    $transfer = $details['patient_transfer'] ?? null;
    if (!$transfer) return $details; // Previously created vault referrals remain readable.
    $ticket = (string)($transfer['ticket'] ?? '');
    $claims = verifyPatientTransferTicket($ticket);
    $facilityId = (int)($user['facility']['id'] ?? 0);
    if ($claims['recipient_local_id'] !== $facilityId || $claims['referral_id'] !== $details['referral_id']) {
        throw new RuntimeException('Patient transfer is addressed to another hospital.');
    }
    $keypair = transferLocalKeypair($facilityId);
    if (!hash_equals(base64_encode(sodium_crypto_box_publickey($keypair)), $claims['recipient_public_key'])) {
        throw new RuntimeException('Registered hospital encryption key does not match.');
    }
    $endpoint = (string)$transfer['endpoint'];
    $url = parse_url($endpoint);
    if (($url['scheme'] ?? '') !== 'https' && !(($url['scheme'] ?? '') === 'http'
        && in_array($url['host'] ?? '', ['localhost', '127.0.0.1', '::1'], true))) {
        throw new RuntimeException('Hospital transfer requires HTTPS.');
    }
    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode(['ticket' => $ticket]),
        CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'Accept: application/json'],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS]);
    $raw = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false || $code !== 200) {
        throw new RuntimeException('Sending hospital is unavailable to transfer the patient record. Please try again.');
    }
    $response = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    $ciphertext = (string)($response['ciphertext'] ?? '');
    if (openssl_verify($ticket . "\n" . $ciphertext, transferDecode($response['signature'] ?? ''),
        $transfer['source_signing_public_key'], OPENSSL_ALGO_SHA256) !== 1) {
        throw new RuntimeException('Patient package signature is invalid.');
    }
    $plaintext = sodium_crypto_box_seal_open(transferDecode($ciphertext), $keypair);
    if ($plaintext === false) throw new RuntimeException('Patient package could not be decrypted.');
    $package = json_decode($plaintext, true, 64, JSON_THROW_ON_ERROR);
    if (($package['transfer_id'] ?? '') !== $claims['transfer_id']
        || ($package['referral_id'] ?? '') !== $claims['referral_id']
        || ($package['recipient_code'] ?? '') !== $claims['recipient_code']) {
        throw new RuntimeException('Patient package does not match this referral.');
    }
    unset($details['patient_transfer']);
    // The package contains identity only; central clinical/workflow values remain authoritative.
    return array_merge($details, $package['identity'], ['_source' => 'direct-hospital']);
}
