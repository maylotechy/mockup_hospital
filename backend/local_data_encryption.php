<?php

/**
 * Hospital-local encryption helpers for sensitive values stored in MySQL.
 *
 * Key separation is intentional:
 * - LOCAL_DATA_ENCRYPTION_KEY encrypts/decrypts local database values.
 * - LOCAL_DATA_INDEX_KEY creates deterministic keyed indexes for exact lookup.
 * - Neither key is the RSA request-signing key in storage/keys.
 *
 * Keys must be independent base64-encoded 32-byte values supplied through the
 * deployment environment or secret manager. They must never be committed.
 */

const LOCAL_DATA_CIPHER = 'aes-256-gcm';
const LOCAL_DATA_ENVELOPE_VERSION = 'v1';
const LOCAL_DATA_ENVELOPE_PREFIX = 'enc:v1:';

function localDataKeyFromEnvironment(string $name): string
{
    $encoded = $_ENV[$name] ?? getenv($name);
    if (!is_string($encoded) || trim($encoded) === '') {
        throw new RuntimeException("Required local cryptography key {$name} is not configured.");
    }

    $decoded = base64_decode(trim($encoded), true);
    if ($decoded === false || strlen($decoded) !== 32) {
        throw new RuntimeException("Local cryptography key {$name} must be a base64-encoded 32-byte key.");
    }

    return $decoded;
}

function isLocalEncryptedValue(?string $value): bool
{
    return is_string($value) && str_starts_with($value, LOCAL_DATA_ENVELOPE_PREFIX);
}

function encryptLocalSensitiveValue(?string $plaintext, string $context): ?string
{
    if ($plaintext === null) {
        return null;
    }
    if ($context === '') {
        throw new InvalidArgumentException('Encryption context must identify the protected field.');
    }

    $key = localDataKeyFromEnvironment('LOCAL_DATA_ENCRYPTION_KEY');
    $nonce = random_bytes(12);
    $tag = '';
    $ciphertext = openssl_encrypt(
        $plaintext,
        LOCAL_DATA_CIPHER,
        $key,
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        $context,
        16
    );

    if ($ciphertext === false || strlen($tag) !== 16) {
        throw new RuntimeException('Local patient data encryption failed.');
    }

    return LOCAL_DATA_ENVELOPE_PREFIX
        . base64_encode($nonce) . ':'
        . base64_encode($tag) . ':'
        . base64_encode($ciphertext);
}

function decryptLocalSensitiveValue(?string $storedValue, string $context): ?string
{
    if ($storedValue === null || !isLocalEncryptedValue($storedValue)) {
        // Compatibility behavior for additive migration: legacy plaintext remains
        // readable until every row has been backfilled and verified.
        return $storedValue;
    }
    if ($context === '') {
        throw new InvalidArgumentException('Decryption context must identify the protected field.');
    }

    $parts = explode(':', $storedValue, 5);
    if (count($parts) !== 5 || $parts[0] !== 'enc' || $parts[1] !== LOCAL_DATA_ENVELOPE_VERSION) {
        throw new RuntimeException('Unsupported encrypted local data envelope.');
    }

    $nonce = base64_decode($parts[2], true);
    $tag = base64_decode($parts[3], true);
    $ciphertext = base64_decode($parts[4], true);
    if ($nonce === false || strlen($nonce) !== 12 || $tag === false || strlen($tag) !== 16 || $ciphertext === false) {
        throw new RuntimeException('Encrypted local data envelope is malformed.');
    }

    $plaintext = openssl_decrypt(
        $ciphertext,
        LOCAL_DATA_CIPHER,
        localDataKeyFromEnvironment('LOCAL_DATA_ENCRYPTION_KEY'),
        OPENSSL_RAW_DATA,
        $nonce,
        $tag,
        $context
    );

    if ($plaintext === false) {
        throw new RuntimeException('Encrypted local data could not be authenticated or decrypted.');
    }

    return $plaintext;
}

function localSensitiveBlindIndex(?string $value, string $context): ?string
{
    if ($value === null) {
        return null;
    }
    if ($context === '') {
        throw new InvalidArgumentException('Blind-index context must identify the indexed field.');
    }

    $normalized = preg_replace('/\s+/u', ' ', mb_strtolower(trim($value), 'UTF-8'));
    return hash_hmac('sha256', $context . "\0" . $normalized, localDataKeyFromEnvironment('LOCAL_DATA_INDEX_KEY'));
}

function encryptLocalPatientIdentity(array $identity): string
{
    $json = json_encode($identity, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    return encryptLocalSensitiveValue($json, 'patients.identity');
}

function decryptLocalPatientIdentity(?string $ciphertext): array
{
    if (!$ciphertext) {
        return [];
    }
    $json = decryptLocalSensitiveValue($ciphertext, 'patients.identity');
    $identity = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($identity)) {
        throw new RuntimeException('Decrypted local patient identity is invalid.');
    }
    return $identity;
}

function localPatientIdentityBlindIndex(string $firstName, string $lastName, string $dob): string
{
    return localSensitiveBlindIndex(
        trim($firstName) . '|' . trim($lastName) . '|' . trim($dob),
        'patients.identity'
    );
}

function localPatientFullName(array $patient): string
{
    $parts = [
        $patient['first_name'] ?? null,
        $patient['middle_name'] ?? null,
        $patient['last_name'] ?? null,
        $patient['suffix'] ?? null,
    ];

    return implode(' ', array_values(array_filter(
        array_map(static fn($part) => trim((string)$part), $parts),
        static fn($part) => $part !== ''
    )));
}

function normalizeLocalPersonName(string $name): string
{
    $normalizedWhitespace = preg_replace('/\s+/u', ' ', trim($name));
    return mb_strtolower((string)$normalizedWhitespace, 'UTF-8');
}

function localPatientAgeYears(string $dateOfBirth, ?DateTimeImmutable $asOf = null): int
{
    $birthDate = DateTimeImmutable::createFromFormat('!Y-m-d', trim($dateOfBirth));
    $dateErrors = DateTimeImmutable::getLastErrors();
    if ($birthDate === false || ($dateErrors !== false && ($dateErrors['warning_count'] > 0 || $dateErrors['error_count'] > 0))) {
        throw new InvalidArgumentException('Patient date of birth is invalid.');
    }

    $referenceDate = ($asOf ?? new DateTimeImmutable('today'))->setTime(0, 0);
    if ($birthDate > $referenceDate) {
        throw new InvalidArgumentException('Patient date of birth cannot be in the future.');
    }

    return $birthDate->diff($referenceDate)->y;
}

function isLocalPatientSeniorCitizen(string $dateOfBirth, ?DateTimeImmutable $asOf = null): bool
{
    return localPatientAgeYears($dateOfBirth, $asOf) >= 60;
}

function hydrateLocalPatientRow(array $row): array
{
    if (!empty($row['identity_ciphertext'])) {
        $row = array_replace($row, decryptLocalPatientIdentity($row['identity_ciphertext']));
    }
    unset($row['identity_ciphertext'], $row['identity_blind_index'], $row['identity_key_version']);
    return $row;
}

function encryptLocalTransferSnapshot(array $snapshot): string
{
    $json = json_encode($snapshot, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    return encryptLocalSensitiveValue($json, 'patients.transferred_snapshot');
}

function decryptLocalTransferSnapshot(?string $ciphertext, ?string $legacyJson = null): array
{
    if ($ciphertext) {
        $json = decryptLocalSensitiveValue($ciphertext, 'patients.transferred_snapshot');
        $snapshot = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
        return is_array($snapshot) ? $snapshot : [];
    }

    if ($legacyJson) {
        $snapshot = json_decode($legacyJson, true);
        return is_array($snapshot) ? $snapshot : [];
    }
    return [];
}
