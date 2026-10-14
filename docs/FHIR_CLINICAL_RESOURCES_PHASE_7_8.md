# FHIR clinical resources and vital-sign implementation

Implemented for the IRDSS prototype on October 13, 2026.

## Referral resources

The hospital backend creates a clinical transaction Bundle containing a pseudonymous Patient, Organization, PractitionerRole, Encounter, ServiceRequest and, when a working diagnosis exists, Condition. ServiceRequest.reasonReference connects the diagnosis; supportingInfo references the vital-sign Observations. Internal references use `urn:uuid` identifiers.

The Bundle travels in `clinical_bundle` through the existing signed `POST /api/v1/referral/initiate` adapter. It is **not** submitted to a new public `/fhir` endpoint. Legacy referral inputs remain accepted, but supplied clinical resources are authoritative for diagnosis, chief complaint and vital signs. New submissions omit duplicate custom clinical extensions from the central routing payload; the encrypted sender snapshot preserves the original document. Transitional top-level adapter fields and legacy database columns remain during migration.

Central IRDSS validates this supported subset: references, allowed resource shapes, patient minimization, codes, quantities, units and measurement times. It stores clinical resource snapshots and normalized observations atomically with the referral. This is not full PH Core/PeRef profile conformance validation; general FHIR transaction processing and standard error/response behavior remain Phase 9 work.

Selected receivers and the sender can use signed `GET /api/v1/referral/{referral_id}/clinical-bundle`. Other facilities cannot access it. Patient-detail responses also contain the clinical Bundle and normalized observations. Full patient identity still uses the existing encrypted direct-transfer mechanism, not central clinical Patient resources or a new identity vault.

## Vital-sign coding

| Measurement | LOINC | UCUM |
| --- | --- | --- |
| Blood-pressure panel | 85354-9; components 8480-6 / 8462-4 | mm[Hg] |
| Heart rate | 8867-4 | /min |
| Respiratory rate | 9279-1 | /min |
| Temperature | 8310-5 | Cel |
| Oxygen saturation | 2708-6 | % |
| Height | 8302-2 | cm |
| Weight | 29463-7 | kg |

Pulse-oximetry saturation additionally includes 59408-5 only when that method is explicitly selected. Unknown methods are not inferred. Coding follows the [FHIR R4 vital-sign guidance](https://hl7.org/fhir/R4/observation-vitalsigns.html); clinical requests use [ServiceRequest references](https://hl7.org/fhir/R4/servicerequest.html).

Seven Observation resources produce eight normalized quantities because blood pressure has two components. Numeric values support up to four decimal places. Unknown or missing measurements are omitted, not replaced with zero. A numeric zero remains a supplied reading where supported. These are structural/range checks, not a clinical plausibility assessment.

Referral-time and arrival-time readings have distinct Observation IDs and encounter contexts. Actual measurement timestamps are required for populated readings. Onward referrals preserve known per-field times; legacy readings with unknown times require clinician confirmation. Arrival retries do not overwrite or append another copy of previously recorded arrival vitals.

## How to test

1. Sign in as a referring clinician, choose a patient and open Refer Patient.
2. Enter a chief complaint and select a SNOMED diagnosis, or enter a free-text diagnosis. Condition severity requires a diagnosis.
3. Enter vital signs, confirm **Measured at**, and specify the oxygen measurement method if known. Supply both blood-pressure components or leave both blank.
4. Submit and select the receiving facility through the existing referral workflow.
5. As the selected receiver, review the diagnosis, priority and vital signs. Unauthorized facilities must not retrieve the clinical Bundle.
6. After acceptance, mark the patient as arrived and record arrival measurements. The detail view's measurement history must show separate referral and arrival readings, timestamps, LOINC codes and units.
7. Repeat the arrival action and verify that existing readings are unchanged. Refer onward and verify that carried readings retain their original measurement times.

## Database changes and checks

PostgreSQL migration `f7b8c2d4e6a0` adds validated clinical-resource snapshots. Existing normalized observation tables are reused in PostgreSQL and the local hospital database. No existing patient or referral rows are deleted by this migration. Local logs retain resource identifiers and normalized referral readings; central data supplies authorized receiver history.

Automated coverage includes PHP resource generation and local database rollback checks, Python clinical validation, direct encrypted patient transfer, urgency synchronization, scoped resource retrieval, arrival separation/retries and JavaScript measurement-time behavior. Test fixtures are synthetic and cleaned up afterward. Browser visual inspection and complete PH profile conformance testing remain separate tasks.
