<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/clinical_urgency.php';
if (!getLoggedInUser()) sendJsonResponse(['message' => 'Please log in again.'], 401);
requireRole(['doctor', 'nurse']);
try { sendJsonResponse(clinicalUrgencyPolicy()); }
catch (Throwable $e) { sendJsonResponse(['message' => 'Clinical urgency options are unavailable.'], 503); }
