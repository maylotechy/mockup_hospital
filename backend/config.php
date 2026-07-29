<?php
// ========================================================
// Configuration, Database Connection & Session Management
// ========================================================

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

define('IOL_ENDPOINT_URL', 'http://127.0.0.1:8000/api/v1/referral/initiate');

define('DB_HOST', 'localhost');
define('DB_NAME', 'hospital_db');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_CHARSET', 'utf8mb4');

/**
 * Returns PDO Database Instance
 * 
 * @return PDO
 */
function getDbConnection() {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = sprintf('mysql:host=%s;dbname=%s;charset=%s', DB_HOST, DB_NAME, DB_CHARSET);
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);
        } catch (PDOException $e) {
            sendJsonResponse([
                'success' => false,
                'message' => 'Database connection failed: ' . $e->getMessage()
            ], 500);
        }
    }
    return $pdo;
}

/**
 * Returns currently logged-in hospital info array or null
 * 
 * @return array|null
 */
function getLoggedInHospital() {
    if (isset($_SESSION['hospital']) && is_array($_SESSION['hospital'])) {
        return $_SESSION['hospital'];
    }
    return null;
}

// Handle preflight CORS requests with credentials support
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';

if (isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');
    http_response_code(200);
    exit;
}

/**
 * Send JSON Response and terminate script
 * 
 * @param array $data
 * @param int $statusCode
 */
function sendJsonResponse($data, $statusCode = 200) {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
    http_response_code($statusCode);
    header("Access-Control-Allow-Origin: {$origin}");
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type, X-API-Key, Authorization');
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit;
}
