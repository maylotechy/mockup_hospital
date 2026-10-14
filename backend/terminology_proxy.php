<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/terminology_service.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Please log in again.'], 401);
}
requireRole(['doctor', 'nurse']);

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$action = trim((string)($_GET['action'] ?? 'search'));
$valueSetKey = trim((string)($_GET['value_set'] ?? ''));
$registry = terminologyRegistry();

if (!isset($registry[$valueSetKey])) {
    sendJsonResponse(['success' => false, 'message' => 'Unsupported terminology field.'], 400);
}

$facilityCode = (string)($user['facility']['code'] ?? '');
$facilityName = (string)($user['facility']['name'] ?? '');

try {
    if ($method === 'GET' && $action === 'search') {
        $query = trim((string)($_GET['q'] ?? ''));
        if (mb_strlen($query) > 100) {
            sendJsonResponse(['success' => false, 'message' => 'Use a shorter diagnosis search (up to 100 characters).'], 400);
        }
        $count = max(1, min((int)($_GET['count'] ?? 20), 50));
        $path = '/api/v1/terminology/valuesets/' . rawurlencode($valueSetKey) .
            '/search?q=' . rawurlencode($query) . '&count=' . $count;
        [$status, $response, $curlErrno] = sendSignedIolRequest(
            'GET',
            $path,
            '',
            $facilityCode,
            $facilityName
        );
        if ($curlErrno === 0 && $status === 200 && is_array($response)) {
            sendJsonResponse($response);
        }
        sendJsonResponse(searchTerminologySnapshot($valueSetKey, $query, $count));
    }

    if ($method === 'POST' && $action === 'validate') {
        $payload = json_decode(file_get_contents('php://input'), true);
        $system = trim((string)($payload['system'] ?? ''));
        $code = trim((string)($payload['code'] ?? ''));
        if ($system === '' || $code === '') {
            sendJsonResponse(['success' => false, 'message' => 'System and code are required.'], 422);
        }
        $requestBody = json_encode([
            'value_set' => $valueSetKey,
            'system' => $system,
            'code' => $code,
        ], JSON_UNESCAPED_SLASHES);
        [$status, $response, $curlErrno] = sendSignedIolRequest(
            'POST',
            '/api/v1/terminology/validate-code',
            $requestBody,
            $facilityCode,
            $facilityName
        );
        if ($curlErrno === 0 && in_array($status, [200, 422], true) && is_array($response)) {
            sendJsonResponse($response, $status);
        }
        $result = validateTerminologySnapshot($valueSetKey, $system, $code);
        sendJsonResponse($result, $result['valid'] ? 200 : 422);
    }

    sendJsonResponse(['success' => false, 'message' => 'Unsupported terminology operation.'], 405);
} catch (InvalidArgumentException $e) {
    sendJsonResponse(['success' => false, 'message' => 'Unsupported terminology field.'], 400);
} catch (Throwable $e) {
    sendJsonResponse([
        'success' => false,
        'message' => 'Terminology service is temporarily unavailable. Continue with free text.'
    ], 503);
}
