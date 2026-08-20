<?php
// ========================================================
// Dynamic Service Assessment API Proxy
// Target: http://127.0.0.1:8081/api/v1/assessments/...
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/crypto_helper.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['detail' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['facility_admin']);

$action = $_GET['action'] ?? 'form';
$iolHost = $_ENV['IOL_HOST'] ?? '127.0.0.1';
$portsToTry = [8081, 8000, 8001];

if ($_SERVER['REQUEST_METHOD'] === 'GET' && ($action === 'form' || $action === 'template')) {
    $path = '/api/v1/assessments/form';
    $queryString = '?facility_code=' . urlencode($user['facility']['code'] ?? '')
        . '&facility_name=' . urlencode($user['facility']['name'] ?? '');
    
    $response = false;
    $httpCode = 0;
    $curlErrno = 0;

    foreach ($portsToTry as $port) {
        $url = "http://{$iolHost}:{$port}" . $path . $queryString;

        $ch = curl_init($url);
        $signedHeaders = signRequestHeaders('GET', $path, '', $user);
        $signedHeaders[] = 'Accept: application/json';

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $signedHeaders);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 4);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrno = curl_errno($ch);
        curl_close($ch);

        if (!$curlErrno && $httpCode > 0) {
            break;
        }
    }

    if ($curlErrno || !$response) {
        sendJsonResponse(['detail' => "Can't reach central IRDSS server for assessment form."], 503);
    }

    http_response_code($httpCode);
    header('Content-Type: application/json; charset=utf-8');
    echo $response;
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'submit') {
    $path = '/api/v1/assessments/submit';
    $rawInput = file_get_contents('php://input');

    $response = false;
    $httpCode = 0;
    $curlErrno = 0;

    foreach ($portsToTry as $port) {
        $url = "http://{$iolHost}:{$port}" . $path;

        $ch = curl_init($url);
        $signedHeaders = signRequestHeaders('POST', $path, $rawInput, $user);
        $signedHeaders[] = 'Accept: application/json';

        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $rawInput);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $signedHeaders);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 1);
        curl_setopt($ch, CURLOPT_TIMEOUT, 4);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrno = curl_errno($ch);
        curl_close($ch);

        if (!$curlErrno && $httpCode > 0) {
            break;
        }
    }

    if ($curlErrno || !$response) {
        sendJsonResponse(['detail' => "Can't reach central IRDSS server for assessment submission."], 503);
    }

    // A successful central submission is what actually satisfies the facility's
    // Service Assessment requirement -- mirror that locally so the dashboard's
    // assessment lock (driven by facilities.is_assessment_completed in MySQL) lifts.
    if ($httpCode >= 200 && $httpCode < 300) {
        $facilityId = (int)($user['facility']['id'] ?? 0);
        if ($facilityId > 0) {
            $pdo = getDbConnection();
            $stmt = $pdo->prepare('UPDATE facilities SET is_assessment_completed = TRUE WHERE id = :id');
            $stmt->execute([':id' => $facilityId]);
            $_SESSION['user']['facility']['is_assessment_completed'] = true;
        }
    }

    http_response_code($httpCode);
    header('Content-Type: application/json; charset=utf-8');
    echo $response;
    exit;
}

sendJsonResponse(['detail' => 'Invalid assessment action or method.'], 400);
