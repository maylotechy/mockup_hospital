<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../backend/config.php';
require_once __DIR__ . '/../backend/patient_transfer.php';
require_once __DIR__ . '/../backend/fhir_clinical.php';
$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
try {
    if ($input['action'] === 'build-clinical') {
        echo json_encode(buildReferralClinicalBundle($input['payload'],$input['user'],$input['vitals'] ?? [],
            $input['observed_at'] ?? '',$input['timestamps'] ?? [],$input['oxygen_method'] ?? 'unknown'), JSON_THROW_ON_ERROR);
    } elseif ($input['action'] === 'prepare') {
        [$payload, $id] = prepareDirectPatientTransfer(getDbConnection(), $input['patient'],
            $input['payload'], $input['full_name']);
        echo json_encode(['payload' => $payload, 'transfer_id' => $id], JSON_THROW_ON_ERROR);
    } elseif ($input['action'] === 'fetch') {
        echo json_encode(decryptDirectPatientDetails($input['details'],
            ['facility' => ['id' => $input['facility_id']]]), JSON_THROW_ON_ERROR);
    } elseif ($input['action'] === 'cleanup') {
        $stmt = getDbConnection()->prepare('DELETE FROM patient_transfer_outbox WHERE transfer_id = ?');
        $stmt->execute([$input['transfer_id']]);
        echo json_encode(['deleted' => $stmt->rowCount()]);
    } elseif ($input['action'] === 'verify') {
        echo json_encode(verifyPatientTransferTicket($input['ticket']), JSON_THROW_ON_ERROR);
    } else {
        throw new RuntimeException('Invalid test action.');
    }
} catch (Throwable $e) {
    echo json_encode(['error' => $e->getMessage()]);
    exit(1);
}
