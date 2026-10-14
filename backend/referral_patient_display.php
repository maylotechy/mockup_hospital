<?php
// Resolve IDs only from this hospital's local records; never expose transfer tokens as patient IDs.
function addReferralPatientDisplayIds(PDO $pdo, int $facilityId, array $referrals): array {
    $query = $pdo->prepare('SELECT referral_id, patient_id FROM initiated_referrals WHERE hospital_id = ?');
    $query->execute([$facilityId]);
    $byReferral = array_column($query->fetchAll(PDO::FETCH_ASSOC), 'patient_id', 'referral_id');
    $query = $pdo->prepare('SELECT transfer_id, patient_id FROM patient_transfer_outbox WHERE facility_id = ?');
    $query->execute([$facilityId]);
    $byTransfer = array_column($query->fetchAll(PDO::FETCH_ASSOC), 'patient_id', 'transfer_id');
    foreach ($referrals as &$referral) {
        $localId = $byReferral[$referral['referral_id'] ?? ''] ?? $byTransfer[$referral['patient_id'] ?? ''] ?? null;
        $referral['patient_display_id'] = $localId !== null
            ? '#' . str_pad((string)$localId, 5, '0', STR_PAD_LEFT)
            : (str_starts_with((string)($referral['patient_id'] ?? ''), 'tx_') ? 'Unavailable' : ($referral['patient_id'] ?? 'Unavailable'));
    }
    unset($referral);
    return $referrals;
}

function addReceivingPatientDisplayIds(PDO $pdo, int $facilityId, array $referrals): array {
    $query = $pdo->prepare('SELECT source_referral_id, id FROM patients WHERE facility_id = ? AND source_referral_id IS NOT NULL');
    $query->execute([$facilityId]);
    $byReferral = array_column($query->fetchAll(PDO::FETCH_ASSOC), 'id', 'source_referral_id');
    foreach ($referrals as &$referral) {
        $localId = $byReferral[$referral['referral_id'] ?? ''] ?? null;
        $referral['patient_display_id'] = $localId !== null
            ? '#' . str_pad((string)$localId, 5, '0', STR_PAD_LEFT)
            : (str_starts_with((string)($referral['patient_id'] ?? ''), 'tx_')
                ? 'Not registered yet' : ($referral['patient_id'] ?? 'Not registered yet'));
    }
    unset($referral);
    return $referrals;
}
