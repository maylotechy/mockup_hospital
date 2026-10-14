# IRDSS FHIR Migration Plan

[All project plans](README.md)

## Objective

Refactor the Mock Hospital-to-central IRDSS referral exchange to use FHIR R4, Philippine Core, and Philippine eReferral profiles while retaining the existing PostgreSQL database, referral workflow, and intelligent facility-matching engine.

## Target Architecture

```text
Mock Hospital / External HIS
            |
            v
FHIR transaction Bundle
            |
            v
Central IRDSS FHIR API
            |
            v
Validation and terminology checks
            |
            v
Existing PostgreSQL database
            |
            v
IRDSS matching and referral workflow
```

The existing database and intelligence engine can remain. The primary change is to replace the external custom referral payload with a FHIR API and a mapping and validation layer.

## Phase 1: Define the FHIR Contract

Use FHIR R4 with the applicable Philippine Core and Philippine eReferral profiles.

A referral transaction Bundle should contain:

| Resource | Purpose |
| --- | --- |
| `Patient` | Demographics, identifiers, contact details, and address |
| `Organization` | Referring and receiving facilities using stable NHFR or facility codes |
| `Practitioner` | Referring clinician |
| `PractitionerRole` | Clinician role and organization affiliation |
| `Encounter` | Patient's current clinical encounter |
| `Condition` | Chief complaint and working diagnosis |
| `Observation` | Vital signs |
| `ServiceRequest` | The clinical referral request |
| `Task` | Referral workflow and status tracking |
| `Consent` | Electronic or paper-consent record |
| `DocumentReference` | Consent and clinical attachments |
| `Provenance` | Who created or submitted the referral |

## Phase 2: Map Current IRDSS Fields to FHIR

| Existing IRDSS field | FHIR location |
| --- | --- |
| Patient name, date of birth, and sex | `Patient` |
| PhilHealth number | `Patient.identifier` |
| PSGC address | `Patient.address` |
| Facility code | `Organization.identifier` |
| Doctor name | `Practitioner.name` |
| Doctor role | `PractitionerRole.code` |
| Chief complaint | `Condition` |
| Working diagnosis | `Condition` |
| Blood pressure, heart rate, respiratory rate, temperature, oxygen saturation, and weight | Individual `Observation` resources |
| Referral category and reason | `ServiceRequest` |
| Pending, received, accepted, redirected, and completed states | `Task.status` and related workflow data |
| Signed consent | `Consent` and `DocumentReference` |
| Referral creator and timestamp | `Provenance` |

Complete and approve the field-mapping document before replacing the current Pydantic request schemas.

## Phase 3: Standard Identifiers and Terminology

Use standard coding systems where required:

- **SNOMED CT:** Diagnoses, clinical concepts, referral reasons, and practitioner roles where required by the profile.
- **LOINC:** Observation types such as heart rate, blood pressure, oxygen saturation, temperature, and weight.
- **UCUM:** Measurement units such as `kg`, `Cel`, `%`, `/min`, and `mm[Hg]`.
- **PSGC:** Philippine geographic identifiers.
- **NHFR or assigned facility identifier:** Permanent organization identity.

Frontend dropdowns should display readable labels while retaining the official code and system.

```text
Display: Doctor
Code: doctor
System: official CodeSystem URL
```

Allowed options can be retrieved from the designated terminology server using `ValueSet/$expand` and cached locally. The backend must validate submitted codes and must not rely only on frontend validation.

## Phase 4: Build the Central FHIR Endpoint

Recommended initial endpoint:

```http
POST /fhir
Content-Type: application/fhir+json
```

The request body will be a FHIR transaction Bundle. The central server should:

1. Validate that the request is a FHIR `Bundle`.
2. Validate required profiles and resources.
3. Resolve internal `urn:uuid` references.
4. Verify facility and practitioner identifiers.
5. Validate terminology codes.
6. Convert the resources into IRDSS database records.
7. Run the existing facility-matching logic.
8. Return a FHIR transaction-response Bundle or `OperationOutcome`.

Invalid requests should return an `OperationOutcome` with clear field-level issues instead of raw Python, SQL, or database errors.

## Phase 5: Replace Name-Based Facility Authorization

Current referral operations frequently resolve a facility and then use its name to match referral records. The refactor should use a permanent identifier:

```text
Organization.identifier / facility_code -> central facility ID
```

Facility names should be display values only. Renaming a facility must not change its referral ownership or access.

Recommended database fields:

- `referring_facility_id`
- `receiving_facility_id`
- `fhir_service_request_id`
- `fhir_task_id`
- `fhir_patient_id`
- `fhir_bundle_identifier`
- `fhir_version_id`

Existing name columns may temporarily remain for display and backward compatibility during migration.

### Facility Rename Data Migration

Before stable facility IDs fully replace name-based relationships, facility renames must also migrate existing records that store the facility name. For the rename from `St. Jude General Hospital` to `DiWA Center`, update the associated API-key ownership, referral origin and destination fields, candidate response records, and any related attachment or audit ownership fields.

This is a temporary compatibility requirement. Once referrals reference the immutable central facility ID or `Organization.identifier`, changing an organization's display name must not affect its ability to view historical or active referrals.

## Phase 6: Implement the Task Workflow

Use `ServiceRequest` to represent what clinical service is requested and `Task` to represent the referral workflow.

| IRDSS state | Suggested FHIR representation |
| --- | --- |
| Referral created | `ServiceRequest.status = active`, `Task.status = requested` |
| Viewed or received | `Task.status = received` |
| Accepted | `Task.status = accepted` |
| In progress or patient arrived | `Task.status = in-progress` |
| Completed or discharged | `Task.status = completed` |
| Rejected or redirected | `Task.status = rejected` or an approved business status and reason |
| Cancelled | `Task.status = cancelled` |

The final mapping must follow the approved Philippine eReferral profile and its ValueSets. Unsupported custom status codes should not be placed directly in `Task.status`.

## Phase 7: Update the Mock Hospital

The Mock Hospital should:

1. Keep the existing PHP/MySQL patient interface.
2. Convert local patient and referral records into FHIR resources.
3. Create one transaction Bundle with internal references.
4. POST the Bundle to central IRDSS.
5. Store the returned FHIR resource identifiers locally.
6. Retrieve or receive `Task` status updates for referral tracking.

Use the Connectathon Bundle as the starting reference, but replace all hardcoded sample values with data from the existing referral form and authenticated facility.

## Phase 8: Preserve and Improve IRDSS Intelligence

FHIR standardizes the exchanged information; it does not replace the intelligent matching engine.

The matching layer can use:

- SNOMED-coded diagnosis and referral reason
- Referral priority
- Requested service codes
- Patient severity and vital signs
- Facility capabilities
- Available beds
- Distance
- Daily referral capacity

The intelligence layer can rank suitable `Organization` resources, create candidate workflow records, and return explainable recommendations.

## Phase 9: Security and NIDAS

Add NIDAS after the FHIR referral exchange is stable:

- Authenticate users through NIDAS using the supported identity protocol.
- Link an authenticated identity to a `Practitioner`.
- Link organizational responsibilities through `PractitionerRole`.
- Authenticate system-to-system requests separately using signed requests or registered client credentials.
- Record the authenticated user and organization in `Provenance`.

NIDAS identifies the user. It must not replace facility authorization or system-to-system authentication.

## Recommended Implementation Order

1. Freeze and document the field-to-FHIR mapping.
2. Replace facility-name relationships with stable facility IDs.
3. Create Pydantic models for the required FHIR resources and Bundle.
4. Add the central `POST /fhir` transaction endpoint.
5. Build Bundle parsing, reference resolution, and `OperationOutcome` errors.
6. Adapt the Mock Hospital's `send_referral.php` to generate the Bundle.
7. Implement `Task` status updates and retrieval.
8. Add terminology-backed dropdowns and backend code validation.
9. Add consent, attachments, and `Provenance`.
10. Add NIDAS integration after referral exchange and authorization are reliable.

## First Development Deliverables

Before modifying the live referral workflow, produce:

1. An approved field-to-FHIR mapping table.
2. A canonical transaction Bundle populated with realistic IRDSS data.
3. A list of required Philippine profiles and ValueSets.
4. A database migration proposal for stable facility and FHIR identifiers.
5. Validation rules and expected `OperationOutcome` responses.

These deliverables will become the shared contract for the Mock Hospital, central IRDSS, and future external HIS integrations.
