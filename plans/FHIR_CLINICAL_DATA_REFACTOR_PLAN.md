# FHIR Clinical Data and Terminology Refactor Plan

[All project plans](README.md)

## Objective

Refactor IRDSS clinical referral data to use FHIR R4 structures and standard terminology while preserving the current Mock Hospital workflow, intelligent facility-matching engine, consent features, referral history, and compatibility with existing payloads during migration.

This plan focuses on:

- SNOMED CT-coded diagnoses and symptoms
- Free-text clinical context where coding alone is insufficient
- Separate triage acuity, referral priority, and condition severity
- FHIR `Condition`, `ServiceRequest`, and `Observation` resources
- LOINC observation codes and UCUM measurement units
- Terminology lookup and validation through approved ValueSets
- Additive PostgreSQL and MySQL schema changes
- A controlled transition away from the current custom extensions

It complements the broader `plan.md` FHIR migration plan. Authentication migration and removal of the `api_keys` table are separate work and must be completed only after all API-key consumers have moved to signed system authentication.

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1: Clinical contract and approved ValueSets | Complete for prototype | Terminology snapshots, clinical mappings, prototype triage artifacts, and the canonical Bundle are present and locally validated. Formal profile validation and stakeholder approval are deferred until production preparation. |
| Phase 2: Additive database schema | Complete for prototype | Added nullable coded clinical fields, FHIR identifiers, and normalized observation tables to Mock Hospital MySQL and central IRDSS PostgreSQL while retaining all legacy columns and rows. |
| Phase 3: Terminology service foundation | Complete for prototype | Authenticated search, expansion, lookup and validation; version-aware bounded caching, one transient retry, controlled snapshot fallback, and malformed-response handling are tested. |
| Phase 4: SNOMED-coded diagnosis | Complete for prototype | Searchable diagnosis with text fallback; independent PHP/IoL validation; separate coding/text persistence; sender/receiver displays and onward prefill; prototype code-based capability rules. |
| Phase 5: Chief complaint text and symptom coding | Complete for prototype | Separate required narrative and optional searchable SNOMED finding; independent backend validation, MySQL/PostgreSQL coding persistence, receiver display and onward prefill. |
| Phase 6: Separate clinical urgency concepts | Complete for prototype | Doctor-assigned coded triage, mapped/overridable FHIR priority, optional SNOMED condition severity, additive audit history, receiving reassessment and deterministic emergency recommendation ordering. |
| Phase 7: FHIR Condition and ServiceRequest | Complete (prototype) | Linked clinical resources, resolved UUID references, authenticated retrieval and urgency synchronization. |
| Phase 8: FHIR vital-sign Observations | Complete (prototype) | Seven measurement types with LOINC/UCUM, timestamps, normalized persistence and separate arrival history. |
| Phase 9: Bundle validation and persistence | Not started | Validate terminology and references, map resources to PostgreSQL, and return OperationOutcome errors. |
| Phase 10: Compatibility, cutover, and cleanup | Not started | Dual-read/dual-write, migrate historical data, monitor clients, then retire legacy fields. |

## Current Baseline

The current referral implementation sends several clinical values through custom extensions:

- Diagnosis as a free-text `diagnosis` extension
- Chief complaint as a free-text `chiefComplaint` extension
- Severity as a numeric `severity` extension
- Vital signs as individual custom decimal or string extensions
- Referral reason through `ServiceRequest.reasonCode`

PostgreSQL currently stores diagnosis, chief complaint, severity, and vital signs as flat columns. The routing engine uses numeric severity and free-text diagnosis or complaint matching to derive required facility capabilities.

These fields must remain operational until the new FHIR resources are verified end to end.

## Target Clinical Model

| Clinical information | FHIR representation | Terminology |
| --- | --- | --- |
| Working diagnosis | `Condition.code` | SNOMED CT plus `CodeableConcept.text` fallback |
| Condition severity | `Condition.severity` | Approved condition-severity ValueSet |
| Chief complaint | Narrative text plus optional coded finding | SNOMED CT symptom/clinical-finding ValueSet |
| Referral reason | `ServiceRequest.reasonCode` or `reasonReference` | Approved referral-reason ValueSet and/or reference to `Condition` |
| Referral urgency | `ServiceRequest.priority` | FHIR RequestPriority: `routine`, `urgent`, `asap`, `stat` |
| Triage acuity | Approved extension or profile element | Clinically approved local/national ValueSet |
| Blood pressure | FHIR `Observation` with components | LOINC and UCUM `mm[Hg]` |
| Heart rate | FHIR `Observation` | LOINC and UCUM `/min` or approved equivalent |
| Respiratory rate | FHIR `Observation` | LOINC and UCUM `/min` or approved equivalent |
| Temperature | FHIR `Observation` | LOINC and UCUM `Cel` |
| Oxygen saturation | FHIR `Observation` | LOINC and UCUM `%` |
| Height | FHIR `Observation` | LOINC and UCUM `cm` |
| Weight | FHIR `Observation` | LOINC and UCUM `kg` |

## Data Design Rules

Every coded clinical value must retain these parts separately:

```text
system  - canonical CodeSystem URL
code    - machine-readable concept code
display - official human-readable label
text    - clinician-entered or source-system wording
```

Additional rules:

- Do not store only a display label.
- Do not infer a code from free text without showing or recording that it was machine-derived.
- Do not force a clinician to select an inaccurate code when no suitable concept exists.
- Preserve the original free text for clinical meaning and auditability.
- The backend must validate codes; frontend dropdown validation is not sufficient.
- Use constrained ValueSets for UI search rather than exposing all SNOMED CT concepts.
- Store stable facility and resource identifiers; names remain display values only.

## Refactoring Phases

### Phase 1: Define the Clinical Contract and ValueSets

Status: Complete for the IRDSS mock-up. Formal profile validation and stakeholder sign-off are production-readiness activities and do not block Phase 2.

The draft clinical contract is documented in `docs/FHIR_CLINICAL_CONTRACT.md`. IRDSS-controlled diagnosis and chief-complaint ValueSets are versioned under `terminology/`. The current fields, Connectathon resource patterns, proposed LOINC/UCUM mappings, fallback rules, and validation ownership are complete. Referral category/reason ValueSets, the target triage scale, and the priority mapping remain pending clinical and DOH/PeRef confirmation.

Document and approve:

- Diagnosis ValueSet
- Chief-complaint symptom ValueSet
- Referral-reason ValueSet
- Condition-severity ValueSet
- Triage-acuity scale and direction
- Referral-priority mapping
- LOINC codes for every supported vital sign
- UCUM unit for every numeric measurement
- Required and optional FHIR fields
- Behavior when a code cannot be found

Create one field-mapping document covering the Mock Hospital form, PHP payload, FHIR resource, PostgreSQL column, and receiving display.

Do not copy the full SNOMED CT terminology into the application database. Select or request approved ValueSets and access them through the designated terminology server.

Acceptance criteria:

- Clinical reviewers agree on the triage scale and its direction.
- Each coded field has an approved CodeSystem and ValueSet URL.
- Each vital sign has an approved LOINC code and UCUM unit.
- Free-text fallback behavior is documented.
- A canonical referral example is approved before implementation begins.

### Phase 2: Add the Database Foundation

Status: Complete for the IRDSS mock-up. The additive MySQL and PostgreSQL migrations were applied on October 7, 2026 after isolated upgrade testing. The PostgreSQL Alembic upgrade and downgrade were verified on a disposable database, and row counts were unchanged when the upgrades were applied locally.

Implemented artifacts:

- Mock Hospital schema: `database/schema.sql`
- Mock Hospital upgrade: `database/upgrade_fhir_clinical_coding_20261007.sql`
- Central IRDSS model: `app/models/referral_model.py`
- Central IRDSS Alembic revision: `c4e8b1d7a2f6_add_fhir_clinical_coding_foundation.py`
- Normalized local table: `initiated_referral_observations`
- Normalized central table: `referral_observations`

The new coding fields are nullable and the existing `diagnosis`, `chief_complaint`, `disease_severity`, and vital-sign columns remain available. Populating and reading the new fields begins in later phases.

Verification record:

- PostgreSQL Alembic upgraded from `a9d2e6f4c8b1` to `c4e8b1d7a2f6` and downgraded successfully on a disposable database.
- The MySQL upgrade completed successfully on an isolated database containing the legacy referral columns.
- Applying the local upgrades preserved all existing rows: 38 central referrals and 59 Mock Hospital initiated referrals before and after migration.
- Legacy ORM and MySQL reads succeeded with the new nullable coding fields left empty.

Use additive migrations in both databases.

Suggested PostgreSQL fields or related clinical tables:

- `diagnosis_system`
- `diagnosis_code`
- `diagnosis_display`
- `diagnosis_text`
- `chief_complaint_text`
- `chief_complaint_system`
- `chief_complaint_code`
- `chief_complaint_display`
- `triage_system`
- `triage_code`
- `triage_display`
- `referral_priority`
- `condition_severity_system`
- `condition_severity_code`
- `condition_severity_display`
- `fhir_condition_id`
- `fhir_service_request_id`

Prefer a related observation table for vitals rather than continuing to add columns for every measurement:

```text
referral_observations
- id
- referral_id
- fhir_observation_id
- loinc_code
- display
- value_numeric
- unit_code
- unit_display
- observed_at
```

Retain the existing diagnosis, chief complaint, disease severity, and vital columns during compatibility phases.

Acceptance criteria:

- Alembic upgrade and downgrade work on a test database.
- Existing referrals remain readable without modification.
- New coded fields accept null values for legacy records.
- Foreign keys and indexes support referral detail and matching queries.
- No existing clinical or consent data is deleted.

### Phase 3: Build the Terminology Service Foundation

Status: Complete for prototype on October 9, 2026. Browser requests go through authenticated PHP and the signed IoL terminology API. Only the versioned, explicitly listed local ValueSet concepts are selectable. The terminology server does not need to host these draft local ValueSets: a missing definition or temporary failure uses the controlled snapshot. No diagnosis is silently assigned when search fails.

Create a central IRDSS terminology service layer responsible for:

- `ValueSet/$expand`
- Code lookup and display resolution
- `$validate-code`
- Search filtering
- Short-lived server-side caching
- Timeout, retry, and unavailable-service behavior

The browser should call the Mock Hospital backend, and the backend should call the terminology server. Do not make the browser responsible for credentials or trust decisions.

Recommended frontend module:

```text
frontend/js/terminology/clinical-terminology.js
```

Recommended central service:

```text
app/services/terminology_service.py
```

Acceptance criteria:

- Diagnosis and symptom searches return only concepts from the configured ValueSet.
- Results expose `system`, `code`, and `display`.
- Backend validation rejects a code outside the configured ValueSet.
- Cached results are version-aware.
- The referral form remains usable with free text if Ontoserver is temporarily unavailable.

### Phase 4: Introduce SNOMED-Coded Diagnosis

Status: Complete for prototype on October 9, 2026. Diagnosis autocomplete supports debounced search, keyboard selection, stale-request cancellation and text-only entry. PHP and IoL independently validate codes and resolve the canonical display. PostgreSQL and MySQL retain `diagnosis_system`, `diagnosis_code`, `diagnosis_display` and `diagnosis_text`; coding status is derived as selected, text-only or absent from these values. Editing the search text clears its previous code. Referral preview, sender tracker, receiver details and onward referral retain the validated coding.

The migration currently uses `diagnosis_concept` (coding plus text) alongside the legacy diagnosis extension in the existing minimized routing payload. This is an interim adapter, not a claim that the current API accepts a full PH Core/eReferral transaction Bundle. Linked `Condition` and `ServiceRequest` construction remains Phase 7. Patient identity continues to use direct encrypted hospital-to-hospital transfer, not central identity storage.

Verification: 12 terminology/diagnosis unit tests; synthetic signed-API/PostgreSQL and direct-transfer integration; text-only and absent-diagnosis persistence; PHP validation and production MySQL insert round-trip; frontend autocomplete state/keyboard/race tests; local patient encryption regression. Synthetic records were removed or transactionally rolled back. The separate existing pytest-based regression suite could not run in this Python environment because pytest is not installed. Tests do not replace a clinician's final prototype UI review.

Replace the plain diagnosis input with a searchable autocomplete while retaining free-text entry.

Store and submit:

- SNOMED CT system URL
- Selected concept code
- Official display
- Clinician-entered text
- Coding status such as selected, text-only, or mapped

Do not use the current default of `Pneumonia` when the clinician leaves diagnosis empty. An absent diagnosis should remain absent or be explicitly marked as not yet established.

Acceptance criteria:

- A clinician can search and select a diagnosis.
- The selected code and display survive reopening the referral form.
- Free text works when no suitable concept exists.
- The receiver sees both the readable diagnosis and its code when available.
- The intelligence layer can prefer codes but still handle legacy text.

#### Phase 4 follow-up: Broader Ontoserver diagnosis search

Status: Planned; not implemented. The completed prototype currently limits diagnosis selection and validation to ten concepts in the local versioned ValueSet. Calling Ontoserver alone does not remove that limit: central search filters against the snapshot, and PHP independently checks the same list.

Planned work:

- Verify an appropriate broader diagnosis ValueSet is available on the configured Ontoserver. Record its canonical URL, version, SNOMED edition and supported operations; do not assume a suitable ValueSet already exists.
- Keep the authenticated request path: Frontend → Mock Hospital PHP → IoL terminology service → Ontoserver. Do not expose credentials or move validation trust into the browser.
- Use filtered, limited `ValueSet/$expand` searches for diagnoses, rather than searching the entire SNOMED terminology indiscriminately.
- Update the registry, central search filtering, IoL validation and PHP submission validation together so a valid search result is not rejected by the old ten-concept restriction.
- Validate selected codes against the same ValueSet/version with `$validate-code`, resolve their display labels, and retain separate system/code/display/text storage.
- Keep version-aware caching and free-text entry. Clearly identify a controlled cached/local fallback when the remote service is unavailable; never silently treat that smaller fallback as the complete remote ValueSet.
- Test a valid diagnosis outside the original ten concepts through search, submission, persistence, receiver display and onward referral. Also test invalid/out-of-ValueSet codes, unavailable service and legacy text-only referrals.

Completion criterion: diagnoses outside the original prototype list can be retrieved from Ontoserver and accepted consistently by both backends, while constrained validation, free-text fallback and the existing patient privacy workflow remain intact.

### Phase 5: Preserve Chief Complaint and Add Optional Symptom Coding

Status: Complete for prototype on October 12, 2026. The required narrative is a multiline field with up to 2,000 characters. A separate optional symptom combobox searches the controlled `chief-complaint` ValueSet, supports keyboard selection and clears stale codes when edited. Selecting or clearing the symptom does not change the narrative used by referral previews and consent documents.

PHP and IoL independently validate symptom codes and resolve canonical displays. The transitional routing payload carries `chief_complaint_concept` (coding plus narrative) while retaining the legacy narrative extension. MySQL and PostgreSQL persist system/code/display/text separately. Legacy local `chief_complaint` remains a 255-character compatibility copy; the full narrative is retained in `chief_complaint_text`. Receiver details, sender tracking and onward referral expose/preserve the coding and narrative. Legacy text-only routing requests remain supported by IoL.

Verification: terminology/diagnosis/complaint unit tests; frontend keyboard, stale-result and narrative-preservation checks; real local MySQL insert/rollback with long narrative; signed referral and direct encrypted patient-transfer round-trip; existing encrypted identity regression. Add Patient was also restyled to use the referral form's single-panel surface, separators, Outfit typography and responsive sections, preserving its field IDs, required/disabled states and save behavior. Synthetic integration records were cleaned up. No production clinical approval is implied.

Keep chief complaint as a required narrative field because it represents the patient's presentation and may contain details that a single code cannot express.

Add an optional SNOMED symptom/clinical-finding searchable autocomplete beside the narrative field. This must be a text-search control with filtered results, not a fixed HTML dropdown containing every allowed concept.

The interaction must work as follows:

1. The clinician types part of a complaint, such as `head`.
2. The application searches only the configured chief-complaint ValueSet.
3. Each result shows its official display and SNOMED CT code.
4. Selecting a result stores `system`, `code`, and `display` in hidden form state.
5. The clinician records the patient-specific presentation in the separate required narrative field.
6. Editing or clearing the selected concept clears its stored coding so stale codes cannot be submitted.

Example presentation:

```text
Chief complaint text: Severe chest pain radiating to the left arm
Coded finding search: [ chest pai...                         ]
Selected finding: Chest pain (SNOMED CT 29857009)
```

Acceptance criteria:

- The original narrative is never replaced by the selected display label.
- Symptom coding is optional unless an approved profile makes it mandatory.
- The coded-finding control is searchable and keyboard accessible; it is not a fixed select menu.
- Search results come only from the configured and versioned chief-complaint ValueSet.
- A selected code is cleared when its displayed value is manually changed.
- Multiple words or details remain searchable in the receiving view.
- Printed and electronic consent documents continue showing readable clinical text.

### Phase 6: Separate Triage Acuity, Referral Priority, and Condition Severity

Status: Complete for prototype on October 12, 2026. Triage and condition severity use the versioned local artifacts; priority accepts only `routine`, `urgent`, `asap` and `stat`. The frontend loads options from PHP rather than defining another independent mapping. Levels 1–5 suggest routine/routine/urgent/asap/stat. Priority overrides require a reason. New coded triage is doctor-assigned; old signed severity-only requests remain compatible and are explicitly audited as legacy-system assignments.

Both MySQL and PostgreSQL save the three concepts separately. Routing and legacy analytics use the triage-derived compatibility severity, never condition severity. The legacy `disease_severity` column remains populated for existing consumers. Severe condition coding and triage levels 3–5 flag immediate notifications. Sender previews, receiver details, onward referral and consent triage labels were updated.

Selected receiving doctors can reassess an open referral through `PATCH /api/v1/referral/{referral_id}/clinical-urgency`, using the authenticated PHP gateway. PostgreSQL migration `e6a1c8f2b9d0` adds urgency audit history (previous/new values, facility, actor account/role, timestamp and reason). No existing patient or referral data was removed. Reassessment does not automatically redirect or rebroadcast a finalized referral.

For triage level 5, ordinary AI scoring is bypassed when producing recommendations. Accepted hospitals are rechecked for current eligibility/capabilities, then ordered deterministically by available capability count, geographic distance, available beds and stable facility ID. Missing coordinates exclude a candidate from that emergency order. This is a prototype heuristic, not a clinically validated safety assessment. The sending clinician still confirms the destination after facility acceptance; autonomous dispatch and comprehensive transfer-safety checks remain future work. The broader emergency-routing policy must not be described as fully automated in this prototype.

Verification: urgency mapping/invalid-code/override/doctor-role unit tests, emergency AI-bypass and eligibility-filter tests, frontend priority/override tests, MySQL round-trip, signed HTTP creation and receiving reassessment with PostgreSQL audit assertions, direct encrypted patient transfer and existing form/encryption regressions. Synthetic integration records were removed or rolled back. Individual clinician identity in IoL is currently an assertion made by the authenticated signing facility; PHP enforces logged-in doctor role. Per-user central authentication is separate security work.

Transport still uses transitional `triage`, `referral_priority` and `condition_severity` fields. Actual `ServiceRequest.priority` and `Condition.severity` resource construction is Phase 7; this phase validates/prepares their values but does not claim a complete FHIR Bundle implementation.

Replace the overloaded numeric severity field with three distinct concepts:

1. **Triage acuity** — how urgently the patient requires clinical attention.
2. **Referral priority** — how quickly the requested referral should be actioned.
3. **Condition severity** — the clinician's assessment of the diagnosis itself.

Keep the existing numeric severity temporarily as a compatibility and routing field. Add an explicit mapping from the approved triage scale to the legacy value while the matching engine is migrated.

Do not assume that a higher number always means greater urgency. The direction must come from the approved triage ValueSet.

Acceptance criteria:

- The form clearly explains the difference among the three fields.
- The routing engine reads triage acuity rather than condition severity.
- `ServiceRequest.priority` receives only valid FHIR priority codes.
- `Condition.severity` remains optional where clinically appropriate.
- Existing analytics can group legacy and new referrals consistently.

### Phase 7: Create Condition and ServiceRequest Resources

Status: Complete for the prototype on October 13, 2026. The existing signed referral API accepts an embedded clinical transaction Bundle. Its minimized Patient, Organization, PractitionerRole, Encounter, optional Condition and ServiceRequest use internally resolved UUID references. Diagnosis and chief complaint are read from these resources for new submissions; legacy custom fields remain accepted during migration. Source facilities and the selected receiving facility can retrieve the clinical Bundle. Reassessment synchronizes ServiceRequest priority and Condition severity.

This is not yet a general-purpose FHIR transaction endpoint or full Philippine profile validation. Those are Phase 9 work. See [implementation and testing notes](../docs/FHIR_CLINICAL_RESOURCES_PHASE_7_8.md).

Build one FHIR `Condition` for the working diagnosis when diagnosis information exists.

Build the referral as a FHIR `ServiceRequest` and connect the clinical reason using:

- `ServiceRequest.reasonReference` referencing the `Condition`, and/or
- `ServiceRequest.reasonCode` for an approved coded or textual referral reason.

Use Bundle-local `urn:uuid` references before server-assigned resource IDs exist.

Remove diagnosis and chief complaint from custom extensions only after the new resource mapping is active and backward compatibility has been verified.

Acceptance criteria:

- Every internal Bundle reference resolves.
- Condition coding and text survive a round trip through central IRDSS.
- ServiceRequest priority and referral reasons display correctly.
- The receiver can retrieve the Condition associated with the referral.
- The matching engine receives the same or better clinical inputs than before.

### Phase 8: Convert Vital Signs to FHIR Observation Resources

Status: Complete for the prototype on October 13, 2026. Referral and arrival readings have distinct Observation IDs, encounter contexts and actual measurement times. Blood pressure is one panel with two component values; all seven types produce eight normalized values. The form requires measurement-time confirmation for populated legacy readings with unknown timestamps. Arrival retries do not replace earlier measurements. Detail views expose measurement history and retain readable compatibility fields.

No missing historical timestamp is invented and no old patient/referral records are deleted. The new PostgreSQL resource-snapshot migration is `f7b8c2d4e6a0`.

Create individual Observation resources for:

- Blood pressure panel with systolic and diastolic components
- Heart rate
- Respiratory rate
- Body temperature
- Oxygen saturation
- Body height
- Body weight

Each Observation must include:

- `status`
- `category`
- LOINC `code`
- Patient `subject`
- Encounter or referral context when required
- Measurement time
- Numeric value
- UCUM system and unit code

Keep referral-time vitals separate from arrival-time vitals by using distinct Observation timestamps and encounter/workflow context.

Acceptance criteria:

- Every displayed vital value can be traced to an Observation.
- Blood pressure components retain their individual LOINC codes.
- UCUM units validate correctly.
- Referral-time and arrival-time observations are never overwritten.
- Existing printable and detail views show the same readable values.

### Phase 9: Validate Bundles and Persist Standardized Data

Update the central FHIR endpoint to:

1. Validate Bundle type and profiles.
2. Resolve `urn:uuid` references.
3. Validate required resources and identifiers.
4. Validate configured terminology codes.
5. Store code, system, display, text, and resource identifiers.
6. Map triage and clinical capabilities into the matching engine.
7. Return a transaction-response Bundle.
8. Return field-level FHIR `OperationOutcome` issues for invalid requests.

Do not return raw Python, SQLAlchemy, PostgreSQL, PHP, or stack-trace errors.

Acceptance criteria:

- Valid Bundles create one consistent referral transaction.
- Invalid codes identify the exact resource and element.
- Partial database writes roll back when transaction validation fails.
- Duplicate Bundle submission is idempotent.
- Stored clinical codes can be queried for analytics and matching.

### Phase 10: Compatibility, Cutover, and Legacy Cleanup

Use a staged rollout:

1. Accept legacy and standardized payloads.
2. Write both legacy display columns and new coded fields.
3. Prefer new coded fields when reading.
4. Backfill historical records where mapping is reliable.
5. Monitor legacy payload usage by client and endpoint.
6. Publish a deprecation date.
7. Stop accepting legacy custom clinical extensions.
8. Remove obsolete columns only in a later, separately approved migration.

Never automatically assign a SNOMED code to historical free text unless the mapping is reviewed or clearly marked as machine-derived.

Acceptance criteria:

- Existing Mock Hospital referrals continue working during migration.
- New Bundles work with other conforming systems.
- No legacy client is removed without usage evidence and notice.
- Historical text remains available after backfill.
- Legacy removal has a tested rollback and database backup.

## Proposed Code Ownership

### Mock Hospital

```text
frontend/js/terminology/clinical-terminology.js
frontend/js/referrals/referral-form.js
frontend/js/referrals/referral-submit.js
backend/terminology_proxy.php
backend/send_referral.php
database/upgrade_fhir_clinical_coding_20261007.sql
```

### Central IRDSS

```text
app/services/terminology_service.py
app/services/fhir_bundle_service.py
app/schemas/fhir_condition.py
app/schemas/fhir_observation.py
app/schemas/fhir_service_request.py
app/models/referral_model.py
app/routers/fhir.py
alembic/versions/c4e8b1d7a2f6_add_fhir_clinical_coding_foundation.py
```

Exact files may be adjusted after Phase 1 confirms the profiles and ValueSets.

## Verification Checklist After Every Phase

- Existing Mock Hospital login and referral workflows still work.
- Legacy referral payloads remain accepted until the planned cutover.
- Patient, practitioner, and facility identifiers remain stable.
- Diagnosis and complaint text display correctly in sender and receiver views.
- Referral recommendations still run and remain explainable.
- Referral priority, condition severity, and triage acuity are not interchanged.
- Vital values and units display correctly.
- Consent printing and electronic consent retain readable clinical information.
- Referral timelines, notifications, WebSockets, onward referral, arrival, and discharge still work.
- Invalid coded values produce safe, field-specific errors.
- Database migrations are tested on a backup or disposable database first.
- No destructive migration runs without row-count checks and a rollback plan.

## Recommended First Implementation Batch

Start with Phases 1 and 2 only:

1. Freeze the terminology and clinical field mapping.
2. Confirm the approved triage scale with clinical stakeholders.
3. Select the diagnosis, symptom, referral-reason, and severity ValueSets.
4. Confirm LOINC and UCUM mappings for every existing vital field.
5. Prepare additive PostgreSQL and MySQL migrations.
6. Add tests showing that existing referrals remain readable.

Do not change the visible dropdowns until the database and terminology contracts are ready. Do not remove the current custom fields until the standardized Bundle has passed compatibility testing.

## Reference Standards

- Philippine Core FHIR Implementation Guide: `https://fhir.doh.gov.ph/phcore/`
- HL7 FHIR R4 ServiceRequest: `https://hl7.org/fhir/R4/servicerequest.html`
- HL7 FHIR R4 Condition: `https://hl7.org/fhir/R4/condition.html`
- HL7 FHIR R4 Observation: `https://hl7.org/fhir/R4/observation.html`
- SNOMED CT: `http://snomed.info/sct`
- LOINC: `http://loinc.org`
- UCUM: `http://unitsofmeasure.org`
- LOINC vital-sign panel reference: `https://loinc.org/74728-7`

The Philippine Core guide is currently published as a draft. Profile versions and ValueSet URLs must be pinned and reviewed again before production deployment.
