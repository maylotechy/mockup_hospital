<?php
require_once __DIR__ . '/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse(['success' => false, 'message' => 'POST required.'], 405);
}
$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized.'], 401);
}
requireRole(['doctor', 'nurse']);

$referralId = trim((string)($_POST['referral_id'] ?? ''));
$workflowStage = strtoupper(trim((string)($_POST['workflow_stage'] ?? '')));
$attachmentType = strtoupper(trim((string)($_POST['attachment_type'] ?? '')));
if ($referralId === '' || !isset($_FILES['attachment'])) {
    sendJsonResponse(['success' => false, 'message' => 'Referral and attachment are required.'], 400);
}
$file = $_FILES['attachment'];
if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
    sendJsonResponse(['success' => false, 'message' => 'File upload failed.'], 422);
}
if (($file['size'] ?? 0) > 5 * 1024 * 1024) {
    sendJsonResponse(['success' => false, 'message' => 'File exceeds the 5 MB limit.'], 413);
}

$bytes = file_get_contents($file['tmp_name']);
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: 'application/octet-stream';
$headers = [
    'X-Workflow-Stage: ' . $workflowStage,
    'X-Attachment-Type: ' . $attachmentType,
    'X-Original-Filename: ' . rawurlencode(basename((string)$file['name'])),
];
[$httpCode, $response, $curlErrno] = sendSignedIolBinaryRequest(
    'POST',
    "/api/v1/referral/{$referralId}/attachments",
    $bytes,
    $mime,
    $user['facility']['code'],
    $user['facility']['name'],
    $headers
);
if ($curlErrno) {
    sendJsonResponse(['success' => false, 'message' => 'Failed to reach IOL server.'], 503);
}
$decoded = json_decode((string)$response, true);
sendRawJsonResponse($decoded !== null ? $decoded : ['success' => false, 'message' => (string)$response], $httpCode);
