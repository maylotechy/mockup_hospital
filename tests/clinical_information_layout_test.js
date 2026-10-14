'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('frontend/index.html', 'utf8');
const clinical = html.split('<!-- Clinical Information -->')[1].split('<!-- Vital Signs -->')[0];
const stack = [];
for (const token of clinical.matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const tag = token[2].toLowerCase();
    if (['input', 'br', 'hr', 'img'].includes(tag)) continue;
    if (token[1]) assert.equal(stack.pop(), tag, `Unbalanced ${token[0]}`);
    else stack.push(tag);
}
assert.equal(stack.length, 0);
for (const id of ['modalChiefComplaint', 'modalComplaintFinding', 'symptomSuggestions', 'symptomSearchStatus',
    'modalDiagnosis', 'diagnosisSuggestions', 'diagnosisSearchStatus', 'modalSeverity', 'modalReasonCategory',
    'modalReasonSelect', 'modalReasonText', 'enableAdditionalReasons', 'additionalReasonsFields',
    'btnAddAdditionalReason', 'modalIsPwd', 'modalIsPregnant', 'modalIsSeniorCitizen', 'modalHasAllergy',
    'modalAllergyDetails', 'referralAttachments']) {
    assert.equal((clinical.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, id);
}
assert.match(clinical, /class="ref-section ref-clinical-section"/);
assert.match(clinical, /id="modalChiefComplaint"[^>]*required/);
assert.match(clinical, /id="modalReasonSelect"[^>]*disabled/);
assert.match(clinical, /id="modalIsSeniorCitizen"[^>]*disabled/);
const assessment = clinical.split('Working assessment')[1].split('Referral details')[0];
assert.match(assessment, /id="modalDiagnosis"/);
assert.match(assessment, /id="modalConditionSeverity"/);
const routing = clinical.split('Referral details')[1];
assert.match(routing, /id="modalSeverity"/);
assert.match(routing, /id="modalReferralPriority"/);
console.log('CLINICAL_INFORMATION_LAYOUT_OK');
