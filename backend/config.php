<?php
// ========================================================
// Configuration, Database Connection & Session Management
// ========================================================

require_once __DIR__ . '/../vendor/autoload.php';

// safeLoad() prevents crashes if the .env file is missing in production
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../');
$dotenv->safeLoad(); 

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$iolHost = $_ENV['IOL_HOST'] ?? 'localhost'; 
define('IOL_ENDPOINT_URL', 'http://' . $iolHost . ':8081/api/v1/referral/initiate');
define('IOL_AUTH_LOGIN_URL', 'http://' . $iolHost . ':8081/api/auth/login');


define('DB_HOST', 'localhost');
define('DB_NAME', 'hospital_db');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_CHARSET', 'utf8mb4');

define('IOL_SYSTEM_CODE', 'SYSTEM-001');
define('IOL_KEY_ID', 'KEY-2026-001');

/**
 * Signs a request per the IOL 3-layer RSA authentication scheme and sends it,
 * centralizing the crypto boilerplate shared by every backend endpoint that
 * talks to IOL. Returns [httpCode, decodedResponseOrRaw, curlErrno, curlError].
 *
 * @param string $method       HTTP method (GET, POST, PATCH, ...)
 * @param string $path         IOL URL path, e.g. '/api/v1/referral/initiate'
 * @param string $bodyJson     Raw JSON request body (use '{}' for bodyless requests)
 * @param string $facilityCode
 * @param string $facilityName
 * @return array [int $httpCode, mixed $response, int $curlErrno, ?string $curlError]
 */
function sendSignedIolRequest($method, $path, $bodyJson, $facilityCode, $facilityName) {
    $privKeyPath = __DIR__ . '/../storage/keys/private_key.pem';
    if (!file_exists($privKeyPath)) {
        return [0, null, -1, 'RSA private key not found at ' . $privKeyPath];
    }

    $privateKeyPem = file_get_contents($privKeyPath);
    $privateKey = openssl_pkey_get_private($privateKeyPem);
    if (!$privateKey) {
        return [0, null, -1, 'Failed to load RSA private key: ' . openssl_error_string()];
    }

    $timestamp = (int)time();
    $nonce = bin2hex(random_bytes(16));
    $bodyHash = hash('sha256', $bodyJson, false);
    $signingStr = "{$method}\n{$path}\n" . IOL_SYSTEM_CODE . "\n" . IOL_KEY_ID . "\n{$timestamp}\n{$nonce}\n{$bodyHash}";

    $signature = '';
    $signResult = openssl_sign($signingStr, $signature, $privateKey, OPENSSL_ALGO_SHA256);
    if (!$signResult) {
        return [0, null, -1, 'RSA signing failed: ' . openssl_error_string()];
    }
    $signatureB64 = base64_encode($signature);

    $requestHeaders = [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($bodyJson),
        'X-System-Code: ' . IOL_SYSTEM_CODE,
        'X-Key-ID: ' . IOL_KEY_ID,
        'X-Signature-Timestamp: ' . $timestamp,
        'X-Request-Nonce: ' . $nonce,
        'X-System-Signature: ' . $signatureB64,
        'X-Facility-Code: ' . $facilityCode,
        'X-Facility-Name: ' . $facilityName
    ];

    $iolHost = $_ENV['IOL_HOST'] ?? 'localhost';
    $iolUrl = 'http://' . $iolHost . ':8081' . $path;

    $ch = curl_init($iolUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
    if ($method !== 'GET') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
    }
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $requestHeaders);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $rawResponse = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlErrno) {
        return [503, null, $curlErrno, $curlError];
    }

    $decoded = json_decode($rawResponse, true);
    return [$httpCode, $decoded !== null ? $decoded : $rawResponse, 0, null];
}

/**
 * Returns PDO Database Instance
 * 
 * @return PDO
 */
function getDbConnection() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            sendJsonResponse([
                'success' => false,
                'message' => 'Database connection failed: ' . $e->getMessage()
            ], 500);
        }
    }
    return $pdo;
}

/**
 * Returns currently logged-in staff user (with nested facility info) or null
 *
 * @return array|null
 */
function getLoggedInUser() {
    if (isset($_SESSION['user']) && is_array($_SESSION['user'])) {
        return $_SESSION['user'];
    }
    return null;
}

/**
 * Sends a 403 JSON response and terminates the script unless the logged-in user's
 * role is in $allowedRoles. Must be called after confirming the user is authenticated.
 *
 * @param string[] $allowedRoles
 */
function requireRole(array $allowedRoles) {
    $user = getLoggedInUser();
    if (!$user || !in_array($user['role'], $allowedRoles, true)) {
        sendJsonResponse([
            'success' => false,
            'message' => 'You do not have permission to perform this action.'
        ], 403);
    }
}

/**
 * Resolves the logged-in user's facility's *current* API key with a live DB read, so a key
 * rotated mid-session (e.g. by the IRDSS admin panel) takes effect on the very next
 * request instead of only after the browser logs out and back in. The session's
 * cached copy is refreshed too, so anything else reading it stays in sync.
 *
 * @return string|null
 */
function getFreshApiKeyForLoggedInFacility() {
    $user = getLoggedInUser();
    if (!$user || empty($user['facility']['id'])) {
        return null;
    }

    try {
        $pdo = getDbConnection();
        $stmt = $pdo->prepare('SELECT api_key FROM facilities WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $user['facility']['id']]);
        $row = $stmt->fetch();
    } catch (PDOException $e) {
        return $user['facility']['api_key'] ?? null;
    }

    if (!$row || empty($row['api_key'])) {
        return null;
    }

    $_SESSION['user']['facility']['api_key'] = $row['api_key'];
    return $row['api_key'];
}

/**
 * True if this facility has already successfully sent a referral for the given
 * local patient (any row in initiated_referrals for them, regardless of its
 * current status). Used to stop a discharge/departure record from being saved
 * for a patient who's already been referred onward through the system -- the
 * two facts would contradict each other on the original hospital's tracker.
 *
 * @return bool
 */
function hasPatientBeenReferredOnward($pdo, $facilityId, $localPatientId) {
    if ($localPatientId <= 0) {
        return false;
    }
    $stmt = $pdo->prepare('
        SELECT 1 FROM initiated_referrals
        WHERE hospital_id = :fid AND patient_id = :pid AND sync_status = "SENT"
        LIMIT 1
    ');
    $stmt->execute([':fid' => $facilityId, ':pid' => $localPatientId]);
    return (bool)$stmt->fetch();
}

// Handle preflight CORS requests with credentials support
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');
    http_response_code(200);
    exit;
}

/**
 * Send JSON Response and terminate script
 * 
 * @param array $data
 * @param int $statusCode
 */
function sendJsonResponse($data, $statusCode = 200) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
    http_response_code($statusCode);
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
