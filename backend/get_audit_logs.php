<?php
// ========================================================
// API Endpoint: Get Facility Audit Trail (System Logs)
// Local-only -- IOL has no concept of individual staff users, so this reads
// straight from mock_hospitals' own audit_logs table, not a proxy to IOL.
// ========================================================

require_once __DIR__ . '/config.php';

$loggedInUser = getLoggedInUser();
if (!$loggedInUser) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized. Please log in again.'], 401);
}
requireRole(['facility_admin']);

try {
    $pdo = getDbConnection();
    $stmt = $pdo->prepare('
        SELECT id, user_full_name, user_role, action, referral_id, patient_name, details, created_at
        FROM audit_logs
        WHERE facility_id = :facility_id
        ORDER BY created_at DESC
        LIMIT 500
    ');
    $stmt->execute([':facility_id' => (int)($loggedInUser['facility']['id'] ?? 0)]);
    $rows = $stmt->fetchAll();

    sendJsonResponse(['success' => true, 'data' => $rows]);
} catch (Exception $e) {
    sendJsonResponse(['success' => false, 'message' => 'Failed to load audit logs: ' . $e->getMessage()], 500);
}
