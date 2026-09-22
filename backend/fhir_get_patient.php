<?php
// ========================================================
// API Endpoint: Read one Patient from the HL7 FHIR Connectathon sandbox by
// its logical id (GET /Patient/{id}). For the "Look up by ID" box on the
// "FHIR: Patients" tab -- pairs with fhir_search_patients.php's browse list,
// for when a staff member already has a specific id (e.g. seen in a
// ServiceRequest reference elsewhere) and doesn't want to page through the
// whole browse list to find it. Read-only. Fully separate from the IOL/IRDSS
// flow; see hackathon_tracker/TRACKER.md.
// ========================================================

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/fhir_shared.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}

$patientId = trim((string)($_GET['id'] ?? ''));
if ($patientId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing required field: id.'], 400);
}

[$httpCode, $response, $curlErrno, $curlError] = sendFhirRequest('GET', FHIR_EREFERRAL_BASE_URL, 'Patient/' . urlencode($patientId));

if ($curlErrno || $httpCode < 200 || $httpCode >= 300 || !is_array($response) || ($response['resourceType'] ?? '') !== 'Patient') {
    sendJsonResponse([
        'success' => false,
        'message' => $httpCode === 404 ? "No Patient found with id \"{$patientId}\"." : 'Could not reach the FHIR sandbox.',
        'http_status' => $httpCode,
        'curl_error' => $curlErrno ? $curlError : null,
    ], $httpCode ?: 502);
}

sendJsonResponse([
    'success' => true,
    'patient' => fhirSimplifyPatient($response),
    'raw' => $response,
]);
