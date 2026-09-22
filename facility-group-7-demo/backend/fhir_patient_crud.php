<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Patient CRUD
// Create/Update/Search Patients on the FHIR sandbox
// ========================================================

require_once __DIR__ . '/config.php';

$action = trim($_GET['action'] ?? '');

if ($action === 'create') {
    // POST: Create new patient from form data (name, dob, gender, identifiers, PSGC address)
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    $built = fg7BuildPatientResource($body);
    if (isset($built['error'])) {
        sendJsonResponse(['success' => false, 'message' => $built['error']], 400);
    }

    [$code, $response, $errno, $err] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, 'Patient', json_encode($built['resource']));

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not create patient on FHIR server',
            'http_status' => $code,
            'error' => $err,
        ], $code ?: 502);
    }

    $patientId = $response['id'] ?? null;
    sendJsonResponse([
        'success' => true,
        'patient_id' => $patientId,
        'patient_name' => $built['display_name'],
        'message' => "Patient created with id: $patientId",
    ]);

} elseif ($action === 'update') {
    // PUT: Update an existing patient's fields, preserving its FG7 tracking identifier
    $id = trim($_GET['id'] ?? '');
    if (!$id) {
        sendJsonResponse(['success' => false, 'message' => 'Missing id parameter'], 400);
    }
    $body = json_decode(file_get_contents('php://input'), true) ?? [];

    [$getCode, $existing, $getErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($id));
    if ($getErrno || $getCode < 200 || $getCode >= 300 || ($existing['resourceType'] ?? '') !== 'Patient') {
        sendJsonResponse(['success' => false, 'message' => $getCode === 404 ? "Patient not found: $id" : 'Could not fetch patient', 'http_status' => $getCode], $getCode ?: 502);
    }

    $built = fg7BuildPatientResource($body, $existing['identifier'] ?? []);
    if (isset($built['error'])) {
        sendJsonResponse(['success' => false, 'message' => $built['error']], 400);
    }

    $updatedResource = $built['resource'];
    $updatedResource['id'] = $id;

    [$code, $response, $errno, $err] = sendFhirRequest('PUT', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($id), json_encode($updatedResource));

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not update patient on FHIR server',
            'http_status' => $code,
            'error' => $err,
        ], $code ?: 502);
    }

    sendJsonResponse([
        'success' => true,
        'patient_id' => $id,
        'patient_name' => $built['display_name'],
        'message' => "Patient $id updated",
    ]);

} elseif ($action === 'list') {
    // GET: List all patients with our prefix from FHIR sandbox
    // Ask the server for OUR patients by identifier system rather than pulling
    // the newest 100 Patients and filtering client-side. The sandbox is shared
    // with every other Connectathon team, so a busy period could push our
    // patients out of that window entirely and silently empty this list
    // (verified live: a plain _count=100 sweep surfaced only 1 of our records
    // because 99 of the slots were other teams' writes).
    $listUrl = 'Patient?identifier=' . rawurlencode(FG7_ID_SYSTEM . '|') . '&_sort=-_lastUpdated&_count=100';
    [$code, $response, $errno, $err] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $listUrl);

    if ($errno || $code < 200 || $code >= 300) {
        sendJsonResponse([
            'success' => false,
            'message' => 'Could not fetch patients from FHIR server',
            'http_status' => $code,
        ], $code ?: 502);
    }

    $patientsById = [];
    foreach (($response['entry'] ?? []) as $entry) {
        $res = $entry['resource'] ?? [];
        if (($res['resourceType'] ?? '') !== 'Patient') continue;

        // Belt-and-braces: the search already constrains by system, this also
        // enforces our value prefix.
        $hasFg7Id = false;
        foreach ($res['identifier'] ?? [] as $id) {
            if (($id['system'] ?? '') === FG7_ID_SYSTEM && strpos($id['value'] ?? '', FG7_ID_PREFIX) === 0) {
                $hasFg7Id = true;
                break;
            }
        }
        if (!$hasFg7Id) continue;

        $patient = fg7SimplifyPatient($res);
        $patient['record_source'] = 'registered';
        $patientsById[(string) $patient['id']] = $patient;
    }

    // Patients received through a referral remain the same FHIR Patient
    // resources. A receiving Encounter links them to this organization, so we
    // include those patients without cloning or changing their ownership.
    $orgId = trim($_GET['org_id'] ?? '');
    if ($orgId !== '') {
        $encounterUrl = 'Encounter?service-provider=' . rawurlencode("Organization/$orgId")
            . '&_include=Encounter:patient&_sort=-_lastUpdated&_count=100';
        [$encCode, $encResponse, $encErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $encounterUrl);

        if (!$encErrno && $encCode >= 200 && $encCode < 300) {
            $missingPatientIds = [];
            foreach (($encResponse['entry'] ?? []) as $entry) {
                $res = $entry['resource'] ?? [];
                if (($res['resourceType'] ?? '') === 'Patient' && !empty($res['id'])) {
                    $patient = fg7SimplifyPatient($res);
                    if (!isset($patientsById[(string) $patient['id']])) {
                        $patient['record_source'] = 'received_referral';
                        $patientsById[(string) $patient['id']] = $patient;
                    }
                } elseif (($res['resourceType'] ?? '') === 'Encounter') {
                    $linkedId = fg7RefId($res['subject']['reference'] ?? null);
                    if ($linkedId && !isset($patientsById[$linkedId])) $missingPatientIds[$linkedId] = true;
                }
            }

            // Some FHIR servers ignore _include. Fetch only missing linked
            // patients so the organization record still remains complete.
            foreach (array_keys($missingPatientIds) as $linkedId) {
                [$pCode, $pResource, $pErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($linkedId));
                if (!$pErrno && $pCode >= 200 && $pCode < 300 && ($pResource['resourceType'] ?? '') === 'Patient') {
                    $patient = fg7SimplifyPatient($pResource);
                    $patient['record_source'] = 'received_referral';
                    $patientsById[(string) $patient['id']] = $patient;
                }
            }
        }
    }

    $patients = array_values($patientsById);

    sendJsonResponse([
        'success' => true,
        'patients' => $patients,
        'total' => count($patients),
    ]);

} elseif ($action === 'get') {
    // GET: Fetch one patient by id
    $id = trim($_GET['id'] ?? '');
    if (!$id) {
        sendJsonResponse(['success' => false, 'message' => 'Missing id parameter'], 400);
    }

    [$code, $response, $errno, $err] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($id));

    if ($errno || $code < 200 || $code >= 300 || ($response['resourceType'] ?? '') !== 'Patient') {
        sendJsonResponse([
            'success' => false,
            'message' => $code === 404 ? "Patient not found: $id" : 'Could not fetch patient',
            'http_status' => $code,
        ], $code ?: 502);
    }

    sendJsonResponse([
        'success' => true,
        'patient' => fg7SimplifyPatient($response),
    ]);

} else {
    sendJsonResponse(['success' => false, 'message' => 'Unknown action. Use action=create, action=update, action=list, or action=get'], 400);
}
