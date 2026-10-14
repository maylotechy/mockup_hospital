<?php
// CLI only. Generate separate hospital payload keys without replacing existing keys.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../backend/config.php';
require_once __DIR__ . '/../backend/patient_transfer.php';
$pdo = getDbConnection();
$pdo->exec(file_get_contents(__DIR__ . '/../database/upgrade_direct_patient_transfer_20261008.sql'));
$root = transferKeyDirectory();
if (!is_dir($root) && !mkdir($root, 0700, true)) throw new RuntimeException('Cannot create transfer key directory.');
$publicFacilities = [];
$facilities = $pdo->query('SELECT id, code AS facility_code, name AS facility_name FROM facilities')->fetchAll();
foreach ($facilities as $facility) {
    $path = $root . '/facility-' . (int)$facility['id'] . '.key';
    if (!is_file($path)) {
        $handle = fopen($path, 'x');
        if (!$handle) throw new RuntimeException('Cannot provision hospital key.');
        fwrite($handle, base64_encode(sodium_crypto_box_keypair()));
        fclose($handle);
        @chmod($path, 0600);
    }
    $publicFacilities[] = [
        'local_facility_id' => (int)$facility['id'], 'local_code' => $facility['facility_code'],
        'name' => $facility['facility_name'],
        'encryption_public_key' => base64_encode(sodium_crypto_box_publickey(transferLocalKeypair((int)$facility['id']))),
        'signing_public_key' => file_get_contents(__DIR__ . '/../storage/keys/public_key.pem'),
        'endpoint' => 'http://localhost/mock_hospitals/backend/export_patient_transfer.php',
    ];
}
echo json_encode($publicFacilities, JSON_THROW_ON_ERROR);
