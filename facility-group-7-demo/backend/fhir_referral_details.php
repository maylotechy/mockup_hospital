<?php
// ========================================================
// FACILITY-GROUP-7 Demo -- Full Referral Detail
// Assembles the chief complaint, working impression, vitals, and referral
// note for one ServiceRequest, so the receiving facility can review the
// clinical picture before Accepting -- not just the patient name/category
// the incoming-referrals table shows.
//
// Verified live: Condition?encounter=Encounter/{id} and
// Observation?encounter=Encounter/{id} both work on this sandbox and return
// exactly what fhir_send_referral.php created (2 Conditions, up to 6
// Observations including the BP panel's two components).
// ========================================================

require_once __DIR__ . '/config.php';

$serviceRequestId = trim($_GET['service_request_id'] ?? '');
if (!$serviceRequestId) {
    sendJsonResponse(['success' => false, 'message' => 'Missing service_request_id query parameter'], 400);
}

$VITAL_LOINC_LABELS = [
    '8867-4' => ['label' => 'Heart Rate', 'unit' => 'bpm'],
    '9279-1' => ['label' => 'Respiratory Rate', 'unit' => 'br/min'],
    '2708-6' => ['label' => 'Oxygen Saturation', 'unit' => '%'],
    '8310-5' => ['label' => 'Temperature', 'unit' => "\u{00B0}C"],
    '29463-7' => ['label' => 'Weight', 'unit' => 'kg'],
];

[$srCode, $sr, $srErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'ServiceRequest/' . urlencode($serviceRequestId));
if ($srErrno || $srCode < 200 || $srCode >= 300 || ($sr['resourceType'] ?? '') !== 'ServiceRequest') {
    sendJsonResponse(['success' => false, 'message' => $srCode === 404 ? 'Referral not found' : 'Could not fetch referral', 'http_status' => $srCode], $srCode ?: 502);
}

$patientId = fg7RefId($sr['subject']['reference'] ?? null);
$encounterId = fg7RefId($sr['encounter']['reference'] ?? null);
$task = fg7FindTaskForServiceRequest($serviceRequestId);
$receivingEncounter = fg7FindEncounterForServiceRequest($serviceRequestId);

$patient = null;
if ($patientId) {
    [$pCode, $pRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($patientId));
    if ($pCode >= 200 && $pCode < 300 && ($pRes['resourceType'] ?? '') === 'Patient') {
        $patient = fg7SimplifyPatient($pRes);
    }
}

$chiefComplaint = null;
$workingImpression = null;
if ($encounterId) {
    [$cCode, $cRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Condition?encounter=' . urlencode("Encounter/$encounterId"));
    if ($cCode >= 200 && $cCode < 300) {
        foreach (($cRes['entry'] ?? []) as $entry) {
            $res = $entry['resource'] ?? [];
            if (($res['resourceType'] ?? '') !== 'Condition') continue;
            $category = $res['category'][0]['coding'][0]['code'] ?? '';
            $text = $res['code']['text'] ?? ($res['code']['coding'][0]['display'] ?? null);
            if ($category === 'problem-list-item') $chiefComplaint = $text;
            elseif ($category === 'encounter-diagnosis') $workingImpression = $text;
        }
    }
}

$vitals = [];
if ($encounterId) {
    [$oCode, $oRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Observation?encounter=' . urlencode("Encounter/$encounterId"));
    if ($oCode >= 200 && $oCode < 300) {
        foreach (($oRes['entry'] ?? []) as $entry) {
            $res = $entry['resource'] ?? [];
            if (($res['resourceType'] ?? '') !== 'Observation') continue;
            $loincCode = $res['code']['coding'][0]['code'] ?? '';

            if ($loincCode === '85354-9') {
                // Blood pressure panel -- read systolic/diastolic components
                $systolic = null;
                $diastolic = null;
                foreach (($res['component'] ?? []) as $comp) {
                    $compCode = $comp['code']['coding'][0]['code'] ?? '';
                    $value = $comp['valueQuantity']['value'] ?? null;
                    if ($compCode === '8480-6') $systolic = $value;
                    if ($compCode === '8462-4') $diastolic = $value;
                }
                if ($systolic !== null && $diastolic !== null) {
                    $vitals[] = ['label' => 'Blood Pressure', 'value' => "$systolic/$diastolic", 'unit' => 'mmHg'];
                }
            } elseif (isset($VITAL_LOINC_LABELS[$loincCode])) {
                $def = $VITAL_LOINC_LABELS[$loincCode];
                $value = $res['valueQuantity']['value'] ?? null;
                if ($value !== null) {
                    $vitals[] = ['label' => $def['label'], 'value' => $value, 'unit' => $def['unit']];
                }
            }
        }
    }
}

sendJsonResponse([
    'success' => true,
    'service_request_id' => $serviceRequestId,
    'patient' => $patient,
    'category' => $sr['category'][0]['text'] ?? ($sr['category'][0]['coding'][0]['display'] ?? null),
    'priority' => $sr['priority'] ?? null,
    'service_type' => $sr['reasonCode'][0]['text'] ?? ($sr['reasonCode'][0]['coding'][0]['display'] ?? null),
    'chief_complaint' => $chiefComplaint,
    'working_impression' => $workingImpression,
    'reason_text' => $sr['note'][0]['text'] ?? null,
    'vitals' => $vitals,
    'authored_on' => $sr['authoredOn'] ?? null,
    'status' => $sr['status'] ?? null,
    'task_status' => $task['status'] ?? null,
    'receiving_encounter_id' => $receivingEncounter['id'] ?? null,
]);
