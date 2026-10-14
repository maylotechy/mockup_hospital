<?php
function fhirUuid(): string {
    $bytes = random_bytes(16);
    $bytes[6] = chr((ord($bytes[6]) & 15) | 64); $bytes[8] = chr((ord($bytes[8]) & 63) | 128);
    $hex = bin2hex($bytes);
    return substr($hex,0,8).'-'.substr($hex,8,4).'-'.substr($hex,12,4).'-'.substr($hex,16,4).'-'.substr($hex,20);
}
function vitalSignDefinitions(): array {
    return json_decode(file_get_contents(__DIR__.'/../terminology/vital-signs.json'), true, 32, JSON_THROW_ON_ERROR);
}
function fhirMeasurementTime(string $value): string {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $value))
        throw new InvalidArgumentException('Provide the actual vital-sign measurement time with its timezone.');
    $time = new DateTimeImmutable($value);
    $errors = DateTimeImmutable::getLastErrors();
    if (($errors && ($errors['warning_count'] || $errors['error_count'])) || $time->getTimestamp() > time()+300)
        throw new InvalidArgumentException('The vital-sign measurement time is invalid or in the future.');
    return $time->format(DateTimeInterface::ATOM);
}
function fhirVitalValue($value, string $field): float {
    if (!is_numeric($value) || !is_finite((float)$value)) throw new InvalidArgumentException('Vital signs must contain numeric values.');
    $number = (float)$value;
    if (abs(round($number,4)-$number)>0.000000001) throw new InvalidArgumentException('Vital signs support up to four decimal places.');
    if ($number < 0 || $number > 1000000 || ($field === 'vital_o2sat' && $number > 100) ||
        (in_array($field, ['vital_height_cm','vital_weight_kg'], true) && $number <= 0))
        throw new InvalidArgumentException('A vital-sign value is outside the supported range.');
    return $number;
}
function buildVitalObservations(array $values, string $subject, string $encounter, string $time, array $times = [], string $oxygenMethod = 'unknown'): array {
    if (!in_array($oxygenMethod,['unknown','pulse-oximetry'],true)) throw new InvalidArgumentException('Select a valid oxygen measurement method.');
    $definitions = vitalSignDefinitions(); $resources = [];
    $base = static function (string $field) use ($subject,$encounter,$time,$times): array {
        return ['resourceType'=>'Observation','id'=>fhirUuid(),'status'=>'final',
            'category'=>[['coding'=>[['system'=>'http://terminology.hl7.org/CodeSystem/observation-category','code'=>'vital-signs']]]],
            'subject'=>['reference'=>$subject],'encounter'=>['reference'=>$encounter],
            'effectiveDateTime'=>fhirMeasurementTime((string)($times[$field] ?? $time))];
    };
    $quantity = static fn($value,$definition,$field) => ['value'=>fhirVitalValue($value,$field),
        'system'=>'http://unitsofmeasure.org','code'=>$definition['unit'],'unit'=>$definition['unit_display']];
    $bp = trim((string)($values['vital_bp'] ?? ''));
    if ($bp !== '') {
        if (!preg_match('/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/', $bp, $match))
            throw new InvalidArgumentException('Blood pressure requires both systolic and diastolic values.');
        $obs=$base('vital_bp'); $panel=$definitions['blood_pressure'];
        $obs['code']=['coding'=>[['system'=>'http://loinc.org','code'=>$panel['code'],'display'=>$panel['display']]]];
        foreach ($panel['components'] as $index=>$component) $obs['component'][]=[
            'code'=>['coding'=>[['system'=>'http://loinc.org','code'=>$component['code'],'display'=>$component['display']]]],
            'valueQuantity'=>$quantity($match[$index+1],$component,'vital_bp')];
        $resources[]=$obs;
    }
    foreach ($definitions['measurements'] as $field=>$definition) {
        if (!isset($values[$field]) || $values[$field] === '' || $values[$field] === null) continue;
        $obs=$base($field);
        $obs['code']=['coding'=>[['system'=>'http://loinc.org','code'=>$definition['code'],'display'=>$definition['display']]]];
        if ($field==='vital_o2sat' && $oxygenMethod==='pulse-oximetry') $obs['code']['coding'][]=[
            'system'=>'http://loinc.org', 'code'=>$definitions['pulse_oximetry']['code'],'display'=>$definitions['pulse_oximetry']['display']];
        $obs['valueQuantity']=$quantity($values[$field],$definition,$field); $resources[]=$obs;
    }
    return $resources;
}
function buildReferralClinicalBundle(array $payload, array $user, array $values, string $time, array $times=[], string $oxygenMethod='unknown'): array {
    $resources=[]; $urls=[];
    $add=static function(string $key,array $resource) use (&$resources,&$urls): string {
        $resource['id']=$resource['id'] ?? fhirUuid(); $url='urn:uuid:'.$resource['id'];
        $resources[]=['fullUrl'=>$url,'resource'=>$resource,'request'=>['method'=>'POST','url'=>$resource['resourceType']]];
        return $urls[$key]=$url;
    };
    $patient=$add('patient',['resourceType'=>'Patient','identifier'=>[['system'=>'https://irdss.gov.ph/identifier/transfer','value'=>$payload['patient_record']['id']]],'gender'=>$payload['patient_record']['gender']]);
    $org=$add('organization',['resourceType'=>'Organization','name'=>$user['facility']['name'],
        'identifier'=>[['system'=>'https://irdss.gov.ph/identifier/local-facility','value'=>$user['facility']['code']]]]);
    $role=$add('requester',['resourceType'=>'PractitionerRole','identifier'=>[['system'=>'https://irdss.gov.ph/identifier/clinical-account','value'=>(string)$user['id']]],
        'organization'=>['reference'=>$org],'code'=>[['text'=>'Referring clinician']]]);
    $encounter=$add('encounter',['resourceType'=>'Encounter','status'=>'planned',
        'class'=>['system'=>'http://terminology.hl7.org/CodeSystem/v3-NullFlavor','code'=>'UNK'],
        'subject'=>['reference'=>$patient],'serviceProvider'=>['reference'=>$org],
        'reasonCode'=>[array_filter($payload['chief_complaint_concept'], static fn($v) => $v !== null && $v !== [] && $v !== '')]]);
    $diagnosis=array_filter($payload['diagnosis_concept'], static fn($v) => $v !== null && $v !== [] && $v !== '');
    if (!empty($diagnosis['coding']) || trim((string)($diagnosis['text'] ?? '')) !== '') {
        $condition=['resourceType'=>'Condition','subject'=>['reference'=>$patient],'encounter'=>['reference'=>$encounter],
            'clinicalStatus'=>['coding'=>[['system'=>'http://terminology.hl7.org/CodeSystem/condition-clinical','code'=>'active']]],
            'verificationStatus'=>['coding'=>[['system'=>'http://terminology.hl7.org/CodeSystem/condition-ver-status','code'=>'provisional']]],
            'category'=>[['coding'=>[['system'=>'http://terminology.hl7.org/CodeSystem/condition-category','code'=>'encounter-diagnosis']]]], 'code'=>$diagnosis];
        if (!empty($payload['condition_severity'])) $condition['severity']=['coding'=>[$payload['condition_severity']]];
        $add('condition',$condition);
    } elseif (!empty($payload['condition_severity'])) {
        throw new InvalidArgumentException('Enter a working diagnosis before assigning condition severity.');
    }
    $observations=buildVitalObservations($values,$patient,$encounter,$time,$times,$oxygenMethod);
    $support=[]; foreach($observations as $obs) $support[]=['reference'=>$add('observation-'.$obs['id'],$obs)];
    $request=['resourceType'=>'ServiceRequest','status'=>'active','intent'=>'order',
        'priority'=>$payload['referral_priority'] ?? 'routine','subject'=>['reference'=>$patient],
        'encounter'=>['reference'=>$encounter],'requester'=>['reference'=>$role],
        'code'=>['text'=>'Referral for further care'],'reasonCode'=>$payload['reasonCode'],
        'authoredOn'=>(new DateTimeImmutable('now',new DateTimeZone('UTC')))->format(DateTimeInterface::ATOM)];
    if (isset($urls['condition'])) $request['reasonReference']=[['reference'=>$urls['condition']]];
    if ($support) $request['supportingInfo']=$support;
    $add('service-request',$request);
    return ['resourceType'=>'Bundle','type'=>'transaction','entry'=>$resources];
}

function persistLocalClinicalBundle(PDO $pdo,int $localId,array $bundle): void {
    $ids=[];
    $insert=$pdo->prepare('INSERT INTO initiated_referral_observations (initiated_referral_id,fhir_observation_id,loinc_code,display,value_numeric,unit_code,unit_display,measurement_context,observed_at) VALUES (?,?,?,?,?,?,?,?,?)');
    foreach($bundle['entry'] as $entry) {
        $r=$entry['resource']; $ids[$r['resourceType']]=$r['id'];
        if ($r['resourceType']!=='Observation') continue;
        foreach($r['component'] ?? [$r] as $part) {
            $coding=$part['code']['coding'][0]; $q=$part['valueQuantity'];
            $insert->execute([$localId,$r['id'],$coding['code'],$coding['display'] ?? null,$q['value'],$q['code'],$q['unit'] ?? $q['code'],'referral',
                (new DateTimeImmutable($r['effectiveDateTime']))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.u')]);
        }
    }
    $pdo->prepare('UPDATE initiated_referrals SET fhir_condition_id=?,fhir_service_request_id=? WHERE id=?')->execute([$ids['Condition'] ?? null,$ids['ServiceRequest'],$localId]);
}
