# IRDSS FHIR Clinical Phase 1 Approval Record

## Package status

Technical package prepared on October 6, 2026. Formal approval is waived for the IRDSS mock-up, so Phase 1 may proceed to Phase 2. This document is retained as the production-readiness approval template. Any future approval applies only to the exact artifact versions reviewed; later changes require a new review.

## Artifacts for review

| Artifact | Version/status |
| --- | --- |
| `FHIR_CLINICAL_DATA_REFACTOR_PLAN.md` | Phase 1 draft |
| `docs/FHIR_CLINICAL_CONTRACT.md` | Phase 1 draft |
| `terminology/ValueSet-irdss-chief-complaint.json` | `0.1.0`, draft/experimental |
| `terminology/ValueSet-irdss-referral-diagnosis.json` | `0.1.0`, draft/experimental |
| `terminology/CodeSystem-irdss-triage-acuity.json` | `0.1.0`, draft/experimental |
| `terminology/ValueSet-irdss-triage-acuity.json` | `0.1.0`, draft/experimental |
| `terminology/ConceptMap-irdss-triage-to-request-priority.json` | `0.1.0`, draft/experimental |
| `terminology/snapshots/ValueSet-pheref-referral-category-0.1.0.json` | PeRef `0.1.0` snapshot |
| `terminology/snapshots/ValueSet-pheref-referral-service-type-0.1.0.json` | PeRef `0.1.0` snapshot |
| `terminology/snapshots/ValueSet-fhir-condition-severity-4.0.1.json` | FHIR R4 `4.0.1` snapshot |
| `docs/examples/irdss-referral-bundle.json` | Canonical draft example |

## Required decisions

Reviewers must verify:

- Level 5 is the highest triage acuity.
- Only doctors assign the initial triage level.
- Receiving facilities may reassess triage, with an audit record.
- Levels 3 through 5 trigger immediate notification.
- Level 5 bypasses ordinary AI ranking, but never bypasses eligibility, availability, capability, transfer-safety, or other clinical safeguards.
- Clinician priority overrides require the previous value, suggested value, final value, user, time, facility, and reason.
- Chief complaint narrative remains required and SNOMED coding is optional.
- Condition severity is separate from triage acuity and referral priority.
- Pulse-oximetry oxygen saturation uses LOINC `2708-6` with additional coding `59408-5`; height uses `8302-2` unless explicitly measured lying down.
- The canonical Bundle represents the intended IOL input contract.

## Sign-off

Allowed decisions: `Approved`, `Approved with conditions`, or `Changes required`.

| Reviewer | Responsibility | Name/role | Decision | Date | Conditions or requested changes |
| --- | --- | --- | --- | --- | --- |
| Clinical lead/designated physician | Clinical terminology, triage, priority, vital signs |  | Pending |  |  |
| Referral workflow owner | Referral categories, reasons, reassessment, notifications |  | Pending |  |  |
| FHIR/interoperability lead | Profiles, terminology bindings, Bundle references |  | Pending |  |  |
| DPO/privacy representative | Terminology requests, caching, logs, clinical data exposure |  | Pending |  |  |
| IRDSS technical owner | IOL validation, persistence, matching, deployment |  | Pending |  |  |

## Approval rule

Phase 1 is `Complete for prototype`. Before production use, all required reviewers must approve or all stated conditions must be resolved and recorded.
