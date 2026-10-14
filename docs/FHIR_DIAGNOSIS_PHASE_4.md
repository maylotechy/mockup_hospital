# Phase 4: Coded diagnosis in the referral prototype

## Phase 5 addition (October 12, 2026)

Chief Complaint now has a required multiline narrative plus a separate optional **Coded symptom** search. Type `head` and select **Headache — 25064002**, or type `chest` and select **Chest pain — 29857009**. Your narrative must remain unchanged when selecting, editing or clearing a symptom. It is still the text used by printed/electronic consent and clinical matching.

The prototype searches the eight findings in the versioned chief-complaint ValueSet. PHP and IoL validate the code independently. Full narrative and coding are retained in both databases, receiver details and onward referrals. The broader Ontoserver diagnosis follow-up remains planned; this does not search all SNOMED CT concepts.

Add Patient now uses the referral form's single-panel layout, section separators and responsive styling. Patient fields, membership toggles, required states and save behavior are retained.

Additional checks: `node tests/symptom_autocomplete_test.js`, `node tests/patient_form_layout_test.js`, and central `python -m unittest tests.test_clinical_complaint -v`. Existing database and direct-transfer tests also cover the symptom fields.

## How to test

1. Restart the central IoL Python service if it is not running with auto-reload, then hard-refresh the Mock Hospital page.
2. Open Patient Records and click Refer.
3. Type `pneu` into Diagnosis. Select **Pneumonia — 233604007** (keyboard: Arrow Down, Enter).
4. Check the SNOMED code under the field and in Review Referral, then submit with the remaining required fields and consent completed.
5. The sender's Track Referral and the receiver's referral details show the wording and code. After arrival/import, Refer to Another Facility prefills the same diagnosis and coding.
6. Edit the selected diagnosis text: the old code is cleared. The new wording remains a valid text-only diagnosis unless another result is selected.
7. Leave diagnosis blank: it stays absent. The referral reason must not become the diagnosis.

Autocomplete requires at least two characters. The prototype uses the ten concepts in `terminology/ValueSet-irdss-referral-diagnosis.json`, version `0.1.0`, not all of SNOMED CT. If Ontoserver does not host this local draft ValueSet, the versioned controlled list is used. If search itself fails, free-text diagnosis still works.

## Contract and compatibility

- Browser submits `diagnosis_system`, `diagnosis_code`, `diagnosis_display` and `diagnosis_text` to PHP. The original `diagnosis` field remains for older clients.
- PHP validates against the controlled versioned list and replaces any client-supplied display with the canonical label. IoL independently validates the system/code before storing a referral.
- The current routing payload carries a `diagnosis_concept` with `coding` and `text`. Existing clients may continue using the legacy diagnosis extension; no code is inferred from its text.
- `diagnosis_text` stores the full narrative (up to 2,000 characters). Local `diagnosis` is a truncated compatibility copy because its existing column allows 255 characters.
- PostgreSQL and MySQL use separate system/code/display/text columns. A code implies **selected**; text without a code is **text-only**; neither is **absent**. No automatic mapping is performed.
- Prototype capability rules recognize stroke, myocardial infarction, appendicitis and pre-eclampsia codes, while existing text-based capability checks continue. These rules require clinical review before production; they do not determine treatment.
- This phase does not yet construct `Condition` resources or switch submission to a complete FHIR transaction Bundle. That is later work.
- Personal identity remains in encrypted hospital storage and the authorized direct-transfer package. Diagnosis changes do not reintroduce the central patient identity vault.

## Verification commands

From the Mock Hospital project:

```powershell
node tests/diagnosis_autocomplete_test.js
& 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe' tests/terminology_service_test.php
& 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe' tests/diagnosis_database_test.php
& 'C:\laragon\bin\php\php-8.3.30-Win32-vs16-x64\php.exe' tests/local_encrypted_database_test.php
```

From the central IoL project:

```powershell
C:\IRDSS\.venv\Scripts\python.exe -m unittest tests.test_terminology_service tests.test_clinical_diagnosis -v
$env:IRDSS_TEST_IN_PROCESS = '1'
C:\IRDSS\.venv\Scripts\python.exe -m unittest tests.test_direct_patient_transfer tests.test_diagnosis_persistence -v
Remove-Item Env:IRDSS_TEST_IN_PROCESS
```

The integration checks require configured local MySQL/PostgreSQL, hospital transfer keys, and the existing local hospital export/authorization endpoints. They create synthetic referrals and clean those fixtures up; they do not clear existing patient records. Frontend tests use a lightweight DOM harness rather than an actual browser session.
