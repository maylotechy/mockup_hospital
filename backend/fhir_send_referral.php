<?php
// ========================================================
// API Endpoint: Build (and optionally send) a test eReferral Bundle
// against the HL7 FHIR Connectathon sandbox (FHIRLab). Fully separate
// from the IOL/IRDSS referral flow in send_referral.php -- see
// hackathon_tracker/TRACKER.md for why these are kept apart.
//
// dry_run=true builds and returns the Bundle WITHOUT contacting the
// sandbox -- used by the "Preview" step on the frontend so staff can
// review the exact payload before anything is transmitted.
//
// Every identifier and name this builds carries a DIWA-IRDSS-TEST-/DiWA-IRDSS Test-
// prefix per hackathon_tracker/SANDBOX_SAFETY_RULES.md, and only ever issues
// conditional PUT-by-our-own-identifier or POST -- never PUT/PATCH by a raw
// discovered id, never DELETE.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse(['success' => false, 'message' => 'Invalid request method. Only POST is allowed.'], 405);
}

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['doctor', 'nurse']);

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);
if (!is_array($input)) {
    $input = $_POST;
}

$dryRun = !empty($input['dry_run']);

$patientId = isset($input['patient_id']) && $input['patient_id'] !== '' ? (int)$input['patient_id'] : 0;
if ($patientId <= 0) {
    sendJsonResponse(['success' => false, 'message' => 'Missing or invalid required field: patient_id.'], 400);
}

$chiefComplaint = trim((string)($input['chief_complaint'] ?? ''));
$workingImpression = trim((string)($input['working_impression'] ?? ''));
$referralCategory = trim((string)($input['referral_category'] ?? ''));
$serviceType = trim((string)($input['service_type'] ?? ''));
$reasonText = trim((string)($input['reason_text'] ?? ''));
$vitalBpSystolic = isset($input['vital_bp_systolic']) && $input['vital_bp_systolic'] !== '' ? (float)$input['vital_bp_systolic'] : null;
$vitalBpDiastolic = isset($input['vital_bp_diastolic']) && $input['vital_bp_diastolic'] !== '' ? (float)$input['vital_bp_diastolic'] : null;
$vitalHr = isset($input['vital_hr']) && $input['vital_hr'] !== '' ? (float)$input['vital_hr'] : null;
$vitalRr = isset($input['vital_rr']) && $input['vital_rr'] !== '' ? (float)$input['vital_rr'] : null;
$vitalTempC = isset($input['vital_temp_c']) && $input['vital_temp_c'] !== '' ? (float)$input['vital_temp_c'] : null;
$vitalO2sat = isset($input['vital_o2sat']) && $input['vital_o2sat'] !== '' ? (float)$input['vital_o2sat'] : null;
$vitalWeightKg = isset($input['vital_weight_kg']) && $input['vital_weight_kg'] !== '' ? (float)$input['vital_weight_kg'] : null;
$clinicalHistory = trim((string)($input['clinical_history'] ?? ''));
$treatmentGiven = trim((string)($input['treatment_given'] ?? ''));
$labResults = trim((string)($input['lab_results'] ?? ''));
$receivingOrgRef = trim((string)($input['receiving_org_ref'] ?? ''));
$receivingOrgDisplayName = trim((string)($input['receiving_org_display_name'] ?? ''));

// Both option lists match the real, required FHIR value sets exactly (fetched
// live from the terminology server, see fhir_shared.php) -- not our own design.
$validCategories = ['Emergency', 'Outpatient'];
$validServiceTypes = ['Consultation', 'Diagnostics', 'Procedure', 'Others'];
if ($chiefComplaint === '' || $workingImpression === '' || $reasonText === '') {
    sendJsonResponse(['success' => false, 'message' => 'Chief complaint, working impression, and reason for referral are required.'], 422);
}
if (!in_array($referralCategory, $validCategories, true)) {
    sendJsonResponse(['success' => false, 'message' => 'Referral category must be one of: Emergency, Outpatient.'], 422);
}
if (!in_array($serviceType, $validServiceTypes, true)) {
    sendJsonResponse(['success' => false, 'message' => 'Service type must be one of: Consultation, Diagnostics, Procedure, Others.'], 422);
}

try {
    $pdo = getDbConnection();

    $stmt = $pdo->prepare('
        SELECT p.id, p.first_name, p.last_name, p.dob, p.gender, p.phone,
               p.region, p.province, p.city_municipality, p.barangay, p.zip_code,
               p.philhealth_member, p.philhealth_number, p.philsys_id,
               f.id as facility_id, f.code as facility_code, f.name as facility_name,
               f.address as facility_address, f.phone as facility_phone, f.fhir_organization_id,
               nok.name as next_of_kin_name, nok.relationship as next_of_kin_relationship, nok.phone as next_of_kin_phone
        FROM patients p
        JOIN facilities f ON p.facility_id = f.id
        LEFT JOIN (
            SELECT pc1.* FROM patient_contacts pc1
            INNER JOIN (SELECT patient_id, MAX(id) as max_id FROM patient_contacts GROUP BY patient_id) pc2
                ON pc1.patient_id = pc2.patient_id AND pc1.id = pc2.max_id
        ) nok ON nok.patient_id = p.id
        WHERE p.id = :id
    ');
    $stmt->execute([':id' => $patientId]);
    $patient = $stmt->fetch();

    if (!$patient) {
        sendJsonResponse(['success' => false, 'message' => "Patient with ID {$patientId} not found."], 404);
    }
    if ((int)$patient['facility_id'] !== (int)($user['facility']['id'] ?? 0)) {
        sendJsonResponse(['success' => false, 'message' => 'You can only send test referrals for patients registered at your own facility.'], 403);
    }

    // The referring Practitioner named in the bundle is whoever was picked in the
    // "Referring Practitioner" dropdown -- defaults to the logged-in user client-side,
    // but a nurse/doctor can submit on a colleague's behalf. Kept separate from $user,
    // which stays the actual audit-log actor below regardless of who's picked here.
    $practitionerId = isset($input['practitioner_id']) && $input['practitioner_id'] !== '' ? (int)$input['practitioner_id'] : (int)($user['id'] ?? 0);
    $practStmt = $pdo->prepare("
        SELECT id, full_name, role, license_number
        FROM users
        WHERE id = :id AND facility_id = :facility_id AND role IN ('doctor', 'nurse') AND is_active = 1
    ");
    $practStmt->execute([':id' => $practitionerId, ':facility_id' => (int)($user['facility']['id'] ?? 0)]);
    $practitioner = $practStmt->fetch();
    if (!$practitioner) {
        sendJsonResponse(['success' => false, 'message' => 'Selected referring practitioner not found at your facility.'], 400);
    }

    $bundle = buildFhirReferralTestBundle($patient, $practitioner, [
        'chief_complaint' => $chiefComplaint,
        'working_impression' => $workingImpression,
        'referral_category' => $referralCategory,
        'service_type' => $serviceType,
        'reason_text' => $reasonText,
        'vital_bp_systolic' => $vitalBpSystolic,
        'vital_bp_diastolic' => $vitalBpDiastolic,
        'vital_hr' => $vitalHr,
        'vital_rr' => $vitalRr,
        'vital_temp_c' => $vitalTempC,
        'vital_o2sat' => $vitalO2sat,
        'vital_weight_kg' => $vitalWeightKg,
        'clinical_history' => $clinicalHistory,
        'treatment_given' => $treatmentGiven,
        'lab_results' => $labResults,
    ], $receivingOrgRef !== '' ? $receivingOrgRef : null);

    if ($dryRun) {
        sendJsonResponse([
            'success' => true,
            'dry_run' => true,
            'endpoint' => FHIR_EREFERRAL_BASE_URL,
            'bundle_sent' => $bundle,
            'message' => 'Preview only -- nothing was sent to the sandbox.',
        ]);
    }

    $bundleJson = json_encode($bundle, JSON_UNESCAPED_SLASHES);

    [$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('POST', FHIR_EREFERRAL_BASE_URL, '', $bundleJson);

    $isSuccess = !$curlErrno && $httpCode >= 200 && $httpCode < 300;
    $serviceRequestRef = null;

    if ($isSuccess) {
        $fullName = trim($patient['first_name'] . ' ' . $patient['last_name']);
        logAuditEvent($user, 'FHIR_CONNECTATHON_TEST_SEND', null, $fullName, $reasonText);

        $serviceRequestRef = fhirExtractCreatedRef($bundle, is_array($response) ? $response : null, 'ServiceRequest');
        try {
            $historyStmt = $pdo->prepare('
                INSERT INTO fhir_sent_referrals
                    (facility_id, patient_id, patient_name, service_request_ref, receiving_org_ref, receiving_org_name,
                     referral_category, service_type, reason_text, http_status, created_by_user_id)
                VALUES
                    (:facility_id, :patient_id, :patient_name, :service_request_ref, :receiving_org_ref, :receiving_org_name,
                     :referral_category, :service_type, :reason_text, :http_status, :created_by_user_id)
            ');
            $historyStmt->execute([
                ':facility_id' => (int)$patient['facility_id'],
                ':patient_id' => (int)$patient['id'],
                ':patient_name' => $fullName,
                ':service_request_ref' => $serviceRequestRef,
                ':receiving_org_ref' => $receivingOrgRef !== '' ? $receivingOrgRef : null,
                ':receiving_org_name' => $receivingOrgDisplayName !== '' ? $receivingOrgDisplayName : ($receivingOrgRef !== '' ? null : 'Placeholder Receiving Facility'),
                ':referral_category' => $referralCategory,
                ':service_type' => $serviceType,
                ':reason_text' => $reasonText,
                ':http_status' => $httpCode,
                ':created_by_user_id' => (int)($user['id'] ?? 0),
            ]);
        } catch (Exception $e) {
            // Local history is a best-effort record -- never block the response on it,
            // same principle as send_referral.php's IOL-side local persistence.
        }
    }

    sendJsonResponse([
        'success' => $isSuccess,
        'dry_run' => false,
        'http_status' => $httpCode,
        'curl_error' => $curlErrno ? $curlError : null,
        'endpoint' => FHIR_EREFERRAL_BASE_URL,
        'bundle_sent' => $bundle,
        'sandbox_response' => $response,
        'service_request_ref' => $serviceRequestRef,
    ], $isSuccess ? 200 : ($httpCode ?: 502));

} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'An error occurred while building/sending the FHIR test bundle: ' . $e->getMessage()], 500);
}

/**
 * Builds a PH eReferral-shaped transaction Bundle for the FHIRLab sandbox out of
 * one mock_hospitals patient + form input. Every identifier/name is prefixed
 * DIWA-IRDSS-TEST-/DiWA-IRDSS Test- per hackathon_tracker/SANDBOX_SAFETY_RULES.md, since
 * mock_hospitals has no real NHFR/PRC/PhilSys identifiers to submit (see
 * hackathon_tracker/TRACKER.md for the known field gaps). Coded terminology
 * (SNOMED/LOINC) is only used where mock_hospitals doesn't have to guess it --
 * i.e. the universal vital-sign codes -- everything else goes in as free text.
 *
 * $practitioner is the referring practitioner picked on the form (defaults to
 * the logged-in user, but may be a colleague at the same facility) -- it is
 * NOT necessarily the account that's actually logged in and sending; that
 * stays a separate $user for audit purposes in the caller above.
 */
function buildFhirReferralTestBundle(array $patient, array $practitioner, array $clinical, ?string $existingReceivingOrgRef = null): array {
    $patientUuid = 'urn:uuid:' . genFhirUuidV4();
    $sendingPractitionerUuid = 'urn:uuid:' . genFhirUuidV4();
    $sendingOrgUuid = 'urn:uuid:' . genFhirUuidV4();
    $receivingPractitionerUuid = 'urn:uuid:' . genFhirUuidV4();
    $usingExistingReceivingOrg = $existingReceivingOrgRef !== null && $existingReceivingOrgRef !== '';
    $receivingOrgUuid = $usingExistingReceivingOrg ? $existingReceivingOrgRef : ('urn:uuid:' . genFhirUuidV4());
    $sendingRoleUuid = 'urn:uuid:' . genFhirUuidV4();
    $receivingRoleUuid = 'urn:uuid:' . genFhirUuidV4();
    $encounterUuid = 'urn:uuid:' . genFhirUuidV4();
    $ccConditionUuid = 'urn:uuid:' . genFhirUuidV4();
    $diagConditionUuid = 'urn:uuid:' . genFhirUuidV4();
    $serviceRequestUuid = 'urn:uuid:' . genFhirUuidV4();
    $taskUuid = 'urn:uuid:' . genFhirUuidV4();
    $provenanceUuid = 'urn:uuid:' . genFhirUuidV4();

    $genderMap = ['Male' => 'male', 'Female' => 'female', 'Other' => 'other'];
    $gender = $genderMap[$patient['gender']] ?? 'unknown';
    $nowIso = (new DateTimeImmutable())->format(DateTimeInterface::ATOM);

    $mockIdSystem = FHIR_TEST_ID_SYSTEM;

    $addressLine = array_values(array_filter([$patient['barangay'] ?? null]));
    $address = [];
    if ($patient['city_municipality'] || $patient['province'] || $patient['zip_code'] || $addressLine) {
        $address = [array_filter([
            'use' => 'home',
            'line' => $addressLine ?: null,
            'city' => $patient['city_municipality'] ?: null,
            'state' => $patient['province'] ?: null,
            'postalCode' => $patient['zip_code'] ?: null,
            'country' => 'PH',
            'text' => implode(', ', array_filter([
                $patient['barangay'] ?? null, $patient['city_municipality'] ?? null,
                $patient['province'] ?? null, $patient['region'] ?? null, $patient['zip_code'] ?? null,
            ])) ?: null,
        ], fn($v) => $v !== null)];
    }

    $patientIdentifiers = [[
        'system' => $mockIdSystem,
        'value' => 'DIWA-IRDSS-TEST-PATIENT-' . $patient['id'],
    ]];
    // PhilHealth ID is real data mock_hospitals already collects -- include it
    // when the patient has one, per the README's own identifier convention.
    // Never fabricated for patients without one (see hackathon_tracker/TRACKER.md).
    if (($patient['philhealth_member'] ?? 'No') === 'Yes' && !empty($patient['philhealth_number'])) {
        $patientIdentifiers[] = [
            'system' => 'http://philhealth.gov.ph/fhir/Identifier/philhealth-id',
            'value' => $patient['philhealth_number'],
        ];
    }
    // PhilSys ID -- Phase 2. Optional at patient registration, so only ever
    // included when the patient actually has one on file.
    if (!empty($patient['philsys_id'])) {
        $patientIdentifiers[] = [
            'system' => 'http://philsys.gov.ph/fhir/Identifier/philsys-id',
            'value' => $patient['philsys_id'],
        ];
    }

    // Next of kin -- Phase 2. Optional; a patient with none on file simply
    // omits Patient.contact entirely rather than sending an empty entry.
    //
    // Patient.contact.relationship has a REQUIRED binding (confirmed 2026-09-15
    // via a live 422 -- text-only {"text": "Parent"} is rejected). The specific
    // relationship our form collects (Parent/Spouse/Sibling/etc.) has no clean
    // match in the generic base FHIR value set this binds to (v2-0131, which
    // only has broad categories like Emergency Contact / Next-of-Kin), so we
    // use the always-correct "N" (Next-of-Kin) code -- true of every contact
    // this app collects, since that's literally what the form calls the field --
    // and keep the specific relationship in .text for readability.
    $patientContact = null;
    if (!empty($patient['next_of_kin_name']) && !empty($patient['next_of_kin_phone'])) {
        $patientContact = [[
            'relationship' => [[
                'coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/v2-0131', 'code' => 'N', 'display' => 'Next-of-Kin']],
                'text' => $patient['next_of_kin_relationship'] ?: 'Next-of-Kin',
            ]],
            'name' => ['text' => $patient['next_of_kin_name']],
            'telecom' => [['system' => 'phone', 'value' => $patient['next_of_kin_phone']]],
        ]];
    }

    $patientResource = array_filter([
        'resourceType' => 'Patient',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-patient']],
        'identifier' => $patientIdentifiers,
        'active' => true,
        'name' => [[
            'use' => 'official',
            'family' => 'DiWA-IRDSS Test-' . $patient['last_name'],
            'given' => [$patient['first_name']],
        ]],
        'telecom' => $patient['phone'] ? [['system' => 'phone', 'value' => $patient['phone'], 'use' => 'mobile']] : null,
        'gender' => $gender,
        'birthDate' => $patient['dob'],
        'contact' => $patientContact,
        'address' => $address ?: null,
    ], fn($v) => $v !== null);

    // If this facility already has a cached Organization/{id} from a prior
    // successful registration (see fhir_register_organization.php), reference it
    // directly instead of conditionally PUTting the Organization again on every
    // referral -- the PUT stays as the fallback for facilities that haven't
    // registered yet (hackathon_tracker/TRACKER.md, entry re: caching FHIR org id).
    $cachedSendingOrgRef = trim((string)($patient['fhir_organization_id'] ?? ''));
    $usingCachedSendingOrg = $cachedSendingOrgRef !== '';
    $sendingOrgUuid = $usingCachedSendingOrg ? $cachedSendingOrgRef : $sendingOrgUuid;
    $sendingOrgResource = null;
    $sendingOrgConditionalUrl = null;
    if (!$usingCachedSendingOrg) {
        $sendingOrg = buildDiwaOrganizationResource(
            (int)$patient['facility_id'],
            $patient['facility_name'],
            $patient['facility_address'] ?? null,
            $patient['facility_phone'] ?? null
        );
        $sendingOrgResource = $sendingOrg['resource'];
        $sendingOrgConditionalUrl = $sendingOrg['conditionalUrl'];
    }

    // If the caller picked a real Organization already registered on the sandbox
    // (via the FHIR: Organizations tab / fhir_list_organizations.php), reference it
    // directly by its server-assigned id -- read-only, never PUT/PATCHed -- instead
    // of creating another placeholder. Falls back to a fixed, clearly-labeled
    // placeholder when nothing was picked (see hackathon_tracker/TRACKER.md).
    $receivingOrgResource = null;
    $receivingOrgConditionalUrl = null;
    if (!$usingExistingReceivingOrg) {
        $receivingOrgResource = [
            'resourceType' => 'Organization',
            'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization']],
            'identifier' => [[
                'system' => $mockIdSystem,
                'value' => 'DIWA-IRDSS-TEST-ORG-PLACEHOLDER-RECEIVING',
            ]],
            'name' => 'PlaceholderReceivingFacility',
            'alias' => [FHIR_TEST_ALIAS],
        ];
        $receivingOrgConditionalUrl = 'Organization?identifier=' . $mockIdSystem . '|DIWA-IRDSS-TEST-ORG-PLACEHOLDER-RECEIVING';
    }

    $sendingPractitionerResource = [
        'resourceType' => 'Practitioner',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
        'identifier' => [[
            'system' => $mockIdSystem,
            'value' => 'DIWA-IRDSS-TEST-PRACTITIONER-' . ($practitioner['id'] ?? 'unknown'),
        ]],
        'name' => [['use' => 'official', 'text' => 'DiWA-IRDSS Test-' . ($practitioner['full_name'] ?? 'Unknown')]],
    ];

    $receivingPractitionerResource = [
        'resourceType' => 'Practitioner',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-practitioner']],
        'identifier' => [[
            'system' => $mockIdSystem,
            'value' => 'DIWA-IRDSS-TEST-PRACTITIONER-PLACEHOLDER-RECEIVING',
        ]],
        'name' => [['use' => 'official', 'text' => 'DiWA-IRDSS Test-PlaceholderReceivingPractitioner']],
    ];

    $sendingRoleResource = [
        'resourceType' => 'PractitionerRole',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
        'practitioner' => ['reference' => $sendingPractitionerUuid],
        'organization' => ['reference' => $sendingOrgUuid],
        'code' => [fhirPractitionerRoleCoding((string)($practitioner['role'] ?? ''))],
    ];
    $receivingRoleResource = [
        'resourceType' => 'PractitionerRole',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-practitioner-role']],
        'practitioner' => ['reference' => $receivingPractitionerUuid],
        'organization' => ['reference' => $receivingOrgUuid],
        'code' => [fhirPractitionerRoleCoding('doctor')],
    ];

    $encounterResource = [
        'resourceType' => 'Encounter',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-encounter']],
        'status' => 'planned',
        'class' => ['system' => 'http://terminology.hl7.org/CodeSystem/v3-ActCode', 'code' => 'AMB', 'display' => 'ambulatory'],
        'subject' => ['reference' => $patientUuid],
    ];

    $ccConditionResource = array_filter([
        'resourceType' => 'Condition',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition']],
        'clinicalStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code' => 'active']]],
        'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-category', 'code' => 'problem-list-item', 'display' => 'Problem List Item']]]],
        'code' => ['text' => $clinical['chief_complaint']],
        'subject' => ['reference' => $patientUuid],
        'encounter' => ['reference' => $encounterUuid],
        // Clinical history -- Phase 2. Kept distinct from chief_complaint (why the
        // patient came) -- this is the narrative/history, not restated symptoms.
        'note' => !empty($clinical['clinical_history']) ? [['text' => $clinical['clinical_history']]] : null,
    ], fn($v) => $v !== null);

    $diagConditionResource = [
        'resourceType' => 'Condition',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition']],
        'clinicalStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-clinical', 'code' => 'active']]],
        'verificationStatus' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-ver-status', 'code' => 'provisional', 'display' => 'Provisional']]],
        'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/condition-category', 'code' => 'encounter-diagnosis', 'display' => 'Encounter Diagnosis']]]],
        'code' => ['text' => $clinical['working_impression']],
        'subject' => ['reference' => $patientUuid],
        'encounter' => ['reference' => $encounterUuid],
    ];

    $vitalDefs = [
        $clinical['vital_bp_systolic'] !== null && $clinical['vital_bp_diastolic'] !== null ? [
            'resourceType' => 'Observation',
            'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation']],
            'status' => 'final',
            'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/observation-category', 'code' => 'vital-signs', 'display' => 'Vital Signs']]]],
            'code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '85354-9', 'display' => 'Blood pressure panel with all children optional']]],
            'subject' => ['reference' => $patientUuid],
            'encounter' => ['reference' => $encounterUuid],
            'effectiveDateTime' => $nowIso,
            'component' => [
                ['code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '8480-6', 'display' => 'Systolic blood pressure']]], 'valueQuantity' => ['value' => $clinical['vital_bp_systolic'], 'unit' => 'mmHg', 'system' => 'http://unitsofmeasure.org', 'code' => 'mm[Hg]']],
                ['code' => ['coding' => [['system' => 'http://loinc.org', 'code' => '8462-4', 'display' => 'Diastolic blood pressure']]], 'valueQuantity' => ['value' => $clinical['vital_bp_diastolic'], 'unit' => 'mmHg', 'system' => 'http://unitsofmeasure.org', 'code' => 'mm[Hg]']],
            ],
        ] : null,
        $clinical['vital_hr'] !== null ? simpleVitalObservation('8867-4', 'Heart rate', $clinical['vital_hr'], 'beats/minute', '/min', $patientUuid, $encounterUuid, $nowIso) : null,
        $clinical['vital_rr'] !== null ? simpleVitalObservation('9279-1', 'Respiratory rate', $clinical['vital_rr'], 'breaths/minute', '/min', $patientUuid, $encounterUuid, $nowIso) : null,
        $clinical['vital_o2sat'] !== null ? simpleVitalObservation('2708-6', 'Oxygen saturation in Arterial blood', $clinical['vital_o2sat'], '%', '%', $patientUuid, $encounterUuid, $nowIso) : null,
        $clinical['vital_temp_c'] !== null ? simpleVitalObservation('8310-5', 'Body temperature', $clinical['vital_temp_c'], 'Celsius', 'Cel', $patientUuid, $encounterUuid, $nowIso) : null,
        $clinical['vital_weight_kg'] !== null ? simpleVitalObservation('29463-7', 'Body weight', $clinical['vital_weight_kg'], 'kg', 'kg', $patientUuid, $encounterUuid, $nowIso) : null,
    ];
    $observationEntries = [];
    foreach (array_filter($vitalDefs) as $obsResource) {
        $observationEntries[] = ['uuid' => 'urn:uuid:' . genFhirUuidV4(), 'resource' => $obsResource];
    }

    // Treatment given -- Phase 2. Only created when the doctor actually entered
    // something; never a fabricated Procedure per the spec ("Do not create fake
    // procedures"). No performedDateTime is asserted since mock_hospitals doesn't
    // capture when the treatment was actually given, only that it was.
    $procedureUuid = null;
    $procedureResource = null;
    if (!empty($clinical['treatment_given'])) {
        $procedureUuid = 'urn:uuid:' . genFhirUuidV4();
        $procedureResource = [
            'resourceType' => 'Procedure',
            'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-procedure']],
            'status' => 'completed',
            'subject' => ['reference' => $patientUuid],
            'encounter' => ['reference' => $encounterUuid],
            'note' => [['text' => $clinical['treatment_given']]],
        ];
    }

    // Laboratory results -- Phase 2. Only created when lab data was actually
    // entered; never fabricated values. No presentedForm/attachment is built
    // since this tool has no file-upload plumbing (see hackathon_tracker/TRACKER.md) --
    // conclusion text only, per the spec's "minimum: report text, conclusion" allowance.
    $diagnosticReportUuid = null;
    $diagnosticReportResource = null;
    if (!empty($clinical['lab_results'])) {
        $diagnosticReportUuid = 'urn:uuid:' . genFhirUuidV4();
        $diagnosticReportResource = [
            'resourceType' => 'DiagnosticReport',
            'status' => 'final',
            'code' => ['text' => 'Laboratory Results'],
            'subject' => ['reference' => $patientUuid],
            'encounter' => ['reference' => $encounterUuid],
            'conclusion' => $clinical['lab_results'],
        ];
    }

    $serviceRequestResource = [
        'resourceType' => 'ServiceRequest',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request']],
        'status' => 'active',
        'intent' => 'order',
        'priority' => fhirReferralPriority($clinical['referral_category']),
        'category' => [fhirReferralCategoryCoding($clinical['referral_category'])],
        'subject' => ['reference' => $patientUuid],
        'encounter' => ['reference' => $encounterUuid],
        'occurrenceDateTime' => $nowIso,
        'authoredOn' => $nowIso,
        'requester' => ['reference' => $sendingRoleUuid],
        'performer' => [['reference' => $receivingRoleUuid]],
        // reasonCode is bound to a "service type" value set (Consultation/
        // Diagnostics/Procedure/Others), not a clinical reason -- confirmed
        // 2026-09-15 via a live 422. mock_hospitals' free-text reason (e.g.
        // "Higher Level of Care Required") answers a different question, so it
        // goes in .note instead of being forced into the coded field.
        'reasonCode' => [fhirServiceTypeCoding($clinical['service_type'])],
        'reasonReference' => [['reference' => $diagConditionUuid]],
        'note' => [['text' => $clinical['reason_text']]],
    ];

    $taskResource = [
        'resourceType' => 'Task',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-task']],
        'status' => 'requested',
        'intent' => 'order',
        'code' => ['coding' => [['system' => 'http://snomed.info/sct', 'code' => '3457005', 'display' => 'Patient referral']], 'text' => 'eReferral (mock_hospitals FHIR Connectathon test)'],
        'focus' => ['reference' => $serviceRequestUuid],
        'for' => ['reference' => $patientUuid],
        'authoredOn' => $nowIso,
        'lastModified' => $nowIso,
        'requester' => ['reference' => $sendingRoleUuid],
        'owner' => ['reference' => $receivingRoleUuid],
    ];

    $provenanceResource = [
        'resourceType' => 'Provenance',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-provenance']],
        'target' => [['reference' => $serviceRequestUuid]],
        'recorded' => $nowIso,
        'activity' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', 'code' => 'CREATE', 'display' => 'create']]],
        'agent' => [[
            'type' => ['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', 'code' => 'author', 'display' => 'Author']]],
            'who' => ['reference' => $sendingRoleUuid],
            'onBehalfOf' => ['reference' => $sendingOrgUuid],
        ]],
    ];

    $entries = [];
    $entries[] = ['fullUrl' => $patientUuid, 'resource' => $patientResource, 'request' => ['method' => 'PUT', 'url' => 'Patient?identifier=' . $mockIdSystem . '|DIWA-IRDSS-TEST-PATIENT-' . $patient['id']]];
    if (!$usingCachedSendingOrg) {
        $entries[] = ['fullUrl' => $sendingOrgUuid, 'resource' => $sendingOrgResource, 'request' => ['method' => 'PUT', 'url' => $sendingOrgConditionalUrl]];
    }
    if (!$usingExistingReceivingOrg) {
        $entries[] = ['fullUrl' => $receivingOrgUuid, 'resource' => $receivingOrgResource, 'request' => ['method' => 'PUT', 'url' => $receivingOrgConditionalUrl]];
    }
    $entries[] = ['fullUrl' => $sendingPractitionerUuid, 'resource' => $sendingPractitionerResource, 'request' => ['method' => 'PUT', 'url' => 'Practitioner?identifier=' . $mockIdSystem . '|DIWA-IRDSS-TEST-PRACTITIONER-' . ($practitioner['id'] ?? 'unknown')]];
    $entries[] = ['fullUrl' => $receivingPractitionerUuid, 'resource' => $receivingPractitionerResource, 'request' => ['method' => 'PUT', 'url' => 'Practitioner?identifier=' . $mockIdSystem . '|DIWA-IRDSS-TEST-PRACTITIONER-PLACEHOLDER-RECEIVING']];
    $entries[] = ['fullUrl' => $sendingRoleUuid, 'resource' => $sendingRoleResource, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']];
    $entries[] = ['fullUrl' => $receivingRoleUuid, 'resource' => $receivingRoleResource, 'request' => ['method' => 'POST', 'url' => 'PractitionerRole']];
    $entries[] = ['fullUrl' => $encounterUuid, 'resource' => $encounterResource, 'request' => ['method' => 'POST', 'url' => 'Encounter']];
    $entries[] = ['fullUrl' => $ccConditionUuid, 'resource' => $ccConditionResource, 'request' => ['method' => 'POST', 'url' => 'Condition']];
    $entries[] = ['fullUrl' => $diagConditionUuid, 'resource' => $diagConditionResource, 'request' => ['method' => 'POST', 'url' => 'Condition']];
    foreach ($observationEntries as $obs) {
        $entries[] = ['fullUrl' => $obs['uuid'], 'resource' => $obs['resource'], 'request' => ['method' => 'POST', 'url' => 'Observation']];
    }
    if ($procedureResource !== null) {
        $entries[] = ['fullUrl' => $procedureUuid, 'resource' => $procedureResource, 'request' => ['method' => 'POST', 'url' => 'Procedure']];
    }
    if ($diagnosticReportResource !== null) {
        $entries[] = ['fullUrl' => $diagnosticReportUuid, 'resource' => $diagnosticReportResource, 'request' => ['method' => 'POST', 'url' => 'DiagnosticReport']];
    }
    $entries[] = ['fullUrl' => $serviceRequestUuid, 'resource' => $serviceRequestResource, 'request' => ['method' => 'POST', 'url' => 'ServiceRequest']];
    $entries[] = ['fullUrl' => $taskUuid, 'resource' => $taskResource, 'request' => ['method' => 'POST', 'url' => 'Task']];
    $entries[] = ['fullUrl' => $provenanceUuid, 'resource' => $provenanceResource, 'request' => ['method' => 'POST', 'url' => 'Provenance']];

    return [
        'resourceType' => 'Bundle',
        'type' => 'transaction',
        'timestamp' => $nowIso,
        'entry' => $entries,
    ];
}

function simpleVitalObservation($loincCode, $loincDisplay, $value, $unit, $ucumCode, $patientUuid, $encounterUuid, $effectiveDateTime): array {
    return [
        'resourceType' => 'Observation',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation']],
        'status' => 'final',
        'category' => [['coding' => [['system' => 'http://terminology.hl7.org/CodeSystem/observation-category', 'code' => 'vital-signs', 'display' => 'Vital Signs']]]],
        'code' => ['coding' => [['system' => 'http://loinc.org', 'code' => $loincCode, 'display' => $loincDisplay]]],
        'subject' => ['reference' => $patientUuid],
        'encounter' => ['reference' => $encounterUuid],
        'effectiveDateTime' => $effectiveDateTime,
        'valueQuantity' => ['value' => $value, 'unit' => $unit, 'system' => 'http://unitsofmeasure.org', 'code' => $ucumCode],
    ];
}
