<?php
// ========================================================
// API Endpoint: Fetch Full Patient Details for a Transferred-In Referral
// Local-to-local first: if this patient already arrived (local record exists with a
// stored snapshot), serve it straight from MySQL -- no central round-trip needed.
// Falls back to the live central GET /patient-details call only when no local copy
// exists yet (referral finalized/accepted but not yet marked Arrived).
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/crypto_helper.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['detail' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['doctor', 'nurse']);

$referralId = isset($_GET['referral_id']) ? trim((string)$_GET['referral_id']) : '';
if ($referralId === '') {
    sendJsonResponse(['detail' => 'Missing required field: referral_id.'], 400);
}

$facilityId = (int)($user['facility']['id'] ?? 0);

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('
        SELECT id, transferred_details_snapshot
        FROM patients
        WHERE source_referral_id = :rid AND facility_id = :fid
        LIMIT 1
    ');
    $stmt->execute([':rid' => $referralId, ':fid' => $facilityId]);
    $row = $stmt->fetch();

    if ($row && !empty($row['transferred_details_snapshot'])) {
        $snapshot = json_decode($row['transferred_details_snapshot'], true);
        if (is_array($snapshot)) {
            $snapshot['_source'] = 'local';
            // Lets the frontend jump straight to the Refer Patient flow for this same
            // local record (e.g. "Refer to Another Facility" from Mark as Out) without
            // a second lookup.
            $snapshot['local_patient_id'] = (int)$row['id'];
            sendJsonResponse($snapshot, 200);
        }
    }
} catch (Exception $e) {
    // Fall through to the central fetch below if the local lookup itself failed
}

// No local snapshot yet (patient hasn't been marked Arrived) -- fetch live from central
$iolHost = $_ENV['IOL_HOST'] ?? '127.0.0.1';
$portsToTry = [8081, 8000, 8001];
$path = "/api/v1/referral/{$referralId}/patient-details";

$response = false;
$httpCode = 0;
$curlErrno = 0;

foreach ($portsToTry as $port) {
    $url = "http://{$iolHost}:{$port}" . $path;

    $ch = curl_init($url);
    $signedHeaders = signRequestHeaders('GET', $path, '', $user);
    $signedHeaders[] = 'Accept: application/json';

    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $signedHeaders);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErrno = curl_errno($ch);
    curl_close($ch);

    if (!$curlErrno && $httpCode > 0) {
        break;
    }
}

if ($curlErrno || !$response) {
    sendJsonResponse(['detail' => "Can't reach the central server to retrieve patient details."], 503);
}

$decoded = json_decode($response, true);
if (is_array($decoded) && $httpCode >= 200 && $httpCode < 300) {
    $decoded['_source'] = 'central';
    http_response_code($httpCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($decoded);
    exit;
}

http_response_code($httpCode);
header('Content-Type: application/json; charset=utf-8');
echo $response;
