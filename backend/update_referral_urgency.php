<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/clinical_urgency.php';
$user = getLoggedInUser();
if (!$user) sendJsonResponse(['message' => 'Please log in again.'], 401);
requireRole(['doctor']);
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'PATCH') sendJsonResponse(['message' => 'PATCH required.'], 405);
try {
    $input = json_decode(file_get_contents('php://input'), true, 32, JSON_THROW_ON_ERROR);
    $id = (string)($input['referral_id'] ?? '');
    $reason = trim((string)($input['reason'] ?? ''));
    if (!preg_match('/^ref_[A-Za-z0-9_-]+$/', $id) || $reason === '' || mb_strlen($reason) > 500)
        throw new InvalidArgumentException('Provide the referral and a reassessment reason (up to 500 characters).');
    $values = resolveClinicalUrgency($input);
    $payload = urgencyRoutingFields($values, $user);
    $payload['reason'] = $reason;
    [$status, $response] = sendSignedIolRequest('PATCH', '/api/v1/referral/' . rawurlencode($id) . '/clinical-urgency',
        json_encode($payload), $user['facility']['code'], $user['facility']['name']);
    if ($status !== 200) sendJsonResponse(['message' => in_array($status, [403, 409]) ? 'Only the selected receiving hospital can reassess an open referral.' : 'Unable to save the reassessment. Check the values and try again.'], $status ?: 503);
    logAuditEvent($user, 'CLINICAL_URGENCY_REASSESSED', $id, null, json_encode(['reason' => $reason, 'values' => $values]));
    sendJsonResponse($response);
} catch (InvalidArgumentException $e) { sendJsonResponse(['message' => $e->getMessage()], 422); }
catch (Throwable $e) { sendJsonResponse(['message' => 'Unable to save the clinical reassessment.'], 503); }
