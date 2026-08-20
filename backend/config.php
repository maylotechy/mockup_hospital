<?php
// ========================================================
// Configuration, Database Connection & Session Management
// ========================================================

require_once __DIR__ . '/../vendor/autoload.php';

// safeLoad() prevents crashes if the .env file is missing in production
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__ . '/../');
$dotenv->safeLoad(); 

if (session_status() === PHP_SESSION_NONE) {
    session_start();
}

$iolHost = $_ENV['IOL_HOST'] ?? 'localhost'; 
define('IOL_ENDPOINT_URL', 'http://' . $iolHost . ':8081/api/v1/referral/initiate');
define('IOL_AUTH_LOGIN_URL', 'http://' . $iolHost . ':8081/api/auth/login');


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
 * Returns currently logged-in staff user (with nested facility info) or null
 *
 * @return array|null
 */
function getLoggedInUser() {
    if (isset($_SESSION['user']) && is_array($_SESSION['user'])) {
        return $_SESSION['user'];
    }
    return null;
}

/**
 * Sends a 403 JSON response and terminates the script unless the logged-in user's
 * role is in $allowedRoles. Must be called after confirming the user is authenticated.
 *
 * @param string[] $allowedRoles
 */
function requireRole(array $allowedRoles) {
    $user = getLoggedInUser();
    if (!$user || !in_array($user['role'], $allowedRoles, true)) {
        sendJsonResponse([
            'success' => false,
            'message' => 'You do not have permission to perform this action.'
        ], 403);
    }
}

/**
 * Resolves the logged-in user's facility's *current* API key with a live DB read, so a key
 * rotated mid-session (e.g. by the IRDSS admin panel) takes effect on the very next
 * request instead of only after the browser logs out and back in. The session's
 * cached copy is refreshed too, so anything else reading it stays in sync.
 *
 * @return string|null
 */
function getFreshApiKeyForLoggedInFacility() {
    $user = getLoggedInUser();
    if (!$user || empty($user['facility']['id'])) {
        return null;
    }

    try {
        $pdo = getDbConnection();
        $stmt = $pdo->prepare('SELECT api_key FROM facilities WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => $user['facility']['id']]);
        $row = $stmt->fetch();
    } catch (PDOException $e) {
        return $user['facility']['api_key'] ?? null;
    }

    if (!$row || empty($row['api_key'])) {
        return null;
    }

    $_SESSION['user']['facility']['api_key'] = $row['api_key'];
    return $row['api_key'];
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
