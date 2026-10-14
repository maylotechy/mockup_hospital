# IRDSS Development Report

Date: October 12, 2026

## End-of-day summary

- Added optional SNOMED symptom search while keeping the chief complaint as free text.
- Updated referral storage and displays to retain symptom codes and clinical notes, including onward referrals.
- Redesigned Add Patient to match the referral form's single-panel layout and responsive styling.
- Reorganized Clinical Information into clearer groups for patient presentation, assessment, referral details and supporting information.
- Separated triage acuity, referral priority and condition severity into distinct fields.
- Added suggested referral priorities, clinician overrides with a required reason, and receiving-doctor reassessment with audit history.
- Added emergency recommendation ordering for triage level 5 that bypasses AI scoring while keeping facility eligibility checks and clinician confirmation.
- Tested validation, database storage, secure patient transfer and form behavior; removed or rolled back synthetic test records.
- Updated the clinical data refactor plan and supporting documentation.

## 1. Chief complaint and symptom search improvements

The chief complaint remains a required, patient-specific clinical note. It now supports multiline text of up to 2,000 characters. A separate optional search field lets the clinician choose a SNOMED-coded symptom from the controlled prototype ValueSet.

For example, a clinician can write “Severe headache lasting two days” and select Headache, code `25064002`. Selecting the symptom does not replace the clinical note. Editing or clearing the symptom search clears its previous code without changing the note.

PHP and IoL independently validate selected codes and resolve their display labels. MySQL and PostgreSQL store the terminology system, code, display and narrative separately. The full narrative is retained in `chief_complaint_text`; the old local field remains a shortened compatibility copy.

Referral previews, receiving hospital details, sender tracking and onward referrals retain these values. Consent documents continue using readable clinical text. The prototype still uses the controlled eight-symptom list, not unrestricted SNOMED search.

## 2. Form layout improvements

Add Patient was restyled to match the referral form: one main panel, section separator lines, Outfit typography and responsive fields. Existing field IDs, required fields, membership controls and save behavior were retained.

Clinical Information was reorganized into these groups:

- Patient presentation: chief complaint and optional coded symptom.
- Working assessment: diagnosis and optional condition severity.
- Referral details: triage acuity, referral priority, category and reasons.
- Supporting information: priority groups and clinical attachments.

The wide left-side gap was removed, helper text was reduced, and the groups stack on smaller screens.

## 3. Separate clinical urgency fields

The previous severity input was clarified and separated into three concepts:

| Field | Purpose |
| --- | --- |
| Triage acuity | How urgently the patient needs clinical attention; assigned by a doctor. |
| Referral priority | How quickly the referral should be handled. |
| Condition severity | How severe the diagnosed condition is; optional and separate from routing urgency. |

The versioned IRDSS prototype mapping suggests these priorities:

| Triage level | Label | Suggested priority |
| --- | --- | --- |
| 1 | Mild | Routine |
| 2 | Moderate | Routine |
| 3 | Severe | Urgent |
| 4 | Critical | ASAP |
| 5 | Extreme | STAT |

Clinicians can override the suggested priority, but a changed priority requires a reason. Condition severity does not automatically change triage, priority or hospital eligibility. Legacy severity fields remain populated from triage for compatibility with existing routing and analytics.

Triage levels 3–5 and severe condition coding flag immediate notifications. The new coded triage workflow requires a doctor account in the Mock Hospital platform. Older signed severity-only requests remain supported as legacy-system assignments.

## 4. Receiving-doctor reassessment and audit history

The selected receiving hospital's doctor can reassess an open referral's triage, priority and condition severity. A reassessment reason is required. The new values are available in referral details and can be carried into an onward referral.

An additive PostgreSQL migration, `e6a1c8f2b9d0`, created `referral_urgency_audits`. Audit entries retain previous and new values, the facility, actor account and role, timestamp and reason. Initial assignments and priority overrides are also recorded.

Reassessment does not automatically redirect or rebroadcast a finalized referral. IoL currently trusts the clinical actor asserted by the authenticated signing hospital; the PHP platform enforces the logged-in doctor role. Central per-user authentication remains separate future work.

## 5. Emergency recommendation ordering

For triage level 5, recommendations bypass ordinary AI/FCM scoring. Accepted facilities are checked again for eligibility and required capabilities, then ordered deterministically by capability count, geographic distance, available beds and stable facility ID. Candidates with missing coordinates are excluded from this emergency ordering.

The UI identifies this as emergency routing with AI bypassed, rather than displaying an AI match percentage. The sending clinician still confirms the destination after facility acceptance.

This is a prototype ordering method. Autonomous dispatch, comprehensive transfer-safety assessment and production clinical validation were not implemented today.

## 6. Verification and service status

Completed checks covered:

- Terminology, diagnosis, symptom and urgency validation.
- Priority mapping, override reasons and doctor-role restrictions.
- Condition severity remaining independent of triage.
- Emergency AI bypass and exclusion of ineligible candidates.
- Frontend autocomplete, narrative preservation, priority controls and form layout hooks.
- MySQL write/read round-trips, including longer clinical notes.
- Signed HTTP referral creation and receiving reassessment with PostgreSQL audit assertions.
- Direct encrypted patient transfer and the existing local identity-encryption regression.

Targeted checks passed. Synthetic referral/transfer fixtures were removed, and transactional MySQL test writes were rolled back. Existing patient records were retained. IoL was restarted with the updated code, and frontend asset versions were updated to avoid stale browser scripts.

No commits were pushed as part of today's work. Full browser-based clinical review and the broader pytest-based regression suite were not completed in this work session.

## 7. Current progress and next work

The prototype now supports coded diagnoses and symptoms, separate clinical urgency fields, and audited reassessment. The next task is to represent diagnoses and referral requests as linked FHIR Condition and ServiceRequest records. The current format is still transitional and does not yet implement a complete PH Core/eReferral transaction Bundle.

Later work will standardize vital-sign records using LOINC measurement codes and UCUM units, validate and save referral Bundles, and test compatibility before removing older formats. Broader Ontoserver diagnosis search beyond the current ten-concept list also remains planned.

Supporting references:

- [Clinical data refactor plan](../plans/FHIR_CLINICAL_DATA_REFACTOR_PLAN.md)
- [Diagnosis and symptom search notes](FHIR_DIAGNOSIS_PHASE_4.md)
- [Clinical urgency notes](FHIR_URGENCY_PHASE_6.md)
