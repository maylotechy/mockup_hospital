'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
    constructor() { this.value = ''; this.hidden = true; this.children = []; this.attrs = {}; this.listeners = {}; }
    addEventListener(name, listener) { (this.listeners[name] ||= []).push(listener); }
    setAttribute(name, value) { this.attrs[name] = value; }
    removeAttribute(name) { delete this.attrs[name]; }
    replaceChildren() { this.children = []; }
    append(child) { this.children.push(child); }
    focus() {}
    scrollIntoView() {}
    emit(name, extra = {}) {
        const event = {preventDefault() {}, ...extra};
        (this.listeners[name] || []).forEach(fn => fn(event));
    }
}
const input = new Element(), list = new Element(), status = new Element(), narrative = new Element();
narrative.value = "Severe headache lasting 2 days";
input.form = new Element();
const elements = {modalComplaintFinding: input, symptomSuggestions: list, symptomSearchStatus: status, modalChiefComplaint: narrative};
let timers = [], search = async () => ({concepts: [
    {system: 'http://snomed.info/sct', code: '25064002', display: 'Headache'}], degraded: true});
const window = {IRDSS: {terminology: {search: (...args) => search(...args)}}};
vm.runInNewContext(fs.readFileSync('frontend/js/terminology/symptom-autocomplete.js', 'utf8'), {
    window, document: {getElementById: id => elements[id], createElement: () => new Element()},
    AbortController, setTimeout: fn => {timers.push(fn); return fn;},
    clearTimeout: fn => {timers = timers.filter(t => t !== fn);}
});
async function type(value) {
    input.value = value;
    input.emit('input');
    const callbacks = timers; timers = [];
    callbacks.forEach(fn => fn());
    await new Promise(resolve => setImmediate(resolve));
}

(async () => {
    await type('head');
    assert.equal(list.hidden, false);
    assert.equal(list.children[0].textContent, 'Headache — 25064002');
    input.emit('keydown', {key: 'ArrowDown'});
    assert.equal(input.attrs['aria-activedescendant'], 'symptom-option-0');
    input.emit('keydown', {key: 'Enter'});
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_code, '25064002');
    assert.equal(list.hidden, true);
    await type('Different working impression');
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_code, '');
    window.IRDSS.symptom.set({chief_complaint_code: '25064002', chief_complaint_system: 'http://snomed.info/sct',
        chief_complaint_display: 'Headache', chief_complaint_text: 'Severe headache lasting 2 days'});
    assert.equal(input.value, 'Headache');
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_display, 'Headache');
    input.value = 'Programmatic change';
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_code, '');
    input.form.emit('reset');
    assert.equal(input.value, '');
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_code, '');
    let finish;
    search = () => new Promise(resolve => {finish = resolve;});
    await type('old');
    input.value = 'new'; input.emit('input');
    finish({concepts: [{code: 'obsolete', display: 'Old result'}]});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(list.hidden, true, 'Stale search must not re-open the result list');
    search = async () => {throw new Error('Unavailable');};
    await type('Uncoded illness');
    assert.match(status.textContent, /without a symptom code/);
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_text, narrative.value);
    assert.equal(narrative.value, 'Severe headache lasting 2 days');
    assert.equal(window.IRDSS.symptom.fields().chief_complaint_code, '');
    console.log('SYMPTOM_AUTOCOMPLETE_NARRATIVE_OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
