<?php
// ========================================================
// API Endpoint: Register a New Patient
// ========================================================

require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse([
        'success' => false,
        'message' => 'Invalid request method. Only POST is allowed.'
    ], 405);
}

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Unauthorized. Please sign in to register a patient.'
    ], 401);
}

$input = $_POST;
$rawInput = file_get_contents('php://input');
if (empty($input) && !empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $input = $decoded;
    }
}

function inVal($input, $key, $default = null) {
    return isset($input[$key]) && $input[$key] !== '' ? trim((string)$input[$key]) : $default;
}

$firstName = inVal($input, 'first_name');
$lastName  = inVal($input, 'last_name');
$dob       = inVal($input, 'dob');
$gender    = inVal($input, 'gender');
$phone     = inVal($input, 'phone');

$errors = [];
if (empty($firstName)) $errors[] = 'First name is required.';
if (empty($lastName)) $errors[] = 'Last name is required.';
if (empty($dob)) $errors[] = 'Date of birth is required.';
if (!in_array($gender, ['Male', 'Female', 'Other'], true)) $errors[] = 'A valid gender is required.';
if (empty($phone)) $errors[] = 'Phone number is required.';

$civilStatus = inVal($input, 'civil_status');
if ($civilStatus !== null && !in_array($civilStatus, ['Single', 'Married', 'Widow/er', 'Separated'], true)) {
    $errors[] = 'Invalid civil status value.';
}

$philhealthMember = inVal($input, 'philhealth_member', 'No');
if (!in_array($philhealthMember, ['Yes', 'No'], true)) $errors[] = 'Invalid PhilHealth member value.';

$philhealthStatusType = inVal($input, 'philhealth_status_type');
if ($philhealthStatusType !== null && !in_array($philhealthStatusType, ['Member', 'Dependent'], true)) {
    $errors[] = 'Invalid PhilHealth status type value.';
}

$is4psMember = inVal($input, 'is_4ps_member', 'No');
if (!in_array($is4psMember, ['Yes', 'No'], true)) $errors[] = 'Invalid 4Ps member value.';

if (!empty($errors)) {
    sendJsonResponse([
        'success' => false,
        'message' => implode(' ', $errors)
    ], 400);
}

try {
    $pdo = getDbConnection();
    $stmt = $pdo->prepare('
        INSERT INTO patients (
            facility_id, first_name, middle_name, last_name, suffix, dob, gender, civil_status, phone,
            region, province, city_municipality, barangay, zip_code,
            philhealth_member, philhealth_number, philhealth_status_type, is_4ps_member,
            created_by_user_id
        ) VALUES (
            :facility_id, :first_name, :middle_name, :last_name, :suffix, :dob, :gender, :civil_status, :phone,
            :region, :province, :city_municipality, :barangay, :zip_code,
            :philhealth_member, :philhealth_number, :philhealth_status_type, :is_4ps_member,
            :created_by_user_id
        )
    ');
    $stmt->execute([
        ':facility_id'             => (int)$loggedInUser['facility']['id'],
        ':first_name'              => $firstName,
        ':middle_name'             => inVal($input, 'middle_name'),
        ':last_name'               => $lastName,
        ':suffix'                  => inVal($input, 'suffix'),
        ':dob'                     => $dob,
        ':gender'                  => $gender,
        ':civil_status'            => $civilStatus,
        ':phone'                   => $phone,
        ':region'                  => inVal($input, 'region'),
        ':province'                => inVal($input, 'province'),
        ':city_municipality'       => inVal($input, 'city_municipality'),
        ':barangay'                => inVal($input, 'barangay'),
        ':zip_code'                => inVal($input, 'zip_code'),
        ':philhealth_member'       => $philhealthMember,
        ':philhealth_number'       => inVal($input, 'philhealth_number'),
        ':philhealth_status_type'  => $philhealthStatusType,
        ':is_4ps_member'           => $is4psMember,
        ':created_by_user_id'      => (int)$loggedInUser['id']
    ]);

    $newPatientId = (int)$pdo->lastInsertId();

    sendJsonResponse([
        'success' => true,
        'message' => 'Patient registered successfully.',
        'data' => ['id' => $newPatientId]
    ]);

} catch (Exception $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'An error occurred while registering the patient: ' . $e->getMessage()
    ], 500);
}
