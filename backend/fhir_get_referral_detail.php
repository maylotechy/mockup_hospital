<?php
// ========================================================
// API Endpoint: Fetch the full detail of one incoming referral (Patient,
// Condition(s), Observation(s), Procedure, DiagnosticReport, Task, sending
// facility name) for the "View Details" action on the FHIR: Receive tab.
// Read-only. Fully separate from the IOL/IRDSS flow; see
// hackathon_tracker/TRACKER.md.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$serviceRequestId = trim((string)($_GET['service_request_id'] ?? ''));
if ($serviceRequestId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing required field: service_request_id.'], 400);
}

$detail = fetchFhirReferralDetail($serviceRequestId);
if (!$detail['success']) {
    sendJsonResponse($detail, $detail['http_status'] ?? 502);
}

sendJsonResponse($detail);
