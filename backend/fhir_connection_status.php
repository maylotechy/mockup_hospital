<?php
// ========================================================
// API Endpoint: Lightweight FHIR Connectathon sandbox connectivity check, for
// the header status badge ("FHIR: Connected" / "Unreachable" / "Not Registered").
// Fully separate from the IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
//
// Two independent facts, both cheap:
//   1. "registered" -- does this facility have a cached fhir_organization_id
//      (from the FHIR: Organizations tab)? Pure local DB read, no network call.
//   2. "reachable" -- only checked when registered, via a single GET of our own
//      Organization on the sandbox with a short timeout, so a slow/down sandbox
//      doesn't leave the header badge hanging or pile up long-running requests
//      (this runs on an automatic ~60s interval -- see fhir-connectathon-status.js).
// ========================================================

require_once __DIR__ . '/config.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$facilityId = (int)($user['facility']['id'] ?? 0);
if ($facilityId <= 0) {
    sendJsonResponse(['success' => false, 'message' => 'Could not determine your facility from your session.'], 400);
}

$pdo = getDbConnection();
$stmt = $pdo->prepare('SELECT fhir_organization_id FROM facilities WHERE id = :id');
$stmt->execute([':id' => $facilityId]);
$facility = $stmt->fetch();

$orgRef = $facility['fhir_organization_id'] ?? null;

if (!$orgRef) {
    sendJsonResponse([
        'success' => true,
        'registered' => false,
        'organization_ref' => null,
        'reachable' => null,
    ]);
}

// Short timeout -- this is a background poll, not a user-triggered send, so it
// should fail fast rather than hold a connection open against a slow sandbox.
[$httpCode, , $curlErrno] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, $orgRef, null, 6);

$reachable = !$curlErrno && $httpCode >= 200 && $httpCode < 300;

sendJsonResponse([
    'success' => true,
    'registered' => true,
    'organization_ref' => $orgRef,
    'reachable' => $reachable,
    'http_status' => $httpCode,
]);
