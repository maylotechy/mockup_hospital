<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/patient_transfer.php';
if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
header('Cache-Control: no-store');
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') sendJsonResponse(['detail' => 'POST required.'], 405);
try {
    $input = json_decode(file_get_contents('php://input'), true, 32, JSON_THROW_ON_ERROR);
    $ticket = (string)($input['ticket'] ?? '');
    $claims = verifyPatientTransferTicket($ticket);
    $pdo = getDbConnection();
    $stmt = $pdo->prepare('SELECT o.snapshot_ciphertext, f.code AS facility_code, f.name AS facility_name
        FROM patient_transfer_outbox o JOIN facilities f ON f.id = o.facility_id
        WHERE o.transfer_id = ? AND o.facility_id = ?');
    $stmt->execute([$claims['transfer_id'], $claims['source_local_id']]);
    $record = $stmt->fetch();
    if (!$record) sendJsonResponse(['detail' => 'Patient transfer is unavailable.'], 404);
    [$code, $authorization] = sendSignedIolRequest('POST', '/api/v1/patient-transfer/validate',
        json_encode(['ticket' => $ticket]), $record['facility_code'], $record['facility_name']);
    if ($code !== 200 || ($authorization['status'] ?? '') !== 'authorized') {
        sendJsonResponse(['detail' => 'Patient transfer is not currently authorized.'], 403);
    }
    $identity = json_decode(decryptLocalSensitiveValue($record['snapshot_ciphertext'],
        'transfer-outbox:' . $claims['transfer_id']), true, 64, JSON_THROW_ON_ERROR);
    $package = ['referral_id' => $claims['referral_id'], 'transfer_id' => $claims['transfer_id'],
        'recipient_code' => $claims['recipient_code'], 'identity' => $identity];
    $publicKey = transferDecode($claims['recipient_public_key']);
    if (strlen($publicKey) !== SODIUM_CRYPTO_BOX_PUBLICKEYBYTES) throw new RuntimeException('Invalid receiver key.');
    $ciphertext = base64_encode(sodium_crypto_box_seal(json_encode($package, JSON_THROW_ON_ERROR), $publicKey));
    $signingKey = file_get_contents(__DIR__ . '/../storage/keys/private_key.pem');
    if (!openssl_sign($ticket . "\n" . $ciphertext, $signature, $signingKey, OPENSSL_ALGO_SHA256)) {
        throw new RuntimeException('Unable to sign patient package.');
    }
    sendJsonResponse(['ciphertext' => $ciphertext, 'signature' => base64_encode($signature)]);
} catch (Throwable $e) {
    sendJsonResponse(['detail' => 'Patient transfer failed verification or is unavailable.'], 403);
}
