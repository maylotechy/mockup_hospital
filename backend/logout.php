<?php
// ========================================================
// API Endpoint: Staff Logout
// ========================================================

require_once __DIR__ . '/config.php';

// Clear session data
unset($_SESSION['user']);
session_destroy();

sendJsonResponse([
    'success' => true,
    'message' => 'Logged out successfully.'
]);
