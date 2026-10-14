'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const elements = new Map(), handlers = new Map(), document = {};
class Field {
    constructor() { this.value = ''; this.props = {}; this.options = []; }
    val(value) { if (arguments.length) {this.value = value; return this;} return this.value; }
    prop(name, value) { if (arguments.length === 2) {this.props[name] = value; return this;} return this.props[name]; }
    is() { return !!this.props.checked; }
    empty() { this.options = []; return this; }
    append(option) { this.options.push(option); return this; }
    text(value) {this.label = value; return this;}
    toggleClass() { return this; }
    on(event, selector, handler) { if (typeof selector === 'string') handlers.set(selector, handler); return this; }
}
function $(selector) { if (!elements.has(selector)) elements.set(selector, new Field()); return elements.get(selector); }
const triage = JSON.parse(fs.readFileSync('terminology/CodeSystem-irdss-triage-acuity.json'));
const condition = JSON.parse(fs.readFileSync('terminology/snapshots/ValueSet-fhir-condition-severity-4.0.1.json'));
const mapping = JSON.parse(fs.readFileSync('terminology/ConceptMap-irdss-triage-to-request-priority.json'));
const policy = {triage_system: triage.url, triage: triage.concept, mapping: Object.fromEntries(mapping.group[0].element.map(e => [e.code, e.target[0].code])),
    priorities: ['routine', 'urgent', 'asap', 'stat'], condition_severity_system: 'http://snomed.info/sct', condition_severity: condition.compose.include[0].concept};
const messages = [];
const window = {jQuery: $, IRDSS: {state: {currentUser: {role: 'doctor'}}, config: {API_BASE: '../backend'}, ui: {showToast: (...args) => messages.push(args)}}};
vm.runInNewContext(fs.readFileSync('frontend/js/terminology/clinical-urgency.js', 'utf8'), {
    window, document, fetch: async () => ({ok: true, json: async () => policy}), Option: function (text, value) {this.text = text; this.value = value;}
});
(async () => {
    const urgency = window.IRDSS.urgency;
    await urgency.set({triage_code: '3'});
    assert.equal(urgency.fields().referral_priority, 'urgent');
    assert.equal($('#modalReferralPriority').prop('disabled'), true);
    await urgency.set({triage_code: '5'});
    assert.equal(urgency.fields().referral_priority, 'stat');
    await urgency.set({triage_code: '1', condition_severity_code: '24484000'});
    assert.equal(urgency.fields().referral_priority, 'routine');
    assert.equal(urgency.fields().condition_severity_code, '24484000');
    $('#modalPriorityOverride').prop('checked', true);
    $('#modalReferralPriority').val('stat');
    urgency.validate();
    assert.equal($('#modalPriorityOverrideReason').prop('required'), true);
    $('#modalPriorityOverrideReason').val('Doctor reassessment');
    assert.equal(urgency.fields().priority_override_reason, 'Doctor reassessment');
    $('#modalPriorityOverride').prop('checked', false);
    urgency.validate();
    assert.equal(urgency.fields().referral_priority, 'routine');
    assert.equal($('#modalPriorityOverrideReason').prop('required'), false);
    assert.equal(urgency.fields().priority_override_reason, '');
    window.IRDSS.state.currentUser.role = 'nurse';
    await urgency.set({triage_code: '3'});
    assert.equal($('#modalSeverity').prop('disabled'), true);
    assert.equal(urgency.validate(), false);
    console.log('CLINICAL_URGENCY_UI_OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
