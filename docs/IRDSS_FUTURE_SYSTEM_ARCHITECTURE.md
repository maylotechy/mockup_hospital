# IRDSS Target System Architecture

## Purpose

This document presents the intended completed architecture of IRDSS. A healthcare facility may use the IRDSS Standalone Hospital System or continue using its own HIS/EMR. Both communicate through the central IRDSS Interoperability Layer (IOL) using FHIR R4 JSON over secured REST APIs.

The IOL is the referral exchange and orchestration platform. Ontoserver is used only for terminology search and validation; patient referrals are never sent to Ontoserver.

## Rendered diagrams

| Diagram | Mermaid source | SVG | PNG |
| --- | --- | --- | --- |
| IRDSS eReferral Interoperability Architecture - recommended for the DOST technical report | [`irdss-system-architecture.mmd`](architecture/irdss-system-architecture.mmd) | [`irdss-ereferral-interoperability-architecture.svg`](architecture/irdss-ereferral-interoperability-architecture.svg) | [`irdss-ereferral-interoperability-architecture-final.png`](architecture/irdss-ereferral-interoperability-architecture-final.png) |
| System context | [`irdss-system-context.mmd`](architecture/irdss-system-context.mmd) | [`irdss-system-context.svg`](architecture/irdss-system-context.svg) | [`irdss-system-context.png`](architecture/irdss-system-context.png) |
| Detailed component architecture - technical appendix | [`irdss-component-architecture.mmd`](architecture/irdss-component-architecture.mmd) | [`irdss-component-architecture.svg`](architecture/irdss-component-architecture.svg) | [`irdss-component-architecture.png`](architecture/irdss-component-architecture.png) |
| Referral sequence | [`irdss-referral-sequence.mmd`](architecture/irdss-referral-sequence.mmd) | [`irdss-referral-sequence.svg`](architecture/irdss-referral-sequence.svg) | [`irdss-referral-sequence.png`](architecture/irdss-referral-sequence.png) |
| Referral workflow | [`irdss-referral-workflow.mmd`](architecture/irdss-referral-workflow.mmd) | [`irdss-referral-workflow.svg`](architecture/irdss-referral-workflow.svg) | [`irdss-referral-workflow.png`](architecture/irdss-referral-workflow.png) |

## 1. Simplified System Architecture

This is the recommended primary architecture diagram for the DOST technical report. It follows the referral from either type of hospital system through the IOL in six steps.

![IRDSS eReferral Interoperability Architecture](architecture/irdss-ereferral-interoperability-architecture.svg)

Mermaid source: [`architecture/irdss-system-architecture.mmd`](architecture/irdss-system-architecture.mmd)

### Simplified flow

1. Doctors use either the IRDSS standalone application or their hospital's existing HIS/EMR.
2. In the target architecture, both systems convert the required referral data into the same signed FHIR R4 transaction Bundle following PH Core and PH eReferral requirements. The external HIS adapter and full standards conversion are marked as planned.
3. The IOL authenticates the facility and validates the Bundle. Planned terminology integration calls Ontoserver to expand ValueSets and search, look up, or validate SNOMED CT, LOINC, and UCUM codes. Planned central PSGC validation checks Philippine geographic codes.
4. The IOL stores the referral and audit history in PostgreSQL, with documents placed in protected storage.
5. The matching service identifies the most appropriate eligible and available receiving hospital.
6. The target standardized workflow uses `ServiceRequest` and `Task`; the current custom referral workflow, WebSocket, and polling continue operating during migration. Notifications return status updates to participating hospital systems.

## 2. System Context

```mermaid
flowchart LR
    subgraph PARTICIPANTS[Participating Healthcare Facilities]
        direction TB
        STANDALONE[IRDSS Standalone Hospital System]
        HIS[External Hospital HIS or EMR]
        ADAPTER[FHIR Integration Adapter]
        HIS --> ADAPTER
    end

    subgraph CENTRAL[Central IRDSS Platform]
        IOL[IRDSS Interoperability Layer]
        MATCH[Intelligent Referral Matching]
        WORKFLOW[Referral Workflow Management]
        NOTIFY[Notification Service]
        ADMIN[IRDSS Admin Console]
        IOL --> MATCH
        IOL --> WORKFLOW
        IOL --> NOTIFY
        ADMIN --> IOL
    end

    STANDALONE -->|POST FHIR transaction Bundle| IOL
    ADAPTER -->|POST FHIR transaction Bundle| IOL
    IOL -->|FHIR response and referral status| STANDALONE
    IOL -->|FHIR response, webhook or polling| ADAPTER

    ONTO[(Ontoserver Terminology Service)]
    NIDAS[NIDAS or Approved Identity Service]
    IOL -->|ValueSet expand, code lookup and validation| ONTO
    IOL -->|User identity verification when enabled| NIDAS

    NOTIFY -->|WebSocket notifications| STANDALONE
    NOTIFY -->|Webhook or API notification| ADAPTER
```

### Context rules

- Hospitals do not require direct system-to-system connections with every other hospital.
- Every participant connects to the central IOL using the same FHIR referral contract.
- An external hospital retains its existing HIS/EMR and adds a FHIR adapter.
- The standalone system includes its adapter in the Mock Hospital backend.
- Ontoserver receives terminology queries only, not patient demographics or complete referral Bundles.

## 3. Detailed Component Architecture

```mermaid
flowchart TB
    subgraph CLIENTS[Hospital Systems]
        direction LR
        SA_UI[Standalone Web Application]
        SA_API[Standalone PHP Backend]
        SA_DB[(Hospital MySQL Database)]
        EXT_HIS[External HIS or EMR]
        EXT_ADAPTER[External FHIR Adapter]

        SA_UI --> SA_API
        SA_API --> SA_DB
        EXT_HIS --> EXT_ADAPTER
    end

    subgraph IOL_PLATFORM[IRDSS Interoperability Layer]
        direction TB
        API[REST and FHIR API Gateway]
        SECURITY[Facility Authentication, Signature, Timestamp and Nonce Validation]
        IDEMPOTENCY[Idempotency and Duplicate Protection]
        FHIR_VALIDATOR[FHIR Bundle, Profile and Reference Validation]
        TERM_API[IOL Terminology API and Cache]
        REFERRAL[Referral Orchestrator]
        ROUTING[Routing and Matching Engine]
        WORKFLOW[ServiceRequest and Task Workflow]
        NOTIFICATIONS[Notification Dispatcher]
        AUDIT[Audit and Provenance Service]

        API --> SECURITY
        SECURITY --> IDEMPOTENCY
        IDEMPOTENCY --> FHIR_VALIDATOR
        FHIR_VALIDATOR --> REFERRAL
        FHIR_VALIDATOR --> TERM_API
        REFERRAL --> ROUTING
        REFERRAL --> WORKFLOW
        REFERRAL --> AUDIT
        WORKFLOW --> NOTIFICATIONS
    end

    subgraph DATA[Central Data Services]
        PG[(PostgreSQL Referral Database)]
        FILES[(Protected Document and Attachment Storage)]
        FACILITY[(Facility Registry, Capabilities and Availability)]
        CACHE[(Terminology and Application Cache)]
    end

    subgraph EXTERNAL[External Standards and Services]
        ONTO[(Ontoserver)]
        IDENTITY[NIDAS or Approved Identity Provider]
        PSGC[PSGC and Approved Reference Registries]
    end

    SA_API -->|HTTPS and FHIR JSON| API
    EXT_ADAPTER -->|HTTPS and FHIR JSON| API
    API -->|FHIR response| SA_API
    API -->|FHIR response| EXT_ADAPTER

    SECURITY --> IDENTITY
    TERM_API -->|Expand, lookup and validate| ONTO
    TERM_API --> CACHE
    ROUTING --> FACILITY
    FACILITY --> PSGC

    REFERRAL --> PG
    WORKFLOW --> PG
    AUDIT --> PG
    REFERRAL --> FILES

    NOTIFICATIONS -->|WebSocket| SA_UI
    NOTIFICATIONS -->|Webhook or polling fallback| EXT_ADAPTER
```

### Component responsibilities

| Component | Responsibility |
| --- | --- |
| Hospital adapter | Maps local records to and from the shared FHIR referral contract |
| API gateway | Exposes secured REST/FHIR endpoints and controls request access |
| Security service | Verifies the sending facility, signature, timestamp, nonce and user identity where required |
| FHIR validator | Validates transaction Bundles, profiles, identifiers and internal references |
| Terminology API | Searches and validates pinned ValueSets through Ontoserver and provides cached fallback results |
| Referral orchestrator | Stores the referral, connects its resources and coordinates downstream processing |
| Matching engine | Identifies eligible hospitals and ranks them according to capability, availability, location, load and acuity |
| Workflow service | Maintains `ServiceRequest`, `Task` and onward-referral state transitions |
| Notification service | Delivers WebSocket, webhook or polling-based status updates |
| Audit service | Records consent, provenance, status changes, reassessments and clinician overrides |
| PostgreSQL | Stores normalized central referral, FHIR identifier, workflow and audit data |
| Protected file storage | Stores consent forms and clinical attachments while PostgreSQL stores metadata and hashes |

## 4. End-to-End Referral Sequence

```mermaid
sequenceDiagram
    autonumber
    actor Doctor
    participant Sender as Sending Hospital System
    participant IOL as IRDSS IOL
    participant Term as IOL Terminology API
    participant Onto as Ontoserver
    participant Match as Matching Engine
    participant Receiver as Receiving Hospital System

    Doctor->>Sender: Open patient and create referral
    Sender->>Term: Search approved complaint, diagnosis or service ValueSet
    Term->>Onto: ValueSet expand with search filter
    Onto-->>Term: Matching standard concepts
    Term-->>Sender: System, code and official display
    Doctor->>Sender: Select codes and enter clinical narrative
    Sender->>Sender: Build FHIR transaction Bundle
    Sender->>IOL: POST signed FHIR referral Bundle

    IOL->>IOL: Authenticate facility and verify signature, timestamp and nonce
    IOL->>IOL: Check idempotency and duplicate identifiers
    IOL->>IOL: Validate Bundle structure, profiles and references
    IOL->>Term: Validate submitted terminology codes
    Term->>Onto: Validate code against pinned ValueSet version
    Onto-->>Term: Validation result
    Term-->>IOL: Validation result

    alt Bundle or terminology is invalid
        IOL-->>Sender: FHIR OperationOutcome with field-level issues
    else Referral is valid
        IOL->>IOL: Store original Bundle and normalized referral data
        IOL->>Match: Request eligible receiving facilities

        alt Triage level is 5
            Match->>Match: Apply deterministic emergency routing
            Note over Match: Select the most capable eligible and available facility without ordinary AI ranking
        else Triage level is 1 to 4
            Match->>Match: Rank eligible facilities using capability, availability, distance, load and acuity
        end

        Match-->>IOL: Recommended receiving facilities
        IOL->>IOL: Create or update ServiceRequest and tracking Task
        IOL-->>Receiver: Notify new referral through WebSocket or webhook
        IOL-->>Sender: Return accepted transaction and referral identifier

        Receiver->>IOL: Retrieve referral details
        IOL-->>Receiver: Patient, Encounter, Conditions, Observations and ServiceRequest
        Receiver->>IOL: Update Task to received
        IOL-->>Sender: Notify referral received

        alt Receiving hospital accepts
            Receiver->>IOL: Update Task to accepted
            IOL-->>Sender: Notify referral accepted
            Receiver->>IOL: Record patient arrival
            IOL-->>Sender: Notify patient arrived
            Receiver->>IOL: Complete referral or discharge patient
            IOL-->>Sender: Notify referral completed
        else Receiving hospital rejects or cannot provide service
            Receiver->>IOL: Reject with a coded and textual reason
            IOL->>Match: Recalculate eligible receiving facilities
            IOL-->>Sender: Notify rejection and updated recommendations
        else Patient is referred onward
            Receiver->>IOL: Submit a new linked FHIR referral Bundle
            IOL->>IOL: Preserve the original referral and create a linked onward referral
            IOL->>Match: Match the onward referral
            IOL-->>Sender: Notify that patient was referred onward
        end
    end
```

## 5. Referral Workflow States

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: Doctor sends referral
    Submitted --> Requested: IOL validates and creates Task
    Requested --> Received: Receiving facility opens or acknowledges
    Received --> Accepted: Facility accepts
    Received --> Rejected: Facility rejects
    Rejected --> Requested: IOL notifies or selects another facility
    Accepted --> Arrived: Patient reaches receiving facility
    Accepted --> ReferredOnward: Facility transfers referral onward
    Arrived --> Completed: Treatment or referral episode completed
    Arrived --> ReferredOnward: Further transfer is required
    ReferredOnward --> Requested: New linked referral begins
    Completed --> [*]
```

## 6. Core Exchange Contract

The hospital systems exchange only the required referral information:

- Patient demographics and stable identifiers
- Encounter information
- Chief complaint and clinical narrative
- Working diagnosis
- Vital signs
- Referral category, service type and detailed reason
- Triage acuity, referral priority and condition severity
- Referring and receiving facilities and practitioners
- Consent metadata and approved attachments
- `ServiceRequest`, `Task` and `Provenance`

The transport contract is:

```text
Protocol: HTTPS
API style: REST with FHIR R4 resources
Payload: application/fhir+json
Submission: POST transaction Bundle to the IRDSS IOL
Terminology: SNOMED CT, LOINC, UCUM, PSGC and approved ValueSets
Workflow: ServiceRequest plus Task
Authentication: signed facility request, with NIDAS or another approved identity provider when enabled
```

## 7. Mermaid CLI regeneration

The committed diagram sources can be regenerated with Mermaid CLI from the repository root:

```powershell
npx -p @mermaid-js/mermaid-cli mmdc `
  -i docs/architecture/irdss-system-context.mmd `
  -o docs/architecture/irdss-system-context.svg `
  -c docs/architecture/mermaid-config.json `
  -b transparent
```

Replace the input and output names to render the component, sequence, or workflow diagram. Use `.png` as the output extension and `-b white -s 1.5` for a presentation-ready PNG.

## 8. Mermaid Live usage

Open `https://mermaid.live`, copy one Mermaid code block from this document, paste it into the editor, and export the result as SVG or PNG. SVG is recommended for reports and presentations because it remains clear when resized.
