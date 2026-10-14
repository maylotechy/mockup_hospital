# IRDSS Controlled Terminology

This directory contains versioned FHIR terminology resources owned by IRDSS for fields that do not yet have a confirmed Philippine eReferral ValueSet.

## Prototype ValueSets

| Resource | Canonical URL | Version | Use |
| --- | --- | --- | --- |
| `ValueSet-irdss-chief-complaint.json` | `https://irdss.gov.ph/fhir/ValueSet/chief-complaint` | `0.1.0` | Optional coded finding supporting the required chief-complaint narrative |
| `ValueSet-irdss-referral-diagnosis.json` | `https://irdss.gov.ph/fhir/ValueSet/referral-diagnosis` | `0.1.0` | Coded working diagnosis with text-only fallback |
| `CodeSystem-irdss-triage-acuity.json` | `https://irdss.gov.ph/fhir/CodeSystem/triage-acuity` | `0.1.0` | IRDSS-owned five-level triage scale; level 5 is highest |
| `ValueSet-irdss-triage-acuity.json` | `https://irdss.gov.ph/fhir/ValueSet/triage-acuity` | `0.1.0` | Allowed IRDSS triage levels |
| `ConceptMap-irdss-triage-to-request-priority.json` | `https://irdss.gov.ph/fhir/ConceptMap/triage-to-request-priority` | `0.1.0` | Draft operational mapping to FHIR request priority |

The IRDSS-owned resources are intentionally marked `draft` and `experimental`. They are prototype subsets, not complete clinical vocabularies and not national standards.

## External terminology snapshots

The `snapshots/` directory contains source-controlled copies of the exact external terminology versions reviewed by IRDSS. Their canonical URLs and ownership are not changed.

| Snapshot | Canonical URL | Version |
| --- | --- | --- |
| `snapshots/ValueSet-pheref-referral-category-0.1.0.json` | `https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category` | `0.1.0` |
| `snapshots/ValueSet-pheref-referral-service-type-0.1.0.json` | `https://www.fhir.doh.gov.ph/pheref/ValueSet/reason-for-referral-service-type` | `0.1.0` |
| `snapshots/ValueSet-fhir-condition-severity-4.0.1.json` | `http://hl7.org/fhir/ValueSet/condition-severity` | `4.0.1` |

Snapshots provide a reviewed fallback and reproducible tests. At runtime, the IOL should request the pinned canonical ValueSet from Ontoserver, cache the expansion, compare its version with the configured version, and use the snapshot only under the documented outage policy.

## Validation Record

The seed SNOMED CT concepts and official displays were checked on October 6, 2026 using the FHIRLab terminology server operation:

```http
GET https://tx.fhirlab.net/fhir/CodeSystem/$lookup
    ?system=http://snomed.info/sct
    &code={code}
```

The JSON resources are the source-controlled definitions. Phase 3 will add the application terminology service, caching, `$expand`, and `$validate-code` integration.

## Usage Rules

- Always store `system`, `code`, `display`, and the clinician's original `text` separately.
- Chief complaint text remains required even when a coded finding is selected.
- Diagnosis may remain text-only if there is no accurate concept in the prototype ValueSet.
- Never silently choose the first or closest concept.
- Backend validation is required; frontend autocomplete alone is not authoritative.
- Adding, removing, or replacing concepts requires a ValueSet version change and clinical review.
- Replace these draft ValueSets with official PeRef/DOH ValueSets if those become available.
- Only a doctor assigns the initial triage level. A receiving facility may reassess and change it, with the change recorded in the audit history.
- Levels 3 through 5 require immediate notification.
- A clinician may override the suggested referral priority, but the original suggestion, final priority, user, time, and reason must be retained.
- Level 5 bypasses ordinary AI ranking and uses deterministic emergency routing to the most capable eligible available facility. It must never bypass eligibility, availability, or safety constraints.

## Future Publication

The canonical URLs identify the ValueSets, but they are not publicly resolvable until IRDSS publishes them on a FHIR terminology endpoint. Until then, Phase 3 may load these local JSON definitions as a controlled fallback.

After publication on a terminology server, clients should expand them using their canonical URLs, for example:

```http
GET {terminologyBase}/ValueSet/$expand
    ?url=https://irdss.gov.ph/fhir/ValueSet/chief-complaint
    &filter=head
```
