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
$reasonDisplay = $diagnosis;

// Clinical info entered by the referring doctor/nurse -- all optional
$chiefComplaint = isset($input['chief_complaint']) ? trim((string)$input['chief_complaint']) : '';
$vitalBp        = isset($input['vital_bp']) ? trim((string)$input['vital_bp']) : '';
$vitalHr        = isset($input['vital_hr']) && $input['vital_hr'] !== '' ? (int)$input['vital_hr'] : null;
$vitalRr        = isset($input['vital_rr']) && $input['vital_rr'] !== '' ? (int)$input['vital_rr'] : null;
$vitalTempC     = isset($input['vital_temp_c']) && $input['vital_temp_c'] !== '' ? (float)$input['vital_temp_c'] : null;
$vitalO2sat     = isset($input['vital_o2sat']) && $input['vital_o2sat'] !== '' ? (int)$input['vital_o2sat'] : null;

// Basic validation
if ($patientId <= 0) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Missing or invalid required field: patient_id.'
    ], 400);
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
        "reasonCode" => [
            [
                "coding" => [
                    [
                        "code" => $reasonCode,
                        "display" => $reasonDisplay,
                        "system" => "http://snomed.info/sct"
                    ]
                ],
                "text" => $reasonText
            ]
        ],
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

    // Determine hospital API Key (already fresh from the live join above; fall back
    // to a fresh session lookup, never the raw cached $_SESSION value, if it's empty)
    $apiKey = !empty($patient['api_key']) ? $patient['api_key'] : '';
    if (empty($apiKey)) {
        $apiKey = getFreshApiKeyForLoggedInFacility() ?? '';
    }

    $requestHeaders = [
        'Content-Type: application/json',
        'Content-Length: ' . strlen($payloadJson)
    ];
    if (!empty($apiKey)) {
        $requestHeaders[] = 'X-API-Key: ' . $apiKey;
    }

    // Send payload to IOL route /api/v1/referral/initiate using the configured endpoint
    $ch = curl_init(IOL_ENDPOINT_URL);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "POST");
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payloadJson);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $requestHeaders);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 3);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $iolResponse = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErrno = curl_errno($ch);
    $curlError = curl_error($ch);
    curl_close($ch);

    $referralId = null;

    // Handle cURL connection failure gracefully
    if ($curlErrno || !$iolResponse) {
        $httpCode = 503;
        $iolResponseData = "cURL Connection Error (#{$curlErrno}): {$curlError}. Please ensure the Interoperability Layer (IOL) service is reachable at " . IOL_ENDPOINT_URL . ".";
        $isSuccess = false;
        $errorMessage = "Can't reach the server, contact devs @ irdss.devs@upmin.edu.ph";
    } else {
        $isSuccess = ($httpCode >= 200 && $httpCode < 300);
        $decodedRes = json_decode($iolResponse, true);
        $iolResponseData = ($decodedRes !== null) ? $decodedRes : $iolResponse;

        $referralId = null;
        if (is_array($decodedRes)) {
            $referralId = $decodedRes['referral_id'] ?? $decodedRes['referral_tracking_id'] ?? $decodedRes['id'] ?? $decodedRes['referralId'] ?? ($decodedRes['data']['referral_id'] ?? ($decodedRes['data']['id'] ?? null));
        }

        if (empty($referralId)) {
            $rawStr = is_string($iolResponse) ? $iolResponse : json_encode($iolResponse);
            if (preg_match('#(ref_[a-zA-Z0-9_\-]+)#i', $rawStr, $m)) {
                $referralId = $m[1];
            }
        }

        if (!$isSuccess) {
            $statusTextMap = [
                400 => 'Bad Request',
                401 => 'Unauthorized',
                403 => 'Forbidden',
                404 => 'Not Found',
                405 => 'Method Not Allowed',
                422 => 'Unprocessable Entity',
                500 => 'Internal Server Error',
                502 => 'Bad Gateway',
                503 => 'Service Unavailable'
            ];
            $statusText = $statusTextMap[$httpCode] ?? 'Error';

            $detail = '';
            if (is_array($decodedRes)) {
                if (!empty($decodedRes['detail'])) {
                    $detail = is_array($decodedRes['detail']) ? json_encode($decodedRes['detail']) : $decodedRes['detail'];
                } elseif (!empty($decodedRes['message'])) {
                    $detail = $decodedRes['message'];
                }
            } elseif (is_string($iolResponse) && !empty($iolResponse)) {
                $detail = trim(strip_tags($iolResponse));
            }

            if ($httpCode >= 500) {
                $errorMessage = "An internal server error occurred while processing the referral request.";
            } elseif (!empty($detail)) {
                $errorMessage = $detail;
            } else {
                $errorMessage = $statusText;
            }
        } else {
            $errorMessage = null;
        }
    }

    // Keep a local MySQL copy of every initiated referral regardless of whether the
    // central IOL transmission succeeded, so the referring facility always has a
    // record of what was sent even if the central server was unreachable.
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
    } catch (Exception $e) {
        // Local persistence is a best-effort record -- never block the referral
        // response on it, since the actual referral has already been (or failed to be)
        // transmitted to IOL by this point.
    }

    sendJsonResponse([
        'success'      => $isSuccess,
        'http_status'  => $httpCode,
        'message'      => $errorMessage,
        'referral_id'  => $referralId,
        'iol_response' => $iolResponseData,
        'payload_sent' => $payload
    ], 200);

} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while processing referral: ' . $e->getMessage()
    ], 500);
}
