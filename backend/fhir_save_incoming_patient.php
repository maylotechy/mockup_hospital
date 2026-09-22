<?php
// ========================================================
// API Endpoint: Save an incoming FHIR referral's patient into our local
// patients table -- the "receiving" counterpart to fhir_send_referral.php.
// Mirrors receive_transferred_patient.php's conventions (source_referral_id /
// source_facility / transferred_address / transferred_details_snapshot,
// possible-duplicate prompt + link-or-create) so a FHIR-sourced patient looks
// and behaves the same as an IOL-transferred one everywhere else in the app.
// Fully separate from the IOL/IRDSS flow itself; see hackathon_tracker/TRACKER.md.
//
// Re-fetches the referral from the sandbox server-side by service_request_id
// rather than trusting a client-supplied patient payload -- same principle
// receive_transferred_patient.php uses for the IOL side.
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

$serviceRequestId = trim((string)($input['service_request_id'] ?? ''));
if ($serviceRequestId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing required field: service_request_id.'], 400);
}
$duplicateChoice = isset($input['duplicate_choice']) ? trim((string)$input['duplicate_choice']) : null;
$linkPatientId = isset($input['link_patient_id']) ? (int)$input['link_patient_id'] : null;

$detail = fetchFhirReferralDetail($serviceRequestId);
if (!$detail['success']) {
    sendJsonResponse($detail, $detail['http_status'] ?? 502);
}
$fhirPatient = $detail['patient'];
if (!$fhirPatient) {
    sendJsonResponse(['success' => false, 'message' => 'That referral has no resolvable Patient resource.'], 422);
}

$facilityId = (int)($user['facility']['id'] ?? 0);
$sourceReferralId = 'FHIR-' . $serviceRequestId;

try {
    $pdo = getDbConnection();

    // Idempotency: don't create a second local record for the same referral.
    $existingStmt = $pdo->prepare('SELECT id FROM patients WHERE source_referral_id = :rid AND facility_id = :fid LIMIT 1');
    $existingStmt->execute([':rid' => $sourceReferralId, ':fid' => $facilityId]);
    $existing = $existingStmt->fetch();
    if ($existing) {
        sendJsonResponse([
            'success' => true,
            'message' => 'This patient was already saved to your local records.',
            'patient_id' => (int)$existing['id'],
        ]);
    }

    $fullName = fhirHumanName($fhirPatient['name'] ?? []) ?: 'Unknown Patient';
    $family = $fhirPatient['name'][0]['family'] ?? null;
    $given = $fhirPatient['name'][0]['given'][0] ?? null;
    if ($given || $family) {
        $firstName = $given ?: 'Unknown';
        $lastName = $family ?: 'Patient';
    } else {
        $parts = preg_split('/\s+/', $fullName, 2);
        $firstName = $parts[0] ?? 'Unknown';
        $lastName = $parts[1] ?? 'Patient';
    }

    $genderMap = ['male' => 'Male', 'female' => 'Female'];
    $gender = $genderMap[strtolower((string)($fhirPatient['gender'] ?? ''))] ?? 'Other';
    $dob = !empty($fhirPatient['birthDate']) ? $fhirPatient['birthDate'] : date('Y-m-d');

    $phone = '';
    foreach (($fhirPatient['telecom'] ?? []) as $t) {
        if (($t['system'] ?? '') === 'phone' && !empty($t['value'])) {
            $phone = $t['value'];
            break;
        }
    }

    $addr = $fhirPatient['address'][0] ?? [];
    $barangay = $addr['line'][0] ?? null;
    $cityMunicipality = $addr['city'] ?? null;
    $province = $addr['state'] ?? null;
    $zipCode = $addr['postalCode'] ?? null;
    $addressText = $addr['text'] ?? null;

    $philhealthNumber = null;
    $philsysId = null;
    foreach (($fhirPatient['identifier'] ?? []) as $ident) {
        $system = $ident['system'] ?? '';
        if (stripos($system, 'philhealth') !== false) {
            $philhealthNumber = $ident['value'] ?? null;
        } elseif (stripos($system, 'philsys') !== false) {
            $philsysId = $ident['value'] ?? null;
        }
    }
    $philhealthMember = $philhealthNumber ? 'Yes' : 'No';

    $nok = $fhirPatient['contact'][0] ?? null;
    $nokName = $nok ? ($nok['name']['text'] ?? null) : null;
    $nokRelationship = $nok ? ($nok['relationship'][0]['text'] ?? null) : null;
    $nokPhone = null;
    if ($nok) {
        foreach (($nok['telecom'] ?? []) as $t) {
            if (!empty($t['value'])) { $nokPhone = $t['value']; break; }
        }
    }

    if ($duplicateChoice === null) {
        $match = findPossibleDuplicatePatient($pdo, $facilityId, $firstName, $lastName, $dob);
        if ($match) {
            sendJsonResponse([
                'success' => false,
                'possible_duplicate' => true,
                'existing_patient' => [
                    'id' => (int)$match['id'],
                    'full_name' => trim($match['first_name'] . ' ' . $match['last_name']),
                    'dob' => $match['dob'],
                    'registered_at' => $match['created_at'],
                ],
                'message' => 'A similar patient record already exists at your facility.',
            ]);
        }
    }

    $snapshot = json_encode([
        'source' => 'fhir_connectathon_receive',
        'service_request' => $detail['service_request'],
        'conditions' => $detail['conditions'],
        'observations' => $detail['observations'],
        'procedures' => $detail['procedures'],
        'diagnostic_reports' => $detail['diagnostic_reports'],
        'task' => $detail['task'],
    ]);

    if ($duplicateChoice === 'link' && $linkPatientId) {
        $linkStmt = $pdo->prepare('
            UPDATE patients SET
                source_referral_id = :source_referral_id,
                source_facility = :source_facility,
                transferred_address = :transferred_address,
                transferred_details_snapshot = :transferred_details_snapshot,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = :pid AND facility_id = :fid
        ');
        $linkStmt->execute([
            ':source_referral_id' => $sourceReferralId,
            ':source_facility' => $detail['source_organization_name'] ?? 'Unknown (FHIR sandbox)',
            ':transferred_address' => $addressText,
            ':transferred_details_snapshot' => $snapshot,
            ':pid' => $linkPatientId,
            ':fid' => $facilityId,
        ]);
        $newPatientId = $linkPatientId;
        logAuditEvent($user, 'FHIR_RECEIVE_PATIENT_LINKED', $sourceReferralId, $fullName, "Linked to existing patient #{$linkPatientId}");
    } else {
        $insertStmt = $pdo->prepare('
            INSERT INTO patients
                (facility_id, first_name, last_name, dob, gender, phone,
                 region, province, city_municipality, barangay, zip_code,
                 philhealth_member, philhealth_number, philsys_id,
                 source_referral_id, source_facility, transferred_address, transferred_details_snapshot, created_by_user_id)
            VALUES
                (:facility_id, :first_name, :last_name, :dob, :gender, :phone,
                 :region, :province, :city_municipality, :barangay, :zip_code,
                 :philhealth_member, :philhealth_number, :philsys_id,
                 :source_referral_id, :source_facility, :transferred_address, :transferred_details_snapshot, :created_by_user_id)
        ');
        $insertStmt->execute([
            ':facility_id' => $facilityId,
            ':first_name' => $firstName,
            ':last_name' => $lastName,
            ':dob' => $dob,
            ':gender' => $gender,
            ':phone' => $phone,
            ':region' => null,
            ':province' => $province,
            ':city_municipality' => $cityMunicipality,
            ':barangay' => $barangay,
            ':zip_code' => $zipCode,
            ':philhealth_member' => $philhealthMember,
            ':philhealth_number' => $philhealthNumber,
            ':philsys_id' => $philsysId,
            ':source_referral_id' => $sourceReferralId,
            ':source_facility' => $detail['source_organization_name'] ?? 'Unknown (FHIR sandbox)',
            ':transferred_address' => $addressText,
            ':transferred_details_snapshot' => $snapshot,
            ':created_by_user_id' => (int)($user['id'] ?? 0),
        ]);
        $newPatientId = (int)$pdo->lastInsertId();

        if ($nokName && $nokPhone) {
            $nokStmt = $pdo->prepare('
                INSERT INTO patient_contacts (patient_id, name, relationship, phone)
                VALUES (:patient_id, :name, :relationship, :phone)
            ');
            $nokStmt->execute([
                ':patient_id' => $newPatientId,
                ':name' => $nokName,
                ':relationship' => $nokRelationship,
                ':phone' => $nokPhone,
            ]);
        }

        logAuditEvent($user, 'FHIR_RECEIVE_PATIENT_SAVED', $sourceReferralId, $fullName);
    }

    sendJsonResponse([
        'success' => true,
        'message' => 'Patient saved to your local records.',
        'patient_id' => $newPatientId,
    ]);

} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'An error occurred while saving the patient: ' . $e->getMessage()], 500);
}
