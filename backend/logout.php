<?php
// ========================================================
// API Endpoint: Hospital Logout
// ========================================================

require_once __DIR__ . '/config.php';

// Clear session data
unset($_SESSION['hospital']);
session_destroy();

sendJsonResponse([
    'success' => true,
    'message' => 'Logged out successfully.'
]);
