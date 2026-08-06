<?php
// ========================================================
// Direct Proxy to Central FastAPI Server for Referral Operations
// Target: http://127.0.0.1:8000/api/v1/referral/...
// Handles: GET /incoming, PATCH /{referral_id}/respond, etc.
// ========================================================

// 1. Send CORS Headers IMMEDIATELY before loading dependencies
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header("Access-Control-Allow-Origin: {$origin}");
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization, X-Requested-With');

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/config.php';

// Safe load for composer vendor autoload if present
$vendorAutoload = __DIR__ . '/../vendor/autoload.php';
if (file_exists($vendorAutoload)) {
    require_once $vendorAutoload;
    if (class_exists('Dotenv\Dotenv')) {
        $dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../');
        $dotenv->safeLoad();
    }
}

// 2. Always resolve the caller's API key with a live DB read for the logged-in
// hospital — never trust a client-supplied X-API-Key header here. That header is
// only ever a stale JS-memory snapshot taken at login, so trusting it means a key
// rotated mid-session (e.g. via the IRDSS admin panel) wouldn't take effect until
// the hospital logs out and back in.
$apiKey = getFreshApiKeyForLoggedInHospital();

if (empty($apiKey)) {
    sendJsonResponse([
        'detail' => 'Unauthorized. Please log in again.'
    ], 401);
}

// 3. Query target URI path on central FastAPI backend
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$path = '/api/v1/referral/incoming';

if (preg_match('#/api/v1/referral(/.*)?$#i', $requestUri, $matches)) {
    $subPath = $matches[1] ?? '/incoming';
    $path = '/api/v1/referral' . $subPath;
}

$queryString = (!empty($_SERVER['QUERY_STRING']) && strpos($path, '?') === false) ? '?' . $_SERVER['QUERY_STRING'] : '';
$portsToTry = [8081, 8000, 8001];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawInput = file_get_contents('php://input');

$response = false;
$httpCode = 0;
$curlErrno = 0;

$iolHost = $_ENV['IOL_HOST'] ?? '127.0.0.1';

foreach ($portsToTry as $port) {
    $centralUrl = "http://{$iolHost}:{$port}" . $path . $queryString;
    $ch = curl_init($centralUrl);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);

    if (!empty($rawInput) && in_array($method, ['POST', 'PATCH', 'PUT'])) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $rawInput);
    }

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

    $requestHeaders = [
        'Content-Type: application/json',
        'Accept: application/json',
        'Connection: close',
        'X-API-Key: ' . $apiKey
    ];

    curl_setopt($ch, CURLOPT_HTTPHEADER, $requestHeaders);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 1);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErrno = curl_errno($ch);
    curl_close($ch);

    if (!$curlErrno && $httpCode > 0) {
        break;
    }
}

// 4. If cURL connection failed to all ports
if ($curlErrno || !$response) {
    if (strpos($path, '/incoming') !== false) {
        sendJsonResponse([], 200);
    }
    sendJsonResponse([
        'detail' => "Can't reach the central server."
    ], 503);
}

// 5. Output response and status code 100% directly from Central FastAPI Server
http_response_code($httpCode);
header('Content-Type: application/json; charset=utf-8');
echo $response;
exit;
