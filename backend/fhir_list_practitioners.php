<?php
// ========================================================
// API Endpoint: List doctor/nurse staff at the logged-in user's own facility,
// for the "Referring Practitioner" picker on the FHIR: Send Test form.
// Fully separate from the IOL/IRDSS flow; see hackathon_tracker/TRACKER.md.
//
// Deliberately NOT manage_users.php -- that endpoint is facility_admin-only
// (requireRole(['facility_admin'])), but any doctor/nurse can open the Send
// Test tab and needs to see this list, so it gets its own narrow, read-only
// endpoint instead of loosening manage_users.php's access.
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

try {
    $pdo = getDbConnection();
    $stmt = $pdo->prepare("
        SELECT id, full_name, role, license_number
        FROM users
        WHERE facility_id = :facility_id AND role IN ('doctor', 'nurse') AND is_active = 1
        ORDER BY role, full_name
    ");
    $stmt->execute([':facility_id' => $facilityId]);
    $rows = $stmt->fetchAll();

    $practitioners = array_map(function ($row) use ($user) {
        return [
            'id' => (int)$row['id'],
            'full_name' => $row['full_name'],
            'role' => $row['role'],
            'license_number' => $row['license_number'],
            'is_self' => (int)$row['id'] === (int)($user['id'] ?? 0),
        ];
    }, $rows);

    sendJsonResponse(['success' => true, 'practitioners' => $practitioners]);
} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'Could not load practitioners.'], 500);
}
