<?php
// ========================================================
// Direct Proxy to Central FastAPI Server
// Target: http://127.0.0.1:8000/api/v1/hospitals/...
// 100% Dynamic Data directly from FastAPI Backend (PostgreSQL)
// ========================================================

// Handle CORS preflight IMMEDIATELY before loading dependencies
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

// 1. Always resolve the caller's API key with a live DB read for the logged-in
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

// 2. Query target URI path on central FastAPI backend
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$path = '/api/v1/hospitals/me/inventory';

if (preg_match('#/api/v1/hospitals(/.*)?$#i', $requestUri, $matches)) {
    $subPath = $matches[1] ?? '/me/inventory';
    $path = '/api/v1/hospitals' . $subPath;
}

$iolHost = $_ENV['IOL_HOST'] ?? 'localhost';
$centralUrl = 'http://' . $iolHost . ':8081' . $path;

if (!empty($_SERVER['QUERY_STRING']) && strpos($path, '?') === false) {
    $centralUrl .= '?' . $_SERVER['QUERY_STRING'];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$rawInput = file_get_contents('php://input');

// 3. Perform cURL request directly to Central FastAPI Backend
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
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErrno = curl_errno($ch);
$curlError = curl_error($ch);
curl_close($ch);

// 4. If cURL connection failed (e.g. FastAPI server unreachable)
if ($curlErrno) {
    sendJsonResponse([
        'detail' => "Can't reach the server, contact devs @ irdss.devs@up.edu.ph"
    ], 503);
}

// 5. Output response and status code 100% directly from Central FastAPI Server
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
http_response_code($httpCode);
header("Access-Control-Allow-Origin: {$origin}");
header('Access-Control-Allow-Credentials: true');
header('Content-Type: application/json; charset=utf-8');
echo $response;
exit;
