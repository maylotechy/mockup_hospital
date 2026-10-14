'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const form = html.match(/<form id="patientForm">[\s\S]*?<\/form>/)[0];
const stack = [];
const voidTags = new Set(['input', 'br', 'hr', 'img']);
for (const token of form.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const closing = token[1], tag = token[2].toLowerCase();
    if (voidTags.has(tag)) continue;
    if (closing) assert.equal(stack.pop(), tag, `Unbalanced form tag ${token[0]}`);
    else stack.push(tag);
}
assert.equal(stack.length, 0);
assert.equal((form.match(/class="ref-section"/g) || []).length, 3);
assert.match(form, /patient-one-page referral-one-page/);
const handlers = fs.readFileSync('frontend/js/patients/patient-form.js', 'utf8');
const ids = [...new Set([...handlers.matchAll(/\$\('#(pat\w+)'\)/g)].map(match => match[1]))];
for (const id of ids) assert.equal((form.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
for (const id of ['btnCancelAddPatient', 'btnCancelAddPatient2', 'btnSubmitPatient'])
    assert.match(form, new RegExp(`id="${id}"`));
assert.match(form, /id="patPhilhealthStatus"[^>]*disabled/);
assert.match(form, /id="patPhilhealthNumber"[^>]*disabled/);
console.log(`PATIENT_FORM_LAYOUT_OK (${ids.length} field hooks preserved)`);
