<?php
// ========================================================
// Direct Proxy to Central FastAPI Server for Referral Operations
// Target: http://127.0.0.1:8000/api/v1/referral/...
// Handles: GET /incoming, PATCH /{referral_id}/respond, etc.
// ========================================================

require_once __DIR__ . '/config.php';

// Handle CORS preflight
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');
    http_response_code(200);
    exit;
}

// 1. Extract X-API-Key header or logged-in hospital session key
$headers = function_exists('getallheaders') ? getallheaders() : [];
$apiKey = '';

if (!empty($_SERVER['HTTP_X_API_KEY'])) {
    $apiKey = trim($_SERVER['HTTP_X_API_KEY']);
} elseif (!empty($headers['X-API-Key'])) {
    $apiKey = trim($headers['X-API-Key']);
} elseif (!empty($headers['x-api-key'])) {
    $apiKey = trim($headers['x-api-key']);
}

$loggedInHospital = getLoggedInHospital();
if (empty($apiKey) && $loggedInHospital && !empty($loggedInHospital['api_key'])) {
    $apiKey = $loggedInHospital['api_key'];
}

if (empty($apiKey)) {
    sendJsonResponse([
        'detail' => 'Unauthorized. Missing X-API-Key header.'
    ], 401);
}

// 2. Query target URI path on central FastAPI backend
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$path = '/api/v1/referral/incoming';

if (preg_match('#/api/v1/referral(/.*)?$#i', $requestUri, $matches)) {
    $subPath = $matches[1] ?? '/incoming';
    $path = '/api/v1/referral' . $subPath;
}

$centralUrl = 'http://127.0.0.1:8081' . $path;

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
        'detail' => "Can't reach the central server."
    ], 503);
}

// 5. Output response and status code 100% directly from Central FastAPI Server
http_response_code($httpCode);
header("Access-Control-Allow-Origin: {$origin}");
header('Access-Control-Allow-Credentials: true');
header('Content-Type: application/json; charset=utf-8');
echo $response;
exit;
