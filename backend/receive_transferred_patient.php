<?php
// ========================================================
// API Endpoint: Convert a Finalized Incoming Referral into a Local Patient Record
// Triggered when the receiving facility marks a transferred patient as Arrived --
// not on finalize, not on merely viewing details, since a referral can be finalized
// and never actually arrive.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/crypto_helper.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['doctor', 'nurse']);

$input = $_POST;
$rawInput = file_get_contents('php://input');
if (empty($input) && !empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}

$referralId = isset($input['referral_id']) ? trim((string)$input['referral_id']) : '';
if ($referralId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing required field: referral_id.'], 400);
}

// Vitals taken by the receiving facility at the moment of arrival -- all optional,
// never blocks marking the patient as arrived if left blank
$arrivalVitals = [
    'vital_bp'      => isset($input['arrival_vital_bp']) ? trim((string)$input['arrival_vital_bp']) : '',
    'vital_hr'      => isset($input['arrival_vital_hr']) ? trim((string)$input['arrival_vital_hr']) : '',
    'vital_rr'      => isset($input['arrival_vital_rr']) ? trim((string)$input['arrival_vital_rr']) : '',
    'vital_temp_c'  => isset($input['arrival_vital_temp_c']) ? trim((string)$input['arrival_vital_temp_c']) : '',
    'vital_o2sat'   => isset($input['arrival_vital_o2sat']) ? trim((string)$input['arrival_vital_o2sat']) : ''
];
$arrivalVitals = array_filter($arrivalVitals, fn($v) => $v !== '');

$iolHost = $_ENV['IOL_HOST'] ?? '127.0.0.1';
$portsToTry = [8081, 8000, 8001];

function callCentralReferralApi($method, $path, $body, $user, $iolHost, $portsToTry) {
    // JSON_FORCE_OBJECT ensures an empty PHP array (e.g. no arrival vitals entered)
    // still encodes as "{}" rather than "[]" -- the IOL endpoint expects a JSON object
    // matching its Pydantic schema, and an empty array fails that validation.
    $bodyJson = $body !== null ? json_encode($body, JSON_FORCE_OBJECT) : '';

    foreach ($portsToTry as $port) {
        $url = "http://{$iolHost}:{$port}" . $path;

        $ch = curl_init($url);
        $signedHeaders = signRequestHeaders($method, $path, $bodyJson, $user);
        $signedHeaders[] = 'Accept: application/json';

        curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
        if ($bodyJson !== '') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $bodyJson);
        }
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $signedHeaders);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
        curl_setopt($ch, CURLOPT_TIMEOUT, 6);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErrno = curl_errno($ch);
        curl_close($ch);

        if (!$curlErrno && $httpCode > 0) {
            return ['code' => $httpCode, 'data' => json_decode($response, true)];
        }
    }

    return ['code' => 503, 'data' => null];
}

try {
    // Step 1: stamp arrival centrally. This also re-verifies (server-side) that this
    // referral was actually finalized to this facility -- can't be spoofed client-side.
    $arriveRes = callCentralReferralApi('PATCH', "/api/v1/referral/{$referralId}/arrive", $arrivalVitals, $user, $iolHost, $portsToTry);
    if ($arriveRes['code'] < 200 || $arriveRes['code'] >= 300) {
        $detail = $arriveRes['data']['detail'] ?? "Can't reach the central server to confirm arrival.";
        sendJsonResponse(['success' => false, 'message' => $detail], $arriveRes['code'] ?: 502);
    }

    // Step 2: pull the decrypted patient identity -- gated the same way centrally
    $detailsRes = callCentralReferralApi('GET', "/api/v1/referral/{$referralId}/patient-details", null, $user, $iolHost, $portsToTry);
    if ($detailsRes['code'] < 200 || $detailsRes['code'] >= 300) {
        $detail = $detailsRes['data']['detail'] ?? "Can't reach the central server to retrieve patient details.";
        sendJsonResponse(['success' => false, 'message' => $detail], $detailsRes['code'] ?: 502);
    }
    $details = $detailsRes['data'];

    $pdo = getDbConnection();
    $facilityId = (int)($user['facility']['id'] ?? 0);

    // Idempotency: don't create a second local record if this patient already arrived before
    $existingStmt = $pdo->prepare('SELECT id FROM patients WHERE source_referral_id = :rid AND facility_id = :fid LIMIT 1');
    $existingStmt->execute([':rid' => $referralId, ':fid' => $facilityId]);
    $existing = $existingStmt->fetch();
    if ($existing) {
        sendJsonResponse([
            'success' => true,
            'message' => 'This patient was already added to your local records.',
            'patient_id' => (int)$existing['id']
        ], 200);
    }

    $fullName = trim((string)($details['full_name'] ?? ''));
    $nameParts = $fullName !== '' ? preg_split('/\s+/', $fullName, 2) : ['Unknown', 'Patient'];
    $firstName = $nameParts[0] ?? 'Unknown';
    $lastName = $nameParts[1] ?? 'Patient';

    $genderMap = ['male' => 'Male', 'female' => 'Female'];
    $gender = $genderMap[strtolower((string)($details['gender'] ?? ''))] ?? 'Other';

    $dob = !empty($details['date_of_birth']) ? $details['date_of_birth'] : date('Y-m-d');
    $phone = !empty($details['phone']) ? $details['phone'] : '';
    $civilStatus = !empty($details['civil_status']) ? $details['civil_status'] : null;
    $philhealthNumber = !empty($details['philhealth_number']) ? $details['philhealth_number'] : null;
    $philhealthStatus = !empty($details['philhealth_status']) ? $details['philhealth_status'] : null;
    $philhealthMember = ($philhealthNumber || $philhealthStatus) ? 'Yes' : 'No';
    $address = !empty($details['address']) ? $details['address'] : null;

    // Snapshot the full central response (including clinical fields that aren't part of
    // the local patient schema -- diagnosis, vitals, reason) so future "View Full Patient
    // Details" clicks can be served local-to-local instead of re-hitting central every time.
    $insertStmt = $pdo->prepare('
        INSERT INTO patients
            (facility_id, first_name, last_name, dob, gender, civil_status, phone,
             philhealth_member, philhealth_number, philhealth_status_type,
             source_referral_id, source_facility, transferred_address, transferred_details_snapshot, created_by_user_id)
        VALUES
            (:facility_id, :first_name, :last_name, :dob, :gender, :civil_status, :phone,
             :philhealth_member, :philhealth_number, :philhealth_status_type,
             :source_referral_id, :source_facility, :transferred_address, :transferred_details_snapshot, :created_by_user_id)
    ');
    $insertStmt->execute([
        ':facility_id' => $facilityId,
        ':first_name' => $firstName,
        ':last_name' => $lastName,
        ':dob' => $dob,
        ':gender' => $gender,
        ':civil_status' => $civilStatus,
        ':phone' => $phone,
        ':philhealth_member' => $philhealthMember,
        ':philhealth_number' => $philhealthNumber,
        ':philhealth_status_type' => $philhealthStatus,
        ':source_referral_id' => $referralId,
        ':source_facility' => $details['referring_facility'] ?? null,
        ':transferred_address' => $address,
        ':transferred_details_snapshot' => json_encode($details),
        ':created_by_user_id' => (int)($user['id'] ?? 0)
    ]);

    sendJsonResponse([
        'success' => true,
        'message' => 'Patient marked as arrived and added to your local patient records.',
        'patient_id' => (int)$pdo->lastInsertId(),
        'arrived_at' => $arriveRes['data']['arrived_at'] ?? null
    ], 200);

} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'An error occurred: ' . $e->getMessage()], 500);
}
