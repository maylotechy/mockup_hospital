<?php
// ========================================================
// Shared helpers for the HL7 FHIR Connectathon integration
// (fhir_send_referral.php, fhir_list_organizations.php,
// fhir_register_organization.php). Fully separate from the IOL/IRDSS
// referral flow -- see hackathon_tracker/TRACKER.md.
// ========================================================

// Identifier system + prefixes every resource this project ever writes to the
// FHIR sandbox must carry, per hackathon_tracker/SANDBOX_SAFETY_RULES.md --
// the -TEST/Test marker is load-bearing (signals synthetic data), not decorative.
define('FHIR_TEST_ID_SYSTEM', $_ENV['FHIR_TEST_ID_SYSTEM'] ?? 'https://diwa-irdss.local/fhir/identifier/test');
define('FHIR_TEST_ID_PREFIX', 'DIWA-IRDSS-TEST-');
define('FHIR_TEST_NAME_PREFIX', 'DiWA-IRDSS Test-');

// The real PH National Health Facility Registry identifier system, per the
// official Connectathon Postman collection (connectathon/HL7-FHIR-Connectathon/
// ph-ereferral-collection/) -- NOT one of our own DIWA-IRDSS-TEST- identifiers.
// mock_hospitals has no NHFR code of its own to register under this system
// (see hackathon_tracker/TRACKER.md field-gap notes); this is only used to
// search for OTHER, real, already-registered facilities by their NHFR code.
define('FHIR_NHFR_ID_SYSTEM', 'https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code');
// For resources with a real .alias field (Organization) the test marker goes
// there instead of prefixing .name, so .name stays the actual facility name --
// .name is still prefixed for resources without an alias field (Patient,
// Practitioner), where a visible marker in the only human-readable field
// matters more than name purity on a shared public sandbox.
define('FHIR_TEST_ALIAS', rtrim(FHIR_TEST_NAME_PREFIX, '- '));

// PractitionerRole.code has a REQUIRED binding to this PH eReferral value set
// (confirmed 2026-09-15 via a live 422 -- text-only {"text": "doctor"} is
// rejected as an error, not just a warning, unlike most other coded fields in
// this integration). Codes below are the real, current expansion fetched from
// https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role --
// never fabricated. Only doctor/nurse are mapped since those are the only
// values mock_hospitals' users.role enum can actually produce for a sending
// practitioner (requireRole(['doctor','nurse']) everywhere referrals are sent).
function fhirPractitionerRoleCoding(string $role): array {
    $map = [
        'doctor' => ['system' => 'http://snomed.info/sct', 'code' => '158965000', 'display' => 'Doctor'],
        'nurse' => ['system' => 'http://snomed.info/sct', 'code' => '265937000', 'display' => 'Nurse'],
    ];
    $normalized = strtolower(trim($role));
    $coding = $map[$normalized] ?? $map['doctor']; // safe default -- "doctor" is the most common receiving role
    return ['coding' => [$coding], 'text' => $role !== '' ? ucfirst($normalized) : $coding['display']];
}

// ServiceRequest.category has a REQUIRED binding to this PH eReferral value set
// (confirmed 2026-09-15 via a live 422). The real expansion has only 2 codes --
// Emergency/Outpatient -- not the Emergency/Urgent/Routine our form originally
// offered, so the form's options were changed to match this exactly rather
// than trying to force a 3-to-2 mapping. Fetched from
// https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category.
//
// The Emergency display was corrected 2026-09-16 to match the official
// Connectathon Postman collection's own REF-14_referralCategoryDisplay
// variable ("Hospital-based outpatient emergency care center" -- the real
// SNOMED concept name for 73770003) -- .text stays "Emergency" for our own
// human-readable label, same split the collection itself uses (Code/Display/
// Text as three separate variables). No equivalent example exists in that
// collection for the Outpatient code (440655000), so its display is still
// only our own best-effort text, not sandbox/collection-verified like this one.
function fhirReferralCategoryCoding(string $category): array {
    $map = [
        'emergency' => ['system' => 'http://snomed.info/sct', 'code' => '73770003', 'display' => 'Hospital-based outpatient emergency care center'],
        'outpatient' => ['system' => 'http://snomed.info/sct', 'code' => '440655000', 'display' => 'Outpatient'],
    ];
    $normalized = strtolower(trim($category));
    $coding = $map[$normalized] ?? $map['outpatient'];
    $textLabel = $normalized === 'emergency' ? 'Emergency' : ($normalized === 'outpatient' ? 'Outpatient' : $coding['display']);
    return ['coding' => [$coding], 'text' => $textLabel];
}

// ServiceRequest.priority is type `code`, not a CodeableConcept -- a plain
// string value, no coding array/system wrapper needed -- from FHIR's own
// built-in request-priority CodeSystem (http://hl7.org/fhir/request-priority),
// NOT SNOMED and not a PH-specific value set: routine | urgent | asap | stat.
// mock_hospitals only collects Emergency/Outpatient, so this is a 2-value
// map, not a lookup -- Emergency referrals are stat, everything else routine.
function fhirReferralPriority(string $category): string {
    return strtolower(trim($category)) === 'emergency' ? 'stat' : 'routine';
}

// ServiceRequest.reasonCode also has a REQUIRED binding, but to a DIFFERENT
// value set than its name suggests -- "Reason for Referral (Service Type) VS"
// is actually the *type of service* being requested (Consultation/Diagnostics/
// Procedure/Others), not a clinical reason like "Higher Level of Care Required".
// mock_hospitals' free-text reason field answers a different question, so it
// moved to ServiceRequest.note instead (see fhir_send_referral.php) and this
// new coded "Service Type" field feeds reasonCode. Fetched from
// https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/reason-for-referral-service-type.
function fhirServiceTypeCoding(string $serviceType): array {
    $map = [
        'consultation' => ['system' => 'http://snomed.info/sct', 'code' => '11429006', 'display' => 'Consultation'],
        'diagnostics' => ['system' => 'http://snomed.info/sct', 'code' => '165197003', 'display' => 'Diagnostics'],
        'procedure' => ['system' => 'http://snomed.info/sct', 'code' => '71388002', 'display' => 'Procedure'],
        'others' => ['system' => 'http://snomed.info/sct', 'code' => '3457005', 'display' => 'Others'],
    ];
    $normalized = strtolower(trim($serviceType));
    $coding = $map[$normalized] ?? $map['others'];
    return ['coding' => [$coding], 'text' => $coding['display']];
}

function genFhirUuidV4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/**
 * Builds a PH Core-shaped Organization resource for one mock_hospitals facility,
 * plus the conditional-PUT URL to create-or-update it by our own identifier
 * (never by a raw server-assigned id, per the safety rules). $address/$phone are
 * optional -- facilities that haven't filled them in yet just omit those fields
 * rather than sending empty strings.
 *
 * @return array{resource: array, identifierValue: string, conditionalUrl: string}
 */
function buildDiwaOrganizationResource(int $facilityId, string $facilityName, ?string $address = null, ?string $phone = null): array {
    $identifierValue = FHIR_TEST_ID_PREFIX . 'ORG-' . $facilityId;
    $resource = [
        'resourceType' => 'Organization',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization']],
        'identifier' => [[
            'system' => FHIR_TEST_ID_SYSTEM,
            'value' => $identifierValue,
        ]],
        'name' => $facilityName,
        'alias' => [FHIR_TEST_ALIAS],
    ];
    if ($address !== null && trim($address) !== '') {
        $resource['address'] = [['text' => trim($address), 'country' => 'PH']];
    }
    if ($phone !== null && trim($phone) !== '') {
        $resource['telecom'] = [['system' => 'phone', 'value' => trim($phone), 'use' => 'work']];
    }
    return [
        'resource' => $resource,
        'identifierValue' => $identifierValue,
        'conditionalUrl' => 'Organization?identifier=' . FHIR_TEST_ID_SYSTEM . '|' . $identifierValue,
    ];
}

/**
 * Finds the real server-assigned reference (e.g. "ServiceRequest/23498") for
 * one resource type from a transaction-response Bundle, by matching entry
 * position against the original request Bundle (transaction responses are
 * guaranteed to be in the same order as the request, per the FHIR spec) and
 * reading that entry's response.location. Returns null if not found (e.g. a
 * failed/partial response, or dry_run where there's no response at all).
 */
function fhirExtractCreatedRef(array $requestBundle, ?array $responseBundle, string $resourceType): ?string {
    if (!$responseBundle) return null;
    foreach (($requestBundle['entry'] ?? []) as $i => $entry) {
        if (($entry['resource']['resourceType'] ?? '') !== $resourceType) continue;
        $location = $responseBundle['entry'][$i]['response']['location'] ?? null;
        if (!$location) return null;
        // location looks like "ServiceRequest/23498/_history/1" -- keep just the first two segments.
        $parts = explode('/', $location);
        return isset($parts[0], $parts[1]) ? "{$parts[0]}/{$parts[1]}" : null;
    }
    return null;
}

/** Extracts the id portion of a "ResourceType/id" reference string. */
function fhirRefId(?string $ref): ?string {
    if (!$ref) return null;
    $parts = explode('/', $ref);
    return end($parts);
}

/** Best-effort human-readable name from a FHIR HumanName[] array. */
function fhirHumanName(?array $nameArr): ?string {
    if (empty($nameArr[0])) return null;
    $n = $nameArr[0];
    if (!empty($n['text'])) return $n['text'];
    return trim(implode(' ', $n['given'] ?? []) . ' ' . ($n['family'] ?? ''));
}

/**
 * Simplifies a raw FHIR Patient resource down to the handful of fields the
 * "FHIR: Patients" browse tab and id lookup actually display -- same shape
 * convention as fhir_list_organizations.php's Organization simplification.
 */
function fhirSimplifyPatient(array $res): array {
    return [
        'id' => $res['id'] ?? null,
        'name' => fhirHumanName($res['name'] ?? null) ?? '(no name)',
        'dob' => $res['birthDate'] ?? null,
        'gender' => $res['gender'] ?? null,
        'identifiers' => array_map(
            fn($i) => trim(($i['system'] ?? '') . '|' . ($i['value'] ?? ''), '|'),
            $res['identifier'] ?? []
        ),
    ];
}

/**
 * Pulls together everything about one incoming referral (ServiceRequest) from
 * the sandbox for the "View Details" / "Save to Our Patients" actions: the
 * ServiceRequest itself, the full Patient, any Condition/Observation/Procedure/
 * DiagnosticReport tied to the same Encounter (falling back to a subject-based
 * search if the ServiceRequest has no .encounter), the Task, and the sending
 * Organization's name (via the requester PractitionerRole). Read-only --
 * several GETs for one deliberate, user-triggered click, not polling.
 *
 * @return array{success: bool, message?: string, service_request?: array, patient?: array,
 *   conditions?: array, observations?: array, procedures?: array, diagnostic_reports?: array,
 *   task?: ?array, source_organization_name?: ?string, source_organization_ref?: ?string}
 */
function fetchFhirReferralDetail(string $serviceRequestId): array {
    [$code, $sr, $errno, $err] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'ServiceRequest/' . urlencode($serviceRequestId));
    if ($errno || $code < 200 || $code >= 300 || !is_array($sr)) {
        return ['success' => false, 'message' => 'Could not fetch that referral from the sandbox.', 'http_status' => $code];
    }

    $patientId = fhirRefId($sr['subject']['reference'] ?? null);
    $encounterId = fhirRefId($sr['encounter']['reference'] ?? null);
    $requesterRef = $sr['requester']['reference'] ?? null;

    $patient = null;
    if ($patientId) {
        [, $patientRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($patientId));
        $patient = is_array($patientRes) && ($patientRes['resourceType'] ?? '') === 'Patient' ? $patientRes : null;
    }

    $searchScope = $encounterId ? "encounter=Encounter/{$encounterId}" : ($patientId ? "subject=Patient/{$patientId}" : null);
    $resultsByType = ['Condition' => [], 'Observation' => [], 'Procedure' => [], 'DiagnosticReport' => []];
    if ($searchScope) {
        foreach (array_keys($resultsByType) as $resourceType) {
            [, $searchRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, "{$resourceType}?{$searchScope}&_count=50");
            foreach (($searchRes['entry'] ?? []) as $entry) {
                if (($entry['resource']['resourceType'] ?? '') === $resourceType) {
                    $resultsByType[$resourceType][] = $entry['resource'];
                }
            }
        }
    }
    $conditions = $resultsByType['Condition'];
    $observations = $resultsByType['Observation'];
    $procedures = $resultsByType['Procedure'];
    $diagnosticReports = $resultsByType['DiagnosticReport'];

    $task = null;
    [, $taskRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Task?focus=ServiceRequest/' . urlencode($serviceRequestId) . '&_count=1');
    foreach (($taskRes['entry'] ?? []) as $entry) {
        if (($entry['resource']['resourceType'] ?? '') === 'Task') {
            $task = $entry['resource'];
            break;
        }
    }

    // .requester can be either a PractitionerRole (our own adapter's convention --
    // resolve one hop further to its .organization) or an Organization directly
    // (confirmed live 2026-09-15: other Connectathon senders do this too, same
    // as the .performer direct-Organization case handled in
    // fhir_poll_incoming_referrals.php) -- handle both shapes.
    $sourceOrgName = null;
    $orgId = null;
    if (str_starts_with((string)$requesterRef, 'Organization/')) {
        $orgId = fhirRefId($requesterRef);
    } elseif (str_starts_with((string)$requesterRef, 'PractitionerRole/')) {
        [, $roleRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $requesterRef);
        $orgId = is_array($roleRes) ? fhirRefId($roleRes['organization']['reference'] ?? null) : null;
    }
    if ($orgId) {
        [, $orgRes] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Organization/' . urlencode($orgId));
        $sourceOrgName = is_array($orgRes) ? ($orgRes['name'] ?? null) : null;
    }

    return [
        'success' => true,
        'service_request' => $sr,
        'patient' => $patient,
        'conditions' => $conditions,
        'observations' => $observations,
        'procedures' => $procedures,
        'diagnostic_reports' => $diagnosticReports,
        'task' => $task,
        'source_organization_name' => $sourceOrgName,
        'source_organization_ref' => $orgId ? 'Organization/' . $orgId : null,
    ];
}
