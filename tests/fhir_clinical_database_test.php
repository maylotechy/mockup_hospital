<?php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__.'/../backend/config.php';
require_once __DIR__.'/../backend/fhir_clinical.php';
$pdo=getDbConnection(); $patient=$pdo->query('SELECT id,facility_id FROM patients ORDER BY id LIMIT 1')->fetch();
if (!$patient) throw new RuntimeException('A local patient fixture is required.');
$source=file_get_contents(__DIR__.'/../backend/send_referral.php');
preg_match('~INSERT INTO initiated_referrals\s+\(.*?\)\s+VALUES\s+\(.*?\)~s',$source,$match);
preg_match_all('~:[a-z_][a-z0-9_]*~',$match[0],$keys); $params=array_fill_keys($keys[0],null);
$params[':hospital_id']=$patient['facility_id'];$params[':patient_id']=$patient['id'];$params[':status']='AWAITING';$params[':sync_status']='SENT';
$payload=['patient_record'=>['id'=>'tx_'.str_repeat('a',32),'gender'=>'male'],
    'diagnosis_concept'=>['text'=>'Working impression','coding'=>[]], 'chief_complaint_concept'=>['text'=>'Cough for two days'],
    'reasonCode'=>[['text'=>'Service unavailable']], 'referral_priority'=>'urgent'];
$user=['id'=>'test-doctor','facility'=>['name'=>'Synthetic Hospital','code'=>'TEST']];
$vitals=['vital_bp'=>'120/80','vital_hr'=>'72','vital_rr'=>'18','vital_temp_c'=>'36.5','vital_o2sat'=>'98','vital_height_cm'=>'170','vital_weight_kg'=>'65'];
$bundle=buildReferralClinicalBundle($payload,$user,$vitals,gmdate('Y-m-d\TH:i:s\Z'));
$pdo->beginTransaction();
try {
    $pdo->prepare($match[0])->execute($params);$id=(int)$pdo->lastInsertId();
    persistLocalClinicalBundle($pdo,$id,$bundle);
    $read=$pdo->prepare('SELECT fhir_condition_id,fhir_service_request_id FROM initiated_referrals WHERE id=?');$read->execute([$id]);$record=$read->fetch();
    if (!$record['fhir_condition_id'] || !$record['fhir_service_request_id']) throw new RuntimeException('FHIR resource ids did not persist.');
    $read=$pdo->prepare('SELECT * FROM initiated_referral_observations WHERE initiated_referral_id=?');$read->execute([$id]);$rows=$read->fetchAll();
    if (count($rows)!==8) throw new RuntimeException('Seven Observations must persist eight numeric values.');
    foreach($rows as $row) if ($row['measurement_context']!=='referral' || !$row['observed_at'] || !$row['fhir_observation_id'])
        throw new RuntimeException('Observation context/time/id did not persist.');
} finally { $pdo->rollBack(); }
echo "FHIR_CLINICAL_DATABASE_OK (rolled back)\n";
