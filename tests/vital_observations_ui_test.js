'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const elements=new Map(),handlers=new Map(),document={};
class Field {
    constructor(){this.value='';this.props={};}
    val(value){if(arguments.length){this.value=value;return this;}return this.value;}
    prop(key,value){this.props[key]=value;return this;}
    text(value){this.label=value;return this;}
    on(event,selector,handler){handlers.set(event,{selector,handler});return this;}
}
function $(selector){if(!elements.has(selector))elements.set(selector,new Field());return elements.get(selector);}
const messages=[];const window={jQuery:$,IRDSS:{ui:{showToast:(...args)=>messages.push(args)}}};
vm.runInNewContext(fs.readFileSync('frontend/js/referrals/vital-observations.js','utf8'),{window,document,Date});
const vitals=window.IRDSS.vitals;
vitals.set();$('#modalVitalHr').val('0');assert.equal(vitals.validate(),true);
assert.ok(vitals.fields().vitals_observed_at.endsWith('Z'));
$('#modalVitalBpSystolic').val('120');assert.equal(vitals.validate(),false);$('#modalVitalBpDiastolic').val('80');assert.equal(vitals.validate(),true);
const prior={vital_hr:'72',vital_height_cm:'170',vital_timestamps:{vital_hr:'2026-10-01T12:00:00+08:00',vital_height_cm:'2026-09-30T12:00:00+08:00'}};
vitals.set(prior);$('#modalVitalBpSystolic').val('');$('#modalVitalBpDiastolic').val('');$('#modalVitalHeight').val('170');
assert.equal(vitals.validate(),true);
assert.equal(JSON.parse(vitals.fields().vital_timestamps).vital_height_cm,prior.vital_timestamps.vital_height_cm);
vitals.set({vital_hr:'72'});assert.equal(vitals.validate(),false);
$('#modalVitalsObservedAt').val('2026-10-01T12:00:00');handlers.get('change.vitalObservations').handler();assert.equal(vitals.validate(),true);
const latest=vitals.latest({vital_hr:'60',vital_height_cm:'170',observations:[
    {loinc_code:'8867-4',value:72,observed_at:'2026-10-01T04:00:00Z',fhir_observation_id:'referral',measurement_context:'referral'},
    {loinc_code:'8867-4',value:0,observed_at:'2026-10-01T05:00:00Z',fhir_observation_id:'arrival',measurement_context:'arrival'}]});
assert.equal(latest.vital_hr,'0');assert.equal(latest.vital_timestamps.vital_hr,'2026-10-01T05:00:00Z');
assert.equal(latest.vital_timestamps.vital_height_cm,'');
console.log('VITAL_OBSERVATIONS_UI_OK');
