<?php
// ========================================================
// API Endpoint: Send Patient Referral Payload to IOL
// Route: /api/v1/referral/initiate
// ========================================================

require_once __DIR__ . '/config.php';

// Only accept POST requests
if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse([
        'success' => false,
        'message' => 'Invalid request method. Only POST is allowed.'
    ], 405);
}

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please log in again.'
    ], 401);
}
requireRole(['doctor', 'nurse']);

// Support both form-urlencoded/multipart and raw JSON input
$input = $_POST;
$rawInput = file_get_contents('php://input');
if (empty($input) && !empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}

// Extract inputs with robust defaults
$patientId     = isset($input['patient_id']) && $input['patient_id'] !== '' ? (int)$input['patient_id'] : 1;
$latitude      = isset($input['latitude']) && $input['latitude'] !== '' ? (float)$input['latitude'] : 7.1907;
$longitude     = isset($input['longitude']) && $input['longitude'] !== '' ? (float)$input['longitude'] : 125.4553;
$salary        = isset($input['salary']) && $input['salary'] !== '' ? (float)$input['salary'] : (isset($input['monthly_salary']) ? (float)$input['monthly_salary'] : 12000.0);
$severity      = isset($input['severity']) && $input['severity'] !== '' ? (float)$input['severity'] : 3.0;
$reasonText    = !empty($input['reason_text']) ? trim((string)$input['reason_text']) : 'Severe Pneumonia';
$reasonCode    = !empty($input['reason_code']) ? trim((string)$input['reason_code']) : '233604007';
$diagnosis     = !empty($input['diagnosis']) ? trim((string)$input['diagnosis']) : 'Pneumonia';
$reasonDisplay = $reasonText;

$additionalReasonsRaw = $input['additional_reasons'] ?? [];
if (is_string($additionalReasonsRaw)) {
    $decodedAdditional = json_decode($additionalReasonsRaw, true);
    $additionalReasonsRaw = is_array($decodedAdditional) ? $decodedAdditional : [];
}
$referralReasons = [[
    'code' => $reasonCode,
    'label' => $reasonText,
    'is_primary' => true,
]];
foreach (is_array($additionalReasonsRaw) ? $additionalReasonsRaw : [] as $item) {
    $label = trim((string)(is_array($item) ? ($item['label'] ?? $item['text'] ?? '') : $item));
    $code = trim((string)(is_array($item) ? ($item['code'] ?? '') : ''));
    if ($label === '') continue;
    if ($code === '') {
        $code = strtoupper(trim(preg_replace('/[^A-Za-z0-9]+/', '_', $label), '_'));
    }
    $referralReasons[] = ['code' => $code, 'label' => $label, 'is_primary' => false];
}

if ($reasonText === '' || mb_strlen($reasonText) > 255 || count($referralReasons) > 4) {
    sendJsonResponse(['success' => false, 'message' => 'Choose one primary referral reason and no more than three additional reasons.'], 422);
}
$seenReasons = [];
foreach ($referralReasons as $reason) {
    if (mb_strlen($reason['label']) > 255) {
        sendJsonResponse(['success' => false, 'message' => 'Each referral reason must be 255 characters or fewer.'], 422);
    }
    $key = mb_strtolower($reason['label']);
    if (isset($seenReasons[$key])) {
        sendJsonResponse(['success' => false, 'message' => 'Referral reasons must be unique.'], 422);
    }
    $seenReasons[$key] = true;
}

// Clinical info entered by the referring doctor/nurse -- all optional
$chiefComplaint = isset($input['chief_complaint']) ? trim((string)$input['chief_complaint']) : '';
$vitalBp        = isset($input['vital_bp']) ? trim((string)$input['vital_bp']) : '';
$vitalHr        = isset($input['vital_hr']) && $input['vital_hr'] !== '' ? (int)$input['vital_hr'] : null;
$vitalRr        = isset($input['vital_rr']) && $input['vital_rr'] !== '' ? (int)$input['vital_rr'] : null;
$vitalTempC     = isset($input['vital_temp_c']) && $input['vital_temp_c'] !== '' ? (float)$input['vital_temp_c'] : null;
$vitalO2sat     = isset($input['vital_o2sat']) && $input['vital_o2sat'] !== '' ? (int)$input['vital_o2sat'] : null;
$vitalHeightCm  = isset($input['vital_height_cm']) && $input['vital_height_cm'] !== '' ? (float)$input['vital_height_cm'] : null;
$vitalWeightKg  = isset($input['vital_weight_kg']) && $input['vital_weight_kg'] !== '' ? (float)$input['vital_weight_kg'] : null;

// Patient status flags entered by the referring doctor/nurse -- all optional
$isPwd          = !empty($input['is_pwd']);
$isPregnant     = !empty($input['is_pregnant']);
$isSeniorCitizen = !empty($input['is_senior_citizen']);
$hasAllergy     = !empty($input['has_allergy']);
$allergyDetails = $hasAllergy && isset($input['allergy_details']) ? trim((string)$input['allergy_details']) : '';

// Basic validation
if ($patientId <= 0) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Missing or invalid required field: patient_id.'
    ], 400);
}

if (isset($_FILES['referral_attachments'])) {
    $uploadNames = $_FILES['referral_attachments']['name'] ?? [];
    $uploadNames = is_array($uploadNames) ? $uploadNames : [$uploadNames];
    $nonEmptyUploadCount = count(array_filter($uploadNames, fn($name) => trim((string)$name) !== ''));
    if ($nonEmptyUploadCount > 5) {
        sendJsonResponse(['success' => false, 'message' => 'A maximum of 5 referral attachments is allowed.'], 422);
    }
}

try {
    $pdo = getDbConnection();
    
    // Fetch patient demographics along with facility details
    $stmt = $pdo->prepare('
        SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.phone,
               p.region, p.province, p.city_municipality, p.barangay, p.zip_code,
               p.civil_status, p.philhealth_member, p.philhealth_number, p.philhealth_status_type,
               f.id as facility_id, f.code as facility_code, f.name as facility_name, f.api_key
        FROM patients p
        JOIN facilities f ON p.facility_id = f.id
        WHERE p.id = :id
    ');
    $stmt->execute([':id' => $patientId]);
    $patient = $stmt->fetch();

    if (!$patient) {
        sendJsonResponse([
            'success' => false,
            'message' => "Patient with ID {$patientId} not found in database."
        ], 404);
    }

    // Prevent referring a patient registered under a different facility
    if ((int)$patient['facility_id'] !== (int)($user['facility']['id'] ?? 0)) {
        sendJsonResponse([
            'success' => false,
            'message' => 'You can only refer patients registered at your own facility.'
        ], 403);
    }

    // Patient reference formatting for FHIR Encounter resource
    $patientRefId = 'P-' . sprintf('%06d', (int)$patient['id']);
    $fullName = trim($patient['first_name'] . ' ' . $patient['last_name']);
    $genderLower = strtolower(trim($patient['gender']));

    // Construct FHIR JSON Payload matching exact IOL schema specification
    $extensions = [
        [
            "url" => "http://irdss.gov.ph/fhir/StructureDefinition/salary",
            "valueDecimal" => (float)$salary
        ],
        [
            "url" => "http://irdss.gov.ph/fhir/StructureDefinition/severity",
            "valueDecimal" => (float)$severity
        ],
        [
            "url" => "http://irdss.gov.ph/fhir/StructureDefinition/latitude",
            "valueDecimal" => (float)$latitude
        ],
        [
            "url" => "http://irdss.gov.ph/fhir/StructureDefinition/longitude",
            "valueDecimal" => (float)$longitude
        ]
    ];

    if ($chiefComplaint !== '') {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/chiefComplaint", "valueString" => $chiefComplaint];
    }
    $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/diagnosis", "valueString" => $diagnosis];

    // Patient identity fields -- only ever decrypted centrally by the facility this
    // referral is finalized to (GET /api/v1/referral/{id}/patient-details)
    if (!empty($patient['phone'])) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/phone", "valueString" => $patient['phone']];
    }
    $addressParts = array_filter([$patient['barangay'], $patient['city_municipality'], $patient['province'], $patient['region'], $patient['zip_code']]);
    if (!empty($addressParts)) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/address", "valueString" => implode(', ', $addressParts)];
    }
    if (!empty($patient['civil_status'])) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/civilStatus", "valueString" => $patient['civil_status']];
    }
    if (($patient['philhealth_member'] ?? 'No') === 'Yes' && !empty($patient['philhealth_number'])) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/philhealthNumber", "valueString" => $patient['philhealth_number']];
    }
    if (!empty($patient['philhealth_status_type'])) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/philhealthStatus", "valueString" => $patient['philhealth_status_type']];
    }
    if ($vitalBp !== '') {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalBloodPressure", "valueString" => $vitalBp];
    }
    if ($vitalHr !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalHeartRate", "valueDecimal" => $vitalHr];
    }
    if ($vitalRr !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalRespiratoryRate", "valueDecimal" => $vitalRr];
    }
    if ($vitalTempC !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalTemperature", "valueDecimal" => $vitalTempC];
    }
    if ($vitalO2sat !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalOxygenSaturation", "valueDecimal" => $vitalO2sat];
    }
    if ($vitalHeightCm !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalHeight", "valueDecimal" => $vitalHeightCm];
    }
    if ($vitalWeightKg !== null) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/vitalWeight", "valueDecimal" => $vitalWeightKg];
    }
    if ($isPwd) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/isPwd", "valueBoolean" => true];
    }
    if ($isPregnant) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/isPregnant", "valueBoolean" => true];
    }
    if ($isSeniorCitizen) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/isSeniorCitizen", "valueBoolean" => true];
    }
    if ($hasAllergy) {
        $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/hasAllergy", "valueBoolean" => true];
        if ($allergyDetails !== '') {
            $extensions[] = ["url" => "http://irdss.gov.ph/fhir/StructureDefinition/allergyDetails", "valueString" => $allergyDetails];
        }
    }

    $payload = [
        "patient_record" => [
            "birthDate" => $patient['dob'],
            "extension" => $extensions,
            "gender" => $genderLower,
            "id" => $patientRefId,
            "name" => [
                [
                    "family" => $patient['last_name'],
                    "given" => [
                        $patient['first_name']
                    ]
                ]
            ],
            "resourceType" => "Patient"
        ],
        "reasonCode" => array_map(function ($reason) {
            return [
                "coding" => [
                    [
                        "code" => $reason['code'],
                        "display" => $reason['label'],
                        "system" => "http://irdss.gov.ph/fhir/CodeSystem/referral-reason"
                    ]
                ],
                "text" => $reason['label']
            ];
        }, $referralReasons),
        "resourceType" => "Encounter",
        "status" => "planned",
        "subject" => [
            "display" => $fullName,
            "reference" => "Patient/" . $patientRefId
        ],
        "serviceProvider" => [
            "display" => $patient['facility_name'],
            "reference" => "Organization/" . $patient['facility_code']
        ]
    ];

    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

    [$httpCode, $iolResponseData, $curlErrno, $curlError] = sendSignedIolRequest(
        'POST',
        '/api/v1/referral/initiate',
        $payloadJson,
        $patient['facility_code'],
        $patient['facility_name']
    );

    // DEBUG: Log raw IOL response for troubleshooting
    if ($httpCode !== 200 && $httpCode !== 201) {
        error_log("IOL Response ($httpCode): " . substr(is_string($iolResponseData) ? $iolResponseData : json_encode($iolResponseData), 0, 500));
    }

    $referralId = null;

    // Handle cURL connection / signing failure gracefully
    if ($curlErrno) {
        $httpCode = $httpCode ?: 503;
        $iolResponseData = "Connection Error (#{$curlErrno}): {$curlError}. Please ensure the Interoperability Layer (IOL) service is reachable.";
        $isSuccess = false;
        $errorMessage = "Can't reach the server, contact devs @ irdss.devs@upmin.edu.ph";
    } else {
        $isSuccess = ($httpCode >= 200 && $httpCode < 300);
        $decodedRes = is_array($iolResponseData) ? $iolResponseData : null;

        $referralId = null;
        if (is_array($decodedRes)) {
            $referralId = $decodedRes['referral_id'] ?? $decodedRes['referral_tracking_id'] ?? $decodedRes['id'] ?? $decodedRes['referralId'] ?? ($decodedRes['data']['referral_id'] ?? ($decodedRes['data']['id'] ?? null));
        }

        if (empty($referralId)) {
            $rawStr = is_string($iolResponseData) ? $iolResponseData : json_encode($iolResponseData);
            if (preg_match('#(ref_[a-zA-Z0-9_\-]+)#i', $rawStr, $m)) {
                $referralId = $m[1];
            }
        }

        if (!$isSuccess) {
            // User-friendly error messages mapped by HTTP status code
            $errorMessageMap = [
                400 => 'Invalid referral data. Please check all fields and try again.',
                401 => 'Authentication failed. Please contact your administrator.',
                403 => 'Permission denied. Your facility may not be authorized for this action.',
                404 => 'Receiving facility not found. Please verify the referral details.',
                405 => 'Invalid request method. Please try again.',
                409 => 'This referral cannot be processed because a duplicate or conflicting record already exists.',
                422 => 'The referral data could not be processed. Please verify patient information and try again.',
                500 => 'The server encountered an error. Please try again later or contact support.',
                502 => 'Gateway error. The central server may be temporarily unavailable.',
                503 => 'The central server is currently unavailable. Please try again in a few moments.'
            ];

            // Use mapped message, fall back to generic error for unknown codes
            if (isset($errorMessageMap[$httpCode])) {
                $errorMessage = $errorMessageMap[$httpCode];
            } else {
                $errorMessage = 'An error occurred while processing the referral. Please try again or contact support.';
            }
        } else {
            $errorMessage = null;
        }
    }

    // Keep a local MySQL copy of every initiated referral regardless of whether the
    // central IOL transmission succeeded, so the referring facility always has a
    // record of what was sent even if the central server was unreachable.
    $localReferralId = null;
    try {
        $localStmt = $pdo->prepare('
            INSERT INTO initiated_referrals
                (hospital_id, referral_id, patient_id, patient_name, reason, chief_complaint,
                 diagnosis, vital_bp, vital_hr, vital_rr, vital_temp_c, vital_o2sat,
                 status, sync_status, http_status)
            VALUES
                (:hospital_id, :referral_id, :patient_id, :patient_name, :reason, :chief_complaint,
                 :diagnosis, :vital_bp, :vital_hr, :vital_rr, :vital_temp_c, :vital_o2sat,
                 :status, :sync_status, :http_status)
        ');
        $localStmt->execute([
            ':hospital_id'     => (int)$patient['facility_id'],
            ':referral_id'     => $referralId,
            ':patient_id'      => (int)$patient['id'],
            ':patient_name'    => $fullName,
            ':reason'          => $reasonText,
            ':chief_complaint' => $chiefComplaint !== '' ? $chiefComplaint : null,
            ':diagnosis'       => $diagnosis,
            ':vital_bp'        => $vitalBp !== '' ? $vitalBp : null,
            ':vital_hr'        => $vitalHr,
            ':vital_rr'        => $vitalRr,
            ':vital_temp_c'    => $vitalTempC,
            ':vital_o2sat'     => $vitalO2sat,
            ':status'          => $isSuccess ? 'AWAITING' : 'SEND_FAILED',
            ':sync_status'     => $isSuccess ? 'SENT' : 'FAILED',
            ':http_status'     => $httpCode
        ]);
        $localReferralId = (int)$pdo->lastInsertId();
        $reasonStmt = $pdo->prepare('
            INSERT INTO initiated_referral_reasons
                (initiated_referral_id, reason_code, reason_label, is_primary, sort_order)
            VALUES (:referral_id, :code, :label, :is_primary, :sort_order)
        ');
        foreach ($referralReasons as $index => $reason) {
            $reasonStmt->execute([
                ':referral_id' => $localReferralId,
                ':code' => $reason['code'],
                ':label' => $reason['label'],
                ':is_primary' => $reason['is_primary'] ? 1 : 0,
                ':sort_order' => $index,
            ]);
        }
    } catch (Exception $e) {
        // Local persistence is a best-effort record -- never block the referral
        // response on it, since the actual referral has already been (or failed to be)
        // transmitted to IOL by this point.
    }

    if ($isSuccess) {
        logAuditEvent($user, 'REFERRAL_SENT', $referralId, $fullName, $reasonText);
    }

    $attachmentUploads = [];
    if ($isSuccess && $referralId && isset($_FILES['referral_attachments'])) {
        $files = $_FILES['referral_attachments'];
        $names = is_array($files['name'] ?? null) ? $files['name'] : [$files['name'] ?? ''];
        $tmpNames = is_array($files['tmp_name'] ?? null) ? $files['tmp_name'] : [$files['tmp_name'] ?? ''];
        $errors = is_array($files['error'] ?? null) ? $files['error'] : [$files['error'] ?? UPLOAD_ERR_NO_FILE];
        $sizes = is_array($files['size'] ?? null) ? $files['size'] : [$files['size'] ?? 0];

        foreach (array_slice(array_keys($names), 0, 5) as $i) {
            if (($errors[$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
            $fileName = basename((string)$names[$i]);
            if (($errors[$i] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($tmpNames[$i] ?? '')) {
                $attachmentUploads[] = ['filename' => $fileName, 'success' => false, 'message' => 'Upload was not received correctly.'];
                continue;
            }
            if (($sizes[$i] ?? 0) > 5 * 1024 * 1024) {
                $attachmentUploads[] = ['filename' => $fileName, 'success' => false, 'message' => 'File exceeds 5 MB.'];
                continue;
            }
            $bytes = file_get_contents($tmpNames[$i]);
            $mime = (new finfo(FILEINFO_MIME_TYPE))->file($tmpNames[$i]) ?: 'application/octet-stream';
            [$uploadCode, $uploadRaw, $uploadErrno] = sendSignedIolBinaryRequest(
                'POST',
                "/api/v1/referral/{$referralId}/attachments",
                $bytes,
                $mime,
                $patient['facility_code'],
                $patient['facility_name'],
                [
                    'X-Workflow-Stage: REFERRAL',
                    'X-Attachment-Type: PHILHEALTH_MDR',
                    'X-Original-Filename: ' . rawurlencode($fileName),
                ]
            );
            $uploadBody = json_decode((string)$uploadRaw, true);
            $attachmentUploads[] = [
                'filename' => $fileName,
                'success' => !$uploadErrno && $uploadCode >= 200 && $uploadCode < 300,
                'message' => $uploadBody['detail'] ?? ($uploadErrno ? 'Could not reach the attachment service.' : null),
            ];
        }
    }

    $failedAttachmentCount = count(array_filter($attachmentUploads, fn($item) => !$item['success']));

    // Return actual HTTP status code: 200/201 on success, error code on failure
    $responseStatusCode = $isSuccess ? 200 : $httpCode;

    sendJsonResponse([
        'success'      => $isSuccess,
        'http_status'  => $httpCode,
        'message'      => $errorMessage,
        'referral_id'  => $referralId,
        'referral_reasons' => $referralReasons,
        'attachment_uploads' => $attachmentUploads,
        'attachment_warning' => $failedAttachmentCount > 0 ? "{$failedAttachmentCount} attachment(s) could not be uploaded. The referral was still sent." : null,
        'iol_response' => $iolResponseData,
        'payload_sent' => $payload
    ], $responseStatusCode);

} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while processing referral: ' . $e->getMessage()
    ], 500);
}
