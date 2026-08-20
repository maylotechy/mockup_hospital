<?php
// ========================================================
// Centralized HIS Cryptographic Request Signing (RSA-2048)
// ========================================================

require_once __DIR__ . '/config.php';

/**
 * Returns the path to the key storage directory.
 */
function getKeyStorageDir() {
    $dir = __DIR__ . '/../storage/keys';
    if (!file_exists($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

/**
 * Gets or auto-generates the Central HIS 2048-bit RSA key pair.
 * Private key stays ONLY on this server in storage/keys/private_key.pem.
 */
function getOrGenerateKeyPair() {
    $dir = getKeyStorageDir();
    $privateKeyPath = $dir . '/private_key.pem';
    $publicKeyPath  = $dir . '/public_key.pem';

    if (file_exists($privateKeyPath) && file_exists($publicKeyPath)) {
        return [
            'private_key' => file_get_contents($privateKeyPath),
            'public_key'  => file_get_contents($publicKeyPath)
        ];
    }

    // Generate new 2048-bit RSA key pair
    $config = [
        "digest_alg"       => "sha256",
        "private_key_bits" => 2048,
        "private_key_type" => OPENSSL_KEYTYPE_RSA,
    ];

    $res = openssl_pkey_new($config);
    if (!$res) {
        throw new Exception("Failed to generate RSA key pair: " . openssl_error_string());
    }

    openssl_pkey_export($res, $privateKeyPem);
    $pubDetails = openssl_pkey_get_details($res);
    $publicKeyPem = $pubDetails["key"];

    file_put_contents($privateKeyPath, $privateKeyPem);
    file_put_contents($publicKeyPath, $publicKeyPem);

    return [
        'private_key' => $privateKeyPem,
        'public_key'  => $publicKeyPem
    ];
}

/**
 * Signs outgoing HTTP requests to the IRDSS Interoperability Layer (IOL)
 * using the Central HIS RSA Private Key + 3-Layer Context Headers.
 */
function signRequestHeaders($method, $path, $bodyString = '', $userContext = null) {
    $keyPair = getOrGenerateKeyPair();
    $privateKey = $keyPair['private_key'];

    $systemCode = "SYSTEM-001";
    $keyId      = "KEY-2026-001";
    $timestamp  = time();
    $nonce      = bin2hex(random_bytes(12));
    $bodySha256 = hash('sha256', $bodyString);

    // Build signing payload string
    $signingStr = strtoupper($method) . "\n" . $path . "\n" . $systemCode . "\n" . $keyId . "\n" . $timestamp . "\n" . $nonce . "\n" . $bodySha256;

    // Create RSA-SHA256 signature
    $success = openssl_sign($signingStr, $rawSignature, $privateKey, OPENSSL_ALGO_SHA256);
    if (!$success) {
        throw new Exception("Failed to compute RSA signature: " . openssl_error_string());
    }
    $signatureB64 = base64_encode($rawSignature);

    // Extract User & Facility Context
    $user = $userContext ?: ($_SESSION['user'] ?? null);
    $userId       = $user['username'] ?? 'USER-000001';
    $userRole     = strtoupper($user['role'] ?? 'FACILITY_ADMIN');
    $facilityCode = $user['facility']['code'] ?? 'FAC-000001';
    $facilityName = $user['facility']['name'] ?? '';

    return [
        'Content-Type: application/json',
        'X-System-Code: ' . $systemCode,
        'X-Key-ID: ' . $keyId,
        'X-Signature-Timestamp: ' . $timestamp,
        'X-Request-Nonce: ' . $nonce,
        'X-System-Signature: ' . $signatureB64,
        'X-User-ID: ' . $userId,
        'X-User-Role: ' . $userRole,
        'X-Facility-Code: ' . $facilityCode,
        'X-Facility-Name: ' . $facilityName
    ];
}
