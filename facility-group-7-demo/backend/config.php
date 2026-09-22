<?php
// ========================================================
// FACILITY-GROUP-7 Demo System -- Config & Helpers
// Reuses sendFhirRequest() from main mock_hospitals backend
// ========================================================

// Reuse the main app's FHIR request helper and constants
require_once __DIR__ . '/../../backend/config.php';

// Our own identifier prefix and system for all data sent to FHIR sandbox
define('FG7_ID_SYSTEM', 'https://facility-group-7-demo/fhir/identifier');
define('FG7_ID_PREFIX', 'FACILITY-GROUP-7-');
define('FG7_ORG_NAME', 'Facility Group 7 Demo Hospital');
define('FG7_ORG_ADDRESS', 'Demo Hospital, PH');

// Verified against the main app's already-tested fhir_send_referral.php
define('FG7_PHILHEALTH_ID_SYSTEM', 'http://philhealth.gov.ph/fhir/Identifier/philhealth-id');
define('FG7_PHILSYS_ID_SYSTEM', 'http://philsys.gov.ph/fhir/Identifier/philsys-id');

// Verified live against tx.fhirlab.net (ValueSet/psgc expansion "used-codesystem")
// and against the project's own Postman collection (Update Patient/Organization bodies)
define('FG7_PSGC_CODING_SYSTEM', 'https://psa.gov.ph/classification/psgc');
// The server hosts a full PSGC dataset (43769 concepts) AND a sparse
// "psgc-r12-mini" demo subset under this same url -- pin to the full
// version or lookups silently resolve to the sparse one and drop data
// (verified live: General Santos returned only 2/26 barangays, NCR 0 cities).
define('FG7_PSGC_DATASET_VERSION', '1Q-2026');
define('FG7_TX_BASE_URL', 'https://tx.fhirlab.net/fhir');

// Verified against the project's own Postman collection (address.extension[].url)
define('FG7_PSGC_EXT_REGION', 'https://fhir.doh.gov.ph/phcore/StructureDefinition/region');
define('FG7_PSGC_EXT_PROVINCE', 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province');
define('FG7_PSGC_EXT_CITY', 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality');
define('FG7_PSGC_EXT_BARANGAY', 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay');

// SNOMED/PSOC/PHCW-coded helpers (reuse from mock_hospitals with our prefix)
// Verified against https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role
function fg7PractitionerRoleCoding(string $role): array {
    $map = [
        'doctor' => ['system' => 'http://snomed.info/sct', 'code' => '158965000', 'display' => 'Doctor'],
        'nurse' => ['system' => 'http://snomed.info/sct', 'code' => '265937000', 'display' => 'Nurse'],
        'midwife' => ['system' => 'http://snomed.info/sct', 'code' => '309453006', 'display' => 'Midwife'],
        'pharmacist' => ['system' => 'http://snomed.info/sct', 'code' => '46255001', 'display' => 'Pharmacist'],
        'medtech' => ['system' => 'http://snomed.info/sct', 'code' => '386629007', 'display' => 'Medical Technologist'],
        'labaide' => ['system' => 'http://snomed.info/sct', 'code' => '159282002', 'display' => 'Laboratory Aide'],
        'dentist' => ['system' => 'http://snomed.info/sct', 'code' => '106289002', 'display' => 'Dentist'],
        'dentalaide' => ['system' => 'http://snomed.info/sct', 'code' => '4162009', 'display' => 'Dental Aide'],
        'optometrist' => ['system' => 'http://snomed.info/sct', 'code' => '28229004', 'display' => 'Optometrist'],
        'bhw' => ['system' => 'https://fhir.doh.gov.ph/phcore/CodeSystem/PSOC', 'code' => '3253', 'display' => 'Barangay health worker'],
        'pcw' => ['system' => 'https://fhir.doh.gov.ph/phcore/CodeSystem/PHCW', 'code' => 'PCW', 'display' => 'Primary Care Worker'],
    ];
    $normalized = strtolower(trim($role));
    $coding = $map[$normalized] ?? $map['doctor'];
    return ['coding' => [$coding], 'text' => $coding['display']];
}

function fg7ReferralCategoryCoding(string $category): array {
    $map = [
        'emergency' => ['system' => 'http://snomed.info/sct', 'code' => '73770003', 'display' => 'Hospital-based outpatient emergency care center'],
        'outpatient' => ['system' => 'http://snomed.info/sct', 'code' => '440655000', 'display' => 'Outpatient'],
    ];
    $normalized = strtolower(trim($category));
    $coding = $map[$normalized] ?? $map['outpatient'];
    $textLabel = $normalized === 'emergency' ? 'Emergency' : ($normalized === 'outpatient' ? 'Outpatient' : $coding['display']);
    return ['coding' => [$coding], 'text' => $textLabel];
}

function fg7ServiceTypeCoding(string $serviceType): array {
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

function fg7ReferralPriority(string $category): string {
    return strtolower(trim($category)) === 'emergency' ? 'stat' : 'routine';
}

function fg7GenUuidV4(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function fg7RefId(?string $ref): ?string {
    if (!$ref) return null;
    $parts = explode('/', $ref);
    return end($parts);
}

function fg7HumanName(?array $nameArr): ?string {
    if (empty($nameArr[0])) return null;
    $n = $nameArr[0];
    if (!empty($n['text'])) return $n['text'];
    return trim(implode(' ', $n['given'] ?? []) . ' ' . ($n['family'] ?? ''));
}

// Mirrors the main app's simpleVitalObservation() (backend/fhir_send_referral.php)
function fg7VitalObservation(string $loincCode, string $loincDisplay, float $value, string $unit, string $ucumCode, string $patientUuid, string $encounterUuid, string $effectiveDateTime): array {
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

// JSON Patch (RFC 6902) against a FHIR resource -- needs Content-Type:
// application/json-patch+json, which sendFhirRequest() doesn't send (it always
// sends application/fhir+json), so this can't reuse it directly.
function fg7JsonPatch(string $resourceType, string $id, array $patchOps): array {
    $url = rtrim(FHIR_EREFERRAL_BASE_URL, '/') . '/' . $resourceType . '/' . urlencode($id);

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_CUSTOMREQUEST, 'PATCH');
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($patchOps));
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json-patch+json', 'Accept: application/fhir+json']);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);

    $raw = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errno = curl_errno($ch);
    $err = curl_error($ch);
    curl_close($ch);

    if ($errno) {
        return [0, null, $errno, $err];
    }
    $decoded = json_decode($raw, true);
    return [$httpCode, $decoded !== null ? $decoded : $raw, 0, null];
}

// Looks up the Task tracking a given ServiceRequest (created alongside it at
// send time -- see fhir_send_referral.php). Returns null if none is found.
function fg7FindTaskForServiceRequest(string $serviceRequestId): ?array {
    [$code, $response, $errno] = sendFhirRequest(
        'GET', FHIR_EREFERRAL_BASE_URL, 'Task?focus=' . urlencode("ServiceRequest/$serviceRequestId") . '&_count=1'
    );
    if ($errno || $code < 200 || $code >= 300) return null;
    foreach (($response['entry'] ?? []) as $entry) {
        $res = $entry['resource'] ?? [];
        if (($res['resourceType'] ?? '') === 'Task') return $res;
    }
    return null;
}

// Looks up a receiving Encounter already created for a given ServiceRequest
// (Encounter.basedOn), so re-running "Create Encounter" is idempotent.
function fg7FindEncounterForServiceRequest(string $serviceRequestId): ?array {
    [$code, $response, $errno] = sendFhirRequest(
        'GET', FHIR_EREFERRAL_BASE_URL, 'Encounter?based-on=' . urlencode("ServiceRequest/$serviceRequestId") . '&_count=1'
    );
    if ($errno || $code < 200 || $code >= 300) return null;
    foreach (($response['entry'] ?? []) as $entry) {
        $res = $entry['resource'] ?? [];
        if (($res['resourceType'] ?? '') === 'Encounter') return $res;
    }
    return null;
}

// Full detail (address/phone/identifiers broken out), used by list/get/edit --
// the Edit Patient form needs every field pre-filled, not just display fields.
function fg7SimplifyPatient(array $res): array {
    $addr = $res['address'][0] ?? [];
    $extByUrl = [];
    foreach (($addr['extension'] ?? []) as $ext) {
        $extByUrl[$ext['url'] ?? ''] = $ext['valueCoding'] ?? [];
    }
    $phone = null;
    foreach (($res['telecom'] ?? []) as $t) {
        if (($t['system'] ?? '') === 'phone') { $phone = $t['value'] ?? null; break; }
    }
    $philhealth = null;
    $philsys = null;
    foreach (($res['identifier'] ?? []) as $id) {
        if (($id['system'] ?? '') === FG7_PHILHEALTH_ID_SYSTEM) $philhealth = $id['value'] ?? null;
        if (($id['system'] ?? '') === FG7_PHILSYS_ID_SYSTEM) $philsys = $id['value'] ?? null;
    }
    $name = $res['name'][0] ?? [];

    return [
        'id' => $res['id'] ?? null,
        'name' => fg7HumanName($res['name'] ?? null) ?? '(no name)',
        'given_first' => $name['given'][0] ?? '',
        'given_middle' => $name['given'][1] ?? '',
        'family' => $name['family'] ?? '',
        'dob' => $res['birthDate'] ?? null,
        'gender' => $res['gender'] ?? null,
        'phone' => $phone,
        'philhealth' => $philhealth,
        'philsys' => $philsys,
        'region_code' => $extByUrl[FG7_PSGC_EXT_REGION]['code'] ?? null,
        'region_display' => $extByUrl[FG7_PSGC_EXT_REGION]['display'] ?? null,
        'province_code' => $extByUrl[FG7_PSGC_EXT_PROVINCE]['code'] ?? null,
        'province_display' => $extByUrl[FG7_PSGC_EXT_PROVINCE]['display'] ?? null,
        'city_code' => $extByUrl[FG7_PSGC_EXT_CITY]['code'] ?? null,
        'city_display' => $extByUrl[FG7_PSGC_EXT_CITY]['display'] ?? null,
        'barangay_code' => $extByUrl[FG7_PSGC_EXT_BARANGAY]['code'] ?? null,
        'barangay_display' => $extByUrl[FG7_PSGC_EXT_BARANGAY]['display'] ?? null,
        'address_line' => $addr['line'][0] ?? null,
        'postal_code' => $addr['postalCode'] ?? null,
        'identifiers' => array_map(
            fn($i) => trim(($i['system'] ?? '') . '|' . ($i['value'] ?? ''), '|'),
            $res['identifier'] ?? []
        ),
    ];
}

// Shared by create and update -- builds a Patient resource from form input.
// $keepIdentifiers carries over identifiers not on the form (namely our own
// FG7 tracking identifier) so an edit never loses/changes it; philhealth/
// philsys are always rebuilt from the submitted values so edits can add,
// change, or clear them.
function fg7BuildPatientResource(array $body, array $keepIdentifiers = []): array {
    $givenFirst = trim($body['given_first'] ?? '');
    $givenMiddle = trim($body['given_middle'] ?? '');
    $family = trim($body['family'] ?? '');
    $dob = trim($body['dob'] ?? '');
    $gender = trim($body['gender'] ?? '');
    $phone = trim($body['phone'] ?? '');
    $philhealth = trim($body['philhealth'] ?? '');
    $philsys = trim($body['philsys'] ?? '');

    $regionCode = trim($body['region_code'] ?? '');
    $regionDisplay = trim($body['region_display'] ?? '');
    $provinceCode = trim($body['province_code'] ?? '');
    $provinceDisplay = trim($body['province_display'] ?? '');
    $cityCode = trim($body['city_code'] ?? '');
    $cityDisplay = trim($body['city_display'] ?? '');
    $barangayCode = trim($body['barangay_code'] ?? '');
    $barangayDisplay = trim($body['barangay_display'] ?? '');
    $addressLine = trim($body['address_line'] ?? '');
    $postalCode = trim($body['postal_code'] ?? '');

    if (!$givenFirst || !$family || !$dob || !$gender || !$regionCode || !$provinceCode || !$cityCode || !$barangayCode) {
        return ['error' => 'Missing required fields: first name, last name, dob, gender, and full region/province/city/barangay'];
    }

    $identifiers = array_values(array_filter($keepIdentifiers, function ($id) {
        $sys = $id['system'] ?? '';
        return $sys !== FG7_PHILHEALTH_ID_SYSTEM && $sys !== FG7_PHILSYS_ID_SYSTEM;
    }));
    if ($philhealth) $identifiers[] = ['system' => FG7_PHILHEALTH_ID_SYSTEM, 'value' => $philhealth];
    if ($philsys) $identifiers[] = ['system' => FG7_PHILSYS_ID_SYSTEM, 'value' => $philsys];
    $hasFg7Id = array_filter($identifiers, fn($i) => ($i['system'] ?? '') === FG7_ID_SYSTEM);
    if (!$hasFg7Id) {
        $identifiers[] = ['system' => FG7_ID_SYSTEM, 'value' => FG7_ID_PREFIX . 'PATIENT-' . fg7GenUuidV4()];
    }

    $given = array_values(array_filter([$givenFirst, $givenMiddle]));

    $addressExtensions = [
        ['url' => FG7_PSGC_EXT_REGION, 'valueCoding' => ['system' => FG7_PSGC_CODING_SYSTEM, 'code' => $regionCode, 'display' => $regionDisplay]],
        ['url' => FG7_PSGC_EXT_PROVINCE, 'valueCoding' => ['system' => FG7_PSGC_CODING_SYSTEM, 'code' => $provinceCode, 'display' => $provinceDisplay]],
        ['url' => FG7_PSGC_EXT_CITY, 'valueCoding' => ['system' => FG7_PSGC_CODING_SYSTEM, 'code' => $cityCode, 'display' => $cityDisplay]],
        ['url' => FG7_PSGC_EXT_BARANGAY, 'valueCoding' => ['system' => FG7_PSGC_CODING_SYSTEM, 'code' => $barangayCode, 'display' => $barangayDisplay]],
    ];

    $addressResource = [
        'extension' => $addressExtensions,
        'use' => 'home',
        'line' => $addressLine ? [$addressLine] : [],
        'country' => 'PH',
    ];
    if ($postalCode) {
        $addressResource['postalCode'] = $postalCode;
    }

    $patientResource = [
        'resourceType' => 'Patient',
        'meta' => ['profile' => ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-patient']],
        'identifier' => $identifiers,
        'active' => true,
        'name' => [['use' => 'official', 'family' => $family, 'given' => $given]],
        'gender' => $gender,
        'birthDate' => $dob,
        'address' => [$addressResource],
    ];
    if ($phone) {
        $patientResource['telecom'] = [['system' => 'phone', 'value' => $phone, 'use' => 'mobile']];
    }

    return ['resource' => $patientResource, 'display_name' => trim(implode(' ', $given) . ' ' . $family)];
}
