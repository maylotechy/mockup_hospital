(function (window, $) {
    'use strict';
    const IRDSS=window.IRDSS;
    const fields={vital_bp:['modalVitalBpSystolic','modalVitalBpDiastolic'],vital_hr:['modalVitalHr'],vital_rr:['modalVitalRr'],
        vital_temp_c:['modalVitalTemp'],vital_o2sat:['modalVitalO2sat'],vital_height_cm:['modalVitalHeight'],vital_weight_kg:['modalVitalWeight']};
    const codes={'8480-6':'systolic','8462-4':'diastolic','8867-4':'vital_hr','9279-1':'vital_rr','8310-5':'vital_temp_c','2708-6':'vital_o2sat','8302-2':'vital_height_cm','29463-7':'vital_weight_kg'};
    let timestamps={};
    function localTime(value) {
        const date=new Date(value); if (!Number.isFinite(date.getTime())) return '';
        return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
    }
    function commonTime() {
        const value=$('#modalVitalsObservedAt').val(); if (!value) return '';
        const date=new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }
    function latest(data) {
        const result={vital_timestamps:{}};
        Object.keys(fields).forEach(field=>{result[field]=data[`arrival_${field}`] ?? data[field] ?? ''; if (result[field]!=='') result.vital_timestamps[field]='';});
        const rows=[...(data.observations || [])].sort((a,b)=>new Date(a.observed_at)-new Date(b.observed_at));
        let systolic,diastolic,oxygenId;
        for (const row of rows) {
            if (row.value===null || row.value===undefined) continue;
            const field=codes[row.loinc_code]; if (!field) continue;
            if (field==='systolic') systolic=row;
            else if (field==='diastolic') diastolic=row;
            else {result[field]=String(row.value);result.vital_timestamps[field]=row.observed_at; if (field==='vital_o2sat') oxygenId=row.fhir_observation_id;}
        }
        if (systolic && diastolic && systolic.fhir_observation_id===diastolic.fhir_observation_id) {
            result.vital_bp=`${systolic.value}/${diastolic.value}`;result.vital_timestamps.vital_bp=systolic.observed_at;
        }
        const oxygen=(data.clinical_bundle?.entry || []).find(e=>e.resource?.id===oxygenId)?.resource;
        result.oxygen_method=oxygen?.code?.coding?.some(c=>c.code==='59408-5') ? 'pulse-oximetry' : 'unknown';
        return result;
    }
    function set(data={}) {
        timestamps={...(data.vital_timestamps || {})};
        const previous=Object.keys(fields).some(field=>data[field]!==undefined && data[field]!==null && data[field]!=='');
        if (previous) Object.keys(fields).forEach(field=>{if (data[field]!==undefined && data[field]!==null && data[field]!=='' && !(field in timestamps)) timestamps[field]='';});
        const known=Object.values(timestamps).filter(Boolean).sort((a,b)=>new Date(a)-new Date(b));
        $('#modalVitalsObservedAt').val(known.length ? localTime(known[known.length-1]) : previous ? '' : localTime(new Date())).prop('required',false);
        $('#modalOxygenMethod').val(data.oxygen_method || 'unknown');
        $('#modalVitalsTimeNote').text(previous ? 'Carried-forward readings keep their recorded times. Unknown times must be confirmed; changing this time applies it to all entered readings.' : 'Enter the actual measurement time. Blank vital signs are not sent as Observations.');
    }
    function present(field) {return fields[field].some(id=>String($('#'+id).val() ?? '').trim()!=='');}
    function validate() {
        const bp=fields.vital_bp.map(id=>String($('#'+id).val() ?? '').trim());
        if (bp.some(Boolean) && !bp.every(Boolean)) {IRDSS.ui.showToast('error','Enter both blood pressure values or clear both.',4000);return false;}
        const missing=Object.keys(fields).some(field=>present(field) && !(field in timestamps ? timestamps[field] : commonTime()));
        $('#modalVitalsObservedAt').prop('required',missing);
        if (missing) {IRDSS.ui.showToast('error','Confirm the actual measurement time for the entered vital signs.',4000);return false;}
        return true;
    }
    function collect() {
        const times={};Object.keys(fields).forEach(field=>{if (present(field) && field in timestamps) times[field]=timestamps[field];});
        return {vitals_observed_at:commonTime(),vital_timestamps:JSON.stringify(times),oxygen_method:$('#modalOxygenMethod').val() || 'unknown'};
    }
    $(document).on('change.vitalObservations','#modalVitalsObservedAt',()=>{timestamps={};});
    $(document).on('input.vitalObservations',Object.values(fields).flat().map(id=>'#'+id).join(', '),function(){
        const field=Object.keys(fields).find(key=>fields[key].includes(this.id));if(field) timestamps[field]=commonTime();
    });
    IRDSS.vitals=Object.freeze({set,latest,validate,fields:collect});
})(window,window.jQuery);
