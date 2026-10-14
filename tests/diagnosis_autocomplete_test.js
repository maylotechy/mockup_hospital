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
const input = new Element(), list = new Element(), status = new Element();
input.form = new Element();
const elements = {modalDiagnosis: input, diagnosisSuggestions: list, diagnosisSearchStatus: status};
let timers = [], search = async () => ({concepts: [
    {system: 'http://snomed.info/sct', code: '233604007', display: 'Pneumonia'}], degraded: true});
const window = {IRDSS: {terminology: {search: (...args) => search(...args)}}};
vm.runInNewContext(fs.readFileSync('frontend/js/terminology/diagnosis-autocomplete.js', 'utf8'), {
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
    await type('pneu');
    assert.equal(list.hidden, false);
    assert.equal(list.children[0].textContent, 'Pneumonia — 233604007');
    input.emit('keydown', {key: 'ArrowDown'});
    assert.equal(input.attrs['aria-activedescendant'], 'diagnosis-option-0');
    input.emit('keydown', {key: 'Enter'});
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_code, '233604007');
    assert.equal(list.hidden, true);
    await type('Different working impression');
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_code, '');
    window.IRDSS.diagnosis.set({diagnosis_code: '233604007', diagnosis_system: 'http://snomed.info/sct',
        diagnosis_display: 'Pneumonia', diagnosis_text: 'Possible pneumonia, right lung'});
    assert.equal(input.value, 'Possible pneumonia, right lung');
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_display, 'Pneumonia');
    input.value = 'Programmatic change';
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_code, '');
    input.form.emit('reset');
    assert.equal(input.value, '');
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_code, '');
    let finish;
    search = () => new Promise(resolve => {finish = resolve;});
    await type('old');
    input.value = 'new'; input.emit('input');
    finish({concepts: [{code: 'obsolete', display: 'Old result'}]});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(list.hidden, true, 'Stale search must not re-open the result list');
    search = async () => {throw new Error('Unavailable');};
    await type('Uncoded illness');
    assert.match(status.textContent, /text-only/);
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_text, 'Uncoded illness');
    assert.equal(window.IRDSS.diagnosis.fields().diagnosis_code, '');
    console.log('DIAGNOSIS_AUTOCOMPLETE_OK');
})().catch(error => {console.error(error); process.exitCode = 1;});
