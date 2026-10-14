<?php
// ========================================================
// API Endpoint: Convert a Finalized Incoming Referral into a Local Patient Record
// Triggered when the receiving facility marks a transferred patient as Arrived --
// not on finalize, not on merely viewing details, since a referral can be finalized
// and never actually arrive.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/crypto_helper.php';
require_once __DIR__ . '/patient_transfer.php';

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
$arrivalVitals['vital_height_cm']=trim((string)($input['arrival_vital_height_cm'] ?? ''));
$arrivalVitals['vital_weight_kg']=trim((string)($input['arrival_vital_weight_kg'] ?? ''));
if (!empty($input['arrival_observed_at'])) $arrivalVitals['observed_at']=(string)$input['arrival_observed_at'];
$arrivalVitals['oxygen_method']=(string)($input['arrival_oxygen_method'] ?? 'unknown');
$arrivalVitals = array_filter($arrivalVitals, fn($v) => $v !== '');

$duplicateChoice = isset($input['duplicate_choice']) ? trim((string)$input['duplicate_choice']) : null;
$linkPatientId = isset($input['link_patient_id']) ? (int)$input['link_patient_id'] : null;

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
    // Only run on the first pass ($duplicateChoice absent) -- a resubmission after the
    // staff answers the "possible duplicate" prompt means arrival was already stamped.
    $arriveRes = null;
    if ($duplicateChoice === null) {
        $arriveRes = callCentralReferralApi('PATCH', "/api/v1/referral/{$referralId}/arrive", $arrivalVitals, $user, $iolHost, $portsToTry);
        if ($arriveRes['code'] < 200 || $arriveRes['code'] >= 300) {
            $detail = $arriveRes['data']['detail'] ?? "Can't reach the central server to confirm arrival.";
            sendJsonResponse(['success' => false, 'message' => $detail], $arriveRes['code'] ?: 502);
        }
    }

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

    // IoL authorizes access; the sender returns identity encrypted to this hospital.
    $detailsRes = callCentralReferralApi('GET', "/api/v1/referral/{$referralId}/patient-details", null, $user, $iolHost, $portsToTry);
    if ($detailsRes['code'] < 200 || $detailsRes['code'] >= 300) {
        $detail = $detailsRes['data']['detail'] ?? "Can't reach the central server to retrieve patient details.";
        sendJsonResponse(['success' => false, 'message' => $detail], $detailsRes['code'] ?: 502);
    }
    $details = decryptDirectPatientDetails($detailsRes['data'], $user);

    $fullName = trim((string)($details['full_name'] ?? ''));
    $nameParts = $fullName !== '' ? preg_split('/\s+/', $fullName, 2) : ['Unknown', 'Patient'];
    $firstName = $details['first_name'] ?? ($nameParts[0] ?? 'Unknown');
    $lastName = $details['last_name'] ?? ($nameParts[1] ?? 'Patient');

    $genderMap = ['male' => 'Male', 'female' => 'Female'];
    $gender = $genderMap[strtolower((string)($details['gender'] ?? ''))] ?? 'Other';

    $dobSuppliedByCentral = !empty($details['date_of_birth']);
    $dob = $dobSuppliedByCentral ? $details['date_of_birth'] : date('Y-m-d');
    $phone = !empty($details['phone']) ? $details['phone'] : '';
    $civilStatus = !empty($details['civil_status']) ? $details['civil_status'] : null;
    $philhealthNumber = !empty($details['philhealth_number']) ? $details['philhealth_number'] : null;
    $philhealthStatus = !empty($details['philhealth_status']) ? $details['philhealth_status'] : null;
    $philhealthMember = ($philhealthNumber || $philhealthStatus) ? 'Yes' : 'No';
    $address = !empty($details['address']) ? $details['address'] : null;
    $identity = [
        'first_name' => $firstName,
        'middle_name' => $details['middle_name'] ?? null,
        'last_name' => $lastName,
        'suffix' => $details['suffix'] ?? null,
        'dob' => $dob,
        'gender' => $gender,
        'civil_status' => $civilStatus,
        'phone' => $phone,
        'region' => $details['region'] ?? null,
        'province' => $details['province'] ?? null,
        'city_municipality' => $details['city_municipality'] ?? null,
        'barangay' => $details['barangay'] ?? null,
        'zip_code' => $details['zip_code'] ?? null,
        'philhealth_member' => $philhealthMember,
        'philhealth_number' => $philhealthNumber,
        'philhealth_status_type' => $philhealthStatus,
        'is_4ps_member' => $details['is_4ps_member'] ?? 'No',
        'transferred_address' => $address,
    ];
    $snapshotCiphertext = encryptLocalTransferSnapshot($details);

    // Only prompt on the first pass, and only when central actually supplied a real DOB --
    // a fabricated "today" DOB (see $dobSuppliedByCentral above) would false-positive-match
    // every other patient arriving the same day with an unknown birthdate.
    if ($duplicateChoice === null && $dobSuppliedByCentral) {
        $match = findPossibleDuplicatePatient($pdo, $facilityId, $firstName, $lastName, $dob);
        if ($match) {
            sendJsonResponse([
                'success' => false,
                'possible_duplicate' => true,
                'existing_patient' => [
                    'id' => (int)$match['id'],
                    'full_name' => trim($match['first_name'] . ' ' . $match['last_name']),
                    'dob' => $match['dob'],
                    'registered_at' => $match['created_at']
                ],
                'message' => 'A similar patient record already exists at your facility.'
            ], 200);
        }
    }

    if ($duplicateChoice === 'link' && $linkPatientId) {
        $linkStmt = $pdo->prepare('
            UPDATE patients SET
                source_referral_id = :source_referral_id,
                source_facility = :source_facility,
                transferred_address = NULL,
                transferred_details_snapshot = NULL,
                transferred_snapshot_ciphertext = :transferred_snapshot_ciphertext,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid AND facility_id = :fid
        ');
        $linkStmt->execute([
            ':source_referral_id' => $referralId,
            ':source_facility' => $details['referring_facility'] ?? null,
            ':transferred_snapshot_ciphertext' => $snapshotCiphertext,
            ':pid' => $linkPatientId,
            ':fid' => $facilityId
        ]);

        $newPatientId = $linkPatientId;
        logAuditEvent($user, 'PATIENT_ARRIVED_LINKED', $referralId, $fullName, "Linked to existing patient #{$linkPatientId}");
    } else {
        // Snapshot the full central response (including clinical fields that aren't part of
        // the local patient schema -- diagnosis, vitals, reason) so future "View Full Patient
        // Details" clicks can be served local-to-local instead of re-hitting central every time.
        $insertStmt = $pdo->prepare('
            INSERT INTO patients
                (facility_id, identity_ciphertext, identity_blind_index, identity_key_version,
                 source_referral_id, source_facility, transferred_snapshot_ciphertext, created_by_user_id)
            VALUES
                (:facility_id, :identity_ciphertext, :identity_blind_index, :identity_key_version,
                 :source_referral_id, :source_facility, :transferred_snapshot_ciphertext, :created_by_user_id)
        ');
        $insertStmt->execute([
            ':facility_id' => $facilityId,
            ':identity_ciphertext' => encryptLocalPatientIdentity($identity),
            ':identity_blind_index' => localPatientIdentityBlindIndex($firstName, $lastName, $dob),
            ':identity_key_version' => LOCAL_DATA_ENVELOPE_VERSION,
            ':source_referral_id' => $referralId,
            ':source_facility' => $details['referring_facility'] ?? null,
            ':transferred_snapshot_ciphertext' => $snapshotCiphertext,
            ':created_by_user_id' => (int)($user['id'] ?? 0)
        ]);

        $newPatientId = (int)$pdo->lastInsertId();
        logAuditEvent($user, 'PATIENT_ARRIVED', $referralId, $fullName);
    }

    // The complete identity is now encrypted in this hospital's local database.
    // Acknowledge delivery so Central IRDSS can delete its temporary encrypted copy.
    $ackRes = callCentralReferralApi(
        'POST',
        "/api/v1/referral/{$referralId}/patient-details/acknowledge",
        [],
        $user,
        $iolHost,
        $portsToTry
    );

    sendJsonResponse([
        'success' => true,
        'message' => 'Patient marked as arrived and added to your local patient records.',
        'patient_id' => $newPatientId,
        'arrived_at' => $arriveRes['data']['arrived_at'] ?? null,
        'central_identity_acknowledged' => $ackRes['code'] >= 200 && $ackRes['code'] < 300
    ], 200);

} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'The patient record could not be transferred securely. Check that the sending hospital is online and try again.'], 503);
}
