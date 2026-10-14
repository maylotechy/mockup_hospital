# IRDSS FHIR Clinical Data Contract

## Document Status

| Item | Value |
| --- | --- |
| Phase | Phase 1: Clinical contract and approved ValueSets |
| Status | Approved as the IRDSS mock-up baseline; production approval deferred |
| Prepared | October 6, 2026 |
| FHIR baseline | HL7 FHIR R4 (4.0.1) |
| Philippine baseline | Draft PH Core 0.2.0 plus the R12 PeRef Connectathon artifacts stored in this repository |
| Implementation status | No production payload or form changes in this phase |

The Philippine Core guide and PeRef artifacts are still subject to change. The versions in this contract are accepted for the mock-up. Canonical profile and ValueSet versions must be revalidated before production deployment.

## Purpose

This contract defines how the clinical fields currently collected by the Mock Hospital will be represented during the FHIR migration. It prevents the frontend, PHP gateway, central IRDSS API, PostgreSQL storage, and matching engine from assigning different meanings to the same field.

The contract follows four rules:

1. Preserve the clinician's original text.
2. Store terminology system, code, display, and text separately.
3. Do not silently invent clinical values when a field is blank.
4. Keep triage acuity, referral priority, and condition severity separate.

## Source Artifacts Reviewed

- `frontend/index.html` — current referral form
- `frontend/js/referrals/referral-form.js` — form state and consent snapshot
- `frontend/js/referrals/referral-submit.js` — browser-to-PHP payload
- `backend/send_referral.php` — current custom FHIR-like payload builder
- `connectathon/HL7-FHIR-Connectathon/ph-ereferral-collection/ph-ereferral-collection.json` — R12 PeRef transaction examples
- Central IRDSS `app/schemas/encounter.py` and `app/routers/referral.py` — current parser and storage mapping
- Draft PH Core `Condition`, `ServiceRequest`, and `Observation` profiles

## Current-to-Target Field Mapping

| Current field | Current representation | Target FHIR representation | Coding rule | Required in IRDSS target |
| --- | --- | --- | --- | --- |
| Chief complaint | `chiefComplaint` custom Patient extension and flat text column | A chief-complaint `Condition.code.text`; optional SNOMED CT coding | Text required; code optional | Yes, text |
| Diagnosis / working impression | `diagnosis` custom Patient extension and flat text column | A working-impression `Condition.code` with `verificationStatus = provisional` when appropriate | SNOMED CT coding preferred; text fallback allowed | No, unless local policy changes |
| Clinical history | Not represented consistently | `Condition.note` and/or approved supporting-information field | Narrative text | No |
| Referral category | Local hardcoded category dropdown | `ServiceRequest.category` | Approved PeRef/DOH ValueSet required | Yes |
| Referral reasons | Local CodeSystem plus text | `ServiceRequest.reasonCode`; use `reasonReference` for the working-impression Condition | Approved referral-reason ValueSet when coded; text fallback allowed | At least one reason |
| Numeric severity 1–5 | Custom decimal Patient extension; used by matching | Temporary legacy field plus approved triage-acuity coding | Do not call this `Condition.severity` | Yes during migration |
| Referral priority | Not stored separately | `ServiceRequest.priority` | FHIR RequestPriority | Yes in IRDSS target |
| Condition severity | Mixed into numeric severity | `Condition.severity` | Approved condition-severity ValueSet | Optional |
| Referral-time vital signs | Custom Patient extensions and flat referral columns | Individual `Observation` resources | LOINC code plus UCUM unit | Optional per measurement |
| Arrival-time vital signs | Separate flat referral columns | Separate `Observation` resources with arrival time/context | Same LOINC/UCUM rules; never overwrite referral-time observations | Optional per measurement |

## FHIR Resource Contract

### Chief Complaint Condition

Use the PeRef Condition profile recorded by the Connectathon artifacts:

```text
Profile: https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition
Category: problem-list-item
Clinical status: active, when clinically applicable
Code text: full chief complaint entered by the clinician
Code coding: optional SNOMED CT clinical finding or symptom
Encounter: reference to the referral Encounter
Subject: reference to the Patient
```

Chief complaint text remains required in IRDSS. Selecting a SNOMED concept must not replace or shorten the narrative.

The coded finding is entered through a searchable autocomplete rather than a fixed dropdown. Search results are constrained to the configured chief-complaint ValueSet and display both the official concept name and SNOMED CT code. The selected `system`, `code`, and `display` are stored separately from the required narrative. If the user edits the selected display without choosing another result, the coding is cleared while the narrative is preserved.

### Working Impression Condition

```text
Profile: https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-condition
Category: encounter-diagnosis
Verification status: provisional for a working impression
Code text: clinician-entered working impression
Code coding: preferred SNOMED CT diagnosis or clinical finding
Encounter: reference to the referral Encounter
Subject: reference to the Patient
```

If the clinician has not established a diagnosis, IRDSS must leave it absent. The current automatic fallback to `Pneumonia` must be removed during Phase 4.

### Referral ServiceRequest

```text
Profile: https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-service-request
Status: active when submitted
Intent: order
Priority: routine | urgent | asap | stat
Category: approved coded referral category
Reason code: coded and/or textual operational reason for referral
Reason reference: reference to the working-impression Condition when present
Subject: reference to the Patient
Encounter: reference to the Encounter
Requester: reference to the referring PractitionerRole
Performer: receiving PractitionerRole or Organization when known
```

`reasonCode` and `reasonReference` must not duplicate the same meaning. A practical IRDSS split is:

- `reasonCode`: why transfer is operationally required, such as unavailable specialist or required procedure.
- `reasonReference`: the clinical diagnosis or working impression justifying the referral.

### Vital-sign Observations

Use the PeRef Observation profile recorded by the Connectathon artifacts:

```text
Profile: https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-observation
Status: final
Category system: http://terminology.hl7.org/CodeSystem/observation-category
Category code: vital-signs
Code system: http://loinc.org
Quantity system: http://unitsofmeasure.org
Subject: Patient reference
Encounter: Encounter reference
Effective time: actual measurement time
```

## Vital-sign Terminology Matrix

| Measurement | LOINC code | Display | UCUM code | Notes |
| --- | --- | --- | --- | --- |
| Blood pressure panel | `85354-9` | Blood pressure panel with all children optional | None on panel | Values are carried by components |
| Systolic blood pressure | `8480-6` | Systolic blood pressure | `mm[Hg]` | Blood-pressure component |
| Diastolic blood pressure | `8462-4` | Diastolic blood pressure | `mm[Hg]` | Blood-pressure component |
| Heart rate | `8867-4` | Heart rate | `/min` | UI may display bpm |
| Respiratory rate | `9279-1` | Respiratory rate | `/min` | UI may display breaths/minute |
| Oxygen saturation | `2708-6` plus `59408-5` when measured by pulse oximetry | Oxygen saturation in arterial blood; pulse-oximetry method coding when known | `%` | Keep `2708-6` as the PeRef/Connectathon primary coding and add `59408-5` for the current pulse-oximetry field |
| Body temperature | `8310-5` | Body temperature | `Cel` | Preserve measurement method/site later if collected |
| Body weight | `29463-7` | Body weight | `kg` | Connectathon mapping |
| Body height | `8302-2` | Body height | `cm` | Final prototype mapping for ordinary height; use `8306-3` only when explicitly measured lying down |

The table records the codes used in the Connectathon package wherever available. The prototype decision for oxygen saturation preserves `2708-6` as the primary PeRef coding and adds `59408-5` when pulse oximetry is the known method. Ordinary height uses `8302-2`; `8306-3` is reserved for an explicitly recorded lying measurement. These decisions remain subject to formal clinical and interoperability sign-off.

## Terminology Registry

| Field | CodeSystem | ValueSet | Binding for IRDSS | Status |
| --- | --- | --- | --- | --- |
| Diagnosis / working impression | `http://snomed.info/sct` | `https://irdss.gov.ph/fhir/ValueSet/referral-diagnosis\|0.1.0` | Preferred, with text fallback | IRDSS-controlled draft; replace with an official ValueSet when available |
| Chief complaint coded finding | `http://snomed.info/sct` | `https://irdss.gov.ph/fhir/ValueSet/chief-complaint\|0.1.0` | Optional | IRDSS-controlled draft; replace with an official ValueSet when available |
| Referral category | `http://snomed.info/sct` | `https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category\|0.1.0` | Required for new FHIR payload | Confirmed PeRef snapshot; profile element placement remains an interoperability review item |
| Referral service type | `http://snomed.info/sct` | `https://www.fhir.doh.gov.ph/pheref/ValueSet/reason-for-referral-service-type\|0.1.0` | Required for new FHIR payload | Confirmed PeRef snapshot; preserve detailed operational reason as text |
| Referral priority | `http://hl7.org/fhir/request-priority` | `http://hl7.org/fhir/ValueSet/request-priority` | Required | Confirmed by FHIR R4/PH Core |
| Condition severity | `http://snomed.info/sct` | `http://hl7.org/fhir/ValueSet/condition-severity\|4.0.1` | Optional/example binding | Versioned FHIR R4 snapshot recorded; kept separate from triage and priority |
| Triage acuity | To be approved | To be approved | Required by IRDSS routing | Clinical decision pending |
| Vital-sign type | `http://loinc.org` | Approved vital-sign codes | Required when an Observation is present | Proposed codes documented above |
| Measurement unit | `http://unitsofmeasure.org` | UCUM units | Required for numeric quantities | Proposed units documented above |

Do not treat the whole SNOMED CT CodeSystem as a dropdown. The UI must search an approved ValueSet expansion and the backend must validate the submitted coding against the same canonical ValueSet and version.

## Triage, Priority, and Severity Decision

### Existing behavior that must be preserved initially

| Current value | Current label | Current routing interpretation |
| --- | --- | --- |
| `1` | Mild | Lower-acuity routing |
| `2` | Moderate | Intermediate routing |
| `3` | Severe | Requires higher facility capability in the present algorithm |
| `4` | Critical | Requires higher facility capability in the present algorithm |
| `5` | Extreme | Requires higher facility capability in the present algorithm |

This is an IRDSS prototype scale, not yet an approved national triage ValueSet. It must remain a compatibility field until clinical stakeholders select the target scale.

### Prototype triage policy decision

The following IRDSS prototype policy was recorded on October 6, 2026:

| Triage level | Label | FHIR request priority | Notification and routing behavior |
| --- | --- | --- | --- |
| `1` | Mild | `routine` | Normal matching and normal notification |
| `2` | Moderate | `routine` | Normal matching and normal notification |
| `3` | Severe | `urgent` | Immediate notification and priority matching |
| `4` | Critical | `asap` | Immediate notification and priority matching |
| `5` | Extreme | `stat` | Immediate notification; bypass ordinary AI ranking and deterministically route to the most capable eligible available facility |

Level 5 is the highest acuity. Only a doctor assigns the initial triage level. A receiving facility may reassess and change it. A clinician may override the automatically suggested referral priority. Every reassessment or override must retain the previous value, new value, user, facility, timestamp, and reason.

The level-5 override bypasses ordinary AI scoring only. It must not bypass facility eligibility, current availability, required service/capability checks, geographic or transfer-safety constraints, or other clinical safeguards.

This policy is represented by `CodeSystem-irdss-triage-acuity.json`, `ValueSet-irdss-triage-acuity.json`, and `ConceptMap-irdss-triage-to-request-priority.json`. These artifacts remain `draft` and `experimental` because they are mock-up terminology; clinical approval is required only before production use.

## Text and Terminology Fallback Rules

| Situation | Required behavior |
| --- | --- |
| Terminology service available and a correct concept exists | Store system, code, display, and original text |
| Terminology service unavailable | Allow the clinician to continue with text; mark coding as unavailable/text-only |
| No suitable concept exists | Preserve text and do not select an inaccurate code |
| User changes text after selecting a code | Keep the selected coding visible and require confirmation that it still matches |
| Submitted code is outside the configured ValueSet | Reject the coded value with a field-specific error; allow correction or text-only fallback when policy permits |
| Display sent by client differs from terminology server | Preserve original text, but use the terminology server's official display for the coding |
| Legacy record has only text | Display it unchanged; do not silently backfill an asserted SNOMED code |
| Required clinical text is blank | Return a validation error; never insert sample clinical data |

## Canonical Clinical Example

This example is descriptive and intentionally not the final JSON Bundle.

| Field | Example |
| --- | --- |
| Chief complaint text | Severe headache, dizziness, blurring of vision and epigastric pain for two days |
| Chief complaint coding | SNOMED CT `25064002` — Headache |
| Working impression text | Severe pre-eclampsia, 32 weeks age of gestation, G2P1 |
| Working impression coding | SNOMED CT `398254007` — Pre-eclampsia |
| Diagnosis verification | Provisional |
| Referral reason text | Requires IV antihypertensive treatment, seizure prophylaxis, and maternal-fetal monitoring |
| Referral reason coding | SNOMED CT `71388002` — Procedure, as used by the Connectathon sample; a more specific approved code is preferred |
| Referral category text | Emergency |
| Referral category coding | SNOMED CT `73770003` — Hospital-based outpatient emergency care center, as used by the Connectathon sample |
| Blood pressure | 180/110 `mm[Hg]` |
| Heart rate | 112 `/min` |
| Respiratory rate | 24 `/min` |
| Oxygen saturation | 96 `%` |
| Temperature | 36.8 `Cel` |
| Weight | 72 `kg` |

The example proves the shape of the mapping but does not approve the broad `Procedure` code as the final referral-reason vocabulary.

## Validation Responsibilities

| Layer | Responsibility |
| --- | --- |
| Mock Hospital frontend | Search approved options, display codes clearly, preserve text, and prevent incomplete selections |
| Mock Hospital PHP backend | Revalidate required combinations, proxy terminology requests, and build valid resources |
| Central IRDSS API | Treat client input as untrusted; validate profiles, bindings, references, units, and identifiers |
| Terminology server | Expand ValueSets, look up official displays, and validate codes |
| PostgreSQL | Preserve normalized code fields, identifiers, timestamps, and referential integrity |
| Matching engine | Use approved triage and clinical codes while retaining a controlled legacy-text fallback |

## Phase 1 Approval Checklist

| Deliverable | Status |
| --- | --- |
| Existing clinical fields inventoried | Complete |
| Current custom extensions documented | Complete |
| Connectathon Condition, ServiceRequest, and Observation patterns documented | Complete |
| LOINC/UCUM proposal for existing vital signs | Technical decision complete; formal clinical/interoperability sign-off pending |
| Text fallback and terminology-unavailable behavior | Complete |
| Diagnosis ValueSet canonical URL and version | Prototype complete: IRDSS draft `0.1.0`; clinical approval pending |
| Chief complaint ValueSet canonical URL and version | Prototype complete: IRDSS draft `0.1.0`; clinical approval pending |
| Referral category and service-type ValueSet canonical URLs and versions | PeRef `0.1.0` snapshots complete; profile element placement pending interoperability sign-off |
| Prototype triage scale and priority mapping | Versioned artifacts complete; formal clinical approval pending |
| Clinical safety review | Deferred until production preparation; not required for mock-up completion |
| DPO/privacy review of clinical terminology traffic and caching | Deferred until production preparation; not required for mock-up completion |
| Canonical Bundle | Prototype complete; local structural/reference validation passed |

## Production Sign-off

Phase 1 is complete for the mock-up. Before the same terminology and routing behavior can be used in production, obtain approval from:

- IRDSS clinical lead or designated physician
- Referral workflow owner
- FHIR/interoperability lead
- Data protection or privacy representative for terminology-query handling
- Central IRDSS technical owner

The deferred production sign-off does not block later mock-up phases. Current fields must still remain during migration, and mock-up decisions must not be treated as approved production clinical policy.

## References

- Draft Philippine Core FHIR Implementation Guide: `https://fhir.doh.gov.ph/phcore/`
- PH Core Condition: `https://fhir.doh.gov.ph/phcore/StructureDefinition-ph-core-condition.html`
- PH Core ServiceRequest: `https://fhir.doh.gov.ph/phcore/StructureDefinition-ph-core-serviceRequest.html`
- PH Core Observation: `https://fhir.doh.gov.ph/phcore/StructureDefinition-ph-core-observation.html`
- HL7 FHIR R4 ServiceRequest: `https://hl7.org/fhir/R4/servicerequest.html`
- HL7 FHIR R4 Condition: `https://hl7.org/fhir/R4/condition.html`
- HL7 FHIR R4 Observation: `https://hl7.org/fhir/R4/observation.html`
- LOINC vital-sign panel reference: `https://loinc.org/74728-7`
