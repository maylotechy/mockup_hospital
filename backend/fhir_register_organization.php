<?php
// ========================================================
// API Endpoint: Get/register the logged-in staff member's own facility as an
// Organization on the HL7 FHIR Connectathon sandbox (conditional PUT by our
// own identifier -- see hackathon_tracker/SANDBOX_SAFETY_RULES.md). Fully
// separate from the IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
//
// GET returns the facility's current name/address/phone/cached fhir_organization_id
// (for the frontend's prefill). POST with dry_run=true builds and returns the
// Organization resource + conditional-PUT URL WITHOUT contacting the sandbox.
// POST with dry_run=false actually PUTs it and, on success, caches the returned
// Organization/{id} locally so future referrals can reference it directly
// instead of re-PUTting the Organization every time.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$facilityId = (int)($user['facility']['id'] ?? 0);
if ($facilityId <= 0) {
    sendJsonResponse(['success' => false, 'message' => 'Could not determine your facility from your session.'], 400);
}

$pdo = getDbConnection();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $stmt = $pdo->prepare('SELECT name, address, phone, fhir_organization_id FROM facilities WHERE id = :id');
    $stmt->execute([':id' => $facilityId]);
    $facility = $stmt->fetch();
    if (!$facility) {
        sendJsonResponse(['success' => false, 'message' => 'Facility not found.'], 404);
    }
    sendJsonResponse(['success' => true, 'facility' => $facility]);
}

requireRole(['doctor', 'nurse', 'facility_admin']);

$rawInput = file_get_contents('php://input');
$input = json_decode($rawInput, true);
if (!is_array($input)) {
    $input = $_POST;
}
$dryRun = !empty($input['dry_run']);
$address = trim((string)($input['address'] ?? ''));
$phone = trim((string)($input['phone'] ?? ''));

$stmt = $pdo->prepare('SELECT name FROM facilities WHERE id = :id');
$stmt->execute([':id' => $facilityId]);
$facilityRow = $stmt->fetch();
$facilityName = trim((string)($facilityRow['name'] ?? ''));
if ($facilityName === '') {
    sendJsonResponse(['success' => false, 'message' => 'Could not determine your facility from your session.'], 400);
}

$org = buildDiwaOrganizationResource($facilityId, $facilityName, $address ?: null, $phone ?: null);

if ($dryRun) {
    sendJsonResponse([
        'success' => true,
        'dry_run' => true,
        'endpoint' => FHIR_EREFERRAL_BASE_URL,
        'resource_sent' => $org['resource'],
        'conditional_url' => $org['conditionalUrl'],
        'message' => 'Preview only -- nothing was sent to the sandbox.',
    ]);
}

// Persist address/phone locally regardless of what happens next -- they're
// useful facility data even if the sandbox call fails.
$updateStmt = $pdo->prepare('UPDATE facilities SET address = :address, phone = :phone WHERE id = :id');
$updateStmt->execute([
    ':address' => $address !== '' ? $address : null,
    ':phone' => $phone !== '' ? $phone : null,
    ':id' => $facilityId,
]);

$bodyJson = json_encode($org['resource'], JSON_UNESCAPED_SLASHES);

[$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('PUT', FHIR_EREFERRAL_BASE_URL, $org['conditionalUrl'], $bodyJson);

$isSuccess = !$curlErrno && $httpCode >= 200 && $httpCode < 300;
$cachedOrgRef = null;

if ($isSuccess) {
    logAuditEvent($user, 'FHIR_CONNECTATHON_ORG_REGISTER', null, $facilityName, 'Registered facility as a FHIR Organization on the Connectathon sandbox');

    $sandboxOrgId = is_array($response) ? ($response['id'] ?? null) : null;
    if ($sandboxOrgId) {
        $cachedOrgRef = 'Organization/' . $sandboxOrgId;
        $cacheStmt = $pdo->prepare('UPDATE facilities SET fhir_organization_id = :ref WHERE id = :id');
        $cacheStmt->execute([':ref' => $cachedOrgRef, ':id' => $facilityId]);
    }
}

sendJsonResponse([
    'success' => $isSuccess,
    'dry_run' => false,
    'http_status' => $httpCode,
    'curl_error' => $curlErrno ? $curlError : null,
    'endpoint' => FHIR_EREFERRAL_BASE_URL,
    'resource_sent' => $org['resource'],
    'sandbox_response' => $response,
    'cached_organization_ref' => $cachedOrgRef,
], $isSuccess ? 200 : ($httpCode ?: 502));
