<?php
require_once __DIR__ . '/config.php';

$user = getLoggedInUser();
if (!$user) {
    sendJsonResponse(['success' => false, 'message' => 'Unauthorized.'], 401);
}

$referralId = trim((string)($_GET['referral_id'] ?? ''));
$attachmentId = trim((string)($_GET['attachment_id'] ?? ''));
if ($referralId === '' || $attachmentId === '') {
    sendJsonResponse(['success' => false, 'message' => 'Missing attachment identifiers.'], 400);
}

[$listCode, $listResponse] = sendSignedIolRequest(
    'GET',
    "/api/v1/referral/{$referralId}/attachments",
    '',
    $user['facility']['code'],
    $user['facility']['name']
);
$items = is_array($listResponse) ? $listResponse : json_decode((string)$listResponse, true);
$metadata = null;
foreach (is_array($items) ? $items : [] as $item) {
    if (($item['id'] ?? '') === $attachmentId) {
        $metadata = $item;
        break;
    }
}
if ($listCode < 200 || $listCode >= 300 || !$metadata) {
    sendJsonResponse(['success' => false, 'message' => 'Attachment not found or access denied.'], $listCode ?: 404);
}

[$httpCode, $bytes, $curlErrno] = sendSignedIolBinaryRequest(
    'GET',
    "/api/v1/referral/{$referralId}/attachments/{$attachmentId}",
    '',
    'application/octet-stream',
    $user['facility']['code'],
    $user['facility']['name']
);
if ($curlErrno || $httpCode < 200 || $httpCode >= 300) {
    sendJsonResponse(['success' => false, 'message' => 'Could not download attachment.'], $curlErrno ? 503 : $httpCode);
}

$filename = preg_replace('/[^A-Za-z0-9._ -]/', '_', (string)($metadata['original_filename'] ?? 'attachment'));
$previewRequested = isset($_GET['preview']) && $_GET['preview'] === '1';
$mimeType = (string)($metadata['mime_type'] ?? 'application/octet-stream');
$previewableTypes = ['application/pdf', 'image/jpeg', 'image/png'];
$disposition = $previewRequested && in_array($mimeType, $previewableTypes, true) ? 'inline' : 'attachment';
header('Content-Type: ' . $mimeType);
header('Content-Length: ' . strlen($bytes));
header('Content-Disposition: ' . $disposition . '; filename="' . addcslashes($filename, '"\\') . '"');
header('X-Content-Type-Options: nosniff');
echo $bytes;
