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
$reasonDisplay = !empty($input['reason_display']) ? trim((string)$input['reason_display']) : 'Pneumonia';

// Basic validation
if ($patientId <= 0) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Missing or invalid required field: patient_id.'
    ], 400);
}

try {
    $pdo = getDbConnection();
    
    // Fetch patient demographics along with hospital details
    $stmt = $pdo->prepare('
        SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.phone, h.code as hospital_code, h.name as hospital_name, h.api_key 
        FROM patients p
        JOIN hospitals h ON p.hospital_id = h.id
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

    // Patient reference formatting for FHIR Encounter resource
    $patientRefId = 'P-' . sprintf('%06d', (int)$patient['id']);
    $fullName = trim($patient['first_name'] . ' ' . $patient['last_name']);
    $genderLower = strtolower(trim($patient['gender']));

    // Construct FHIR JSON Payload matching exact IOL schema specification
    $payload = [
        "patient_record" => [
            "birthDate" => $patient['dob'],
            "extension" => [
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
            ],
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
            "display" => $patient['hospital_name'],
            "reference" => "Organization/" . $patient['hospital_code']
        ]
    ];

    $payloadJson = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

    // Determine hospital API Key (already fresh from the live join above; fall back
    // to a fresh session lookup, never the raw cached $_SESSION value, if it's empty)
    $apiKey = !empty($patient['api_key']) ? $patient['api_key'] : '';
    if (empty($apiKey)) {
        $apiKey = getFreshApiKeyForLoggedInHospital() ?? '';
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
