# FHIR Connectathon Integration: Team Takeaways

**Date:** September 16, 2026  
**Prepared by:** Development Team  
**Purpose:** Team discussion on FHIR architecture, integration lessons, and design decisions for the mock_hospitals ↔ FHIRLab Connectathon integration.

---

## 1. What is FHIR and Why It Matters

**FHIR (Fast Healthcare Interoperability Resources)** is a standard for exchanging healthcare data as **independent, linked resources** (not monolithic messages).

### Key Insight: Relational, Not Flat

**Old approach (flat message):**
```
One "Referral" blob:
  Patient Name: Tony Stark
  Doctor Name: Dr. Strange
  Hospital: DiWA Center
  Diagnosis: Appendicitis
  → Every referral repeats patient + doctor + hospital data
```

**FHIR approach (9 linked resources):**
```
Patient/23695: {name: Tony Stark, ...}
Practitioner/23476: {name: Dr. Strange, ...}
Organization/23405: {name: DiWA Center, ...}
ServiceRequest/23693: {
  subject: Patient/23695,     ← reference by ID
  requester: PractitionerRole/23688,  ← links to doctor
  performer: PractitionerRole/23689,  ← links to hospital
  ...
}
```

**Advantage:** Same doctor/hospital referenced from multiple referrals without duplication. Like a relational database, but as JSON over HTTP.

---

## 2. The 9-Resource Bundle: Structure & Purpose

Every referral we send is a **transaction Bundle** with 9 resources:

```
1. PATIENT          — Who is being referred
2. PRACTITIONER     — The referring doctor
3. PractitionerRole (SENDER) — Doctor's role at sending facility
4. PractitionerRole (RECEIVER) — Role at receiving facility
5. ENCOUNTER        — The clinical visit context
6. CONDITION        — Diagnosis (e.g., Appendicitis)
7. OBSERVATION      — Vitals (BP, temp, HR, RR, O2, weight)
8. SERVICE REQUEST  — THE ACTUAL REFERRAL (links to all above)
9. TASK             — Status tracking (initially "requested")
```

### Why Separate Resources?

1. **Deduplication** — Send same patient twice → sandbox finds existing Patient by identifier, updates it (no duplicate)
2. **Reusability** — Same doctor → same Practitioner resource, referenced from multiple ServiceRequests
3. **Standardization** — Any FHIR-compliant system can parse these without custom code
4. **Interoperability** — Receiving hospital can directly ingest into their database
5. **Incremental Updates** — Only changed resource needs resending

### Deep Dive: The 9 Resources Explained

The 9 resources fall into **three categories**:

#### Category 1: MASTER DATA (Reused Across Referrals)
These represent **people and organizations** — they exist once, updated when data changes.

| Resource | Purpose | Example | Updated? |
|---|---|---|---|
| **Patient** | Who is being referred | Tony Stark, DOB 1988-04-12 | ✓ Yes (address, contact) |
| **Practitioner** | Who is doing the referring | Dr. Stephen Strange | ✓ Yes (contact info) |
| **PractitionerRole (SENDER)** | Sender's role at their facility | Dr. Strange works at DiWA | ✓ Yes |
| **PractitionerRole (RECEIVER)** | Receiver's facility (performer) | Hospital XYZ | ✓ Yes |

#### Category 2: CLINICAL CONTEXT (Time-Specific Event)
These represent **when and what happened during the visit** — created once per visit/referral, never updated.

| Resource | Purpose | Example | Created Fresh? |
|---|---|---|---|
| **Encounter** | The clinical visit (when/where) | June 15, 2026, 9:00 AM at DiWA | ✓ Yes (new per visit) |
| **Condition** | Diagnosis (what's wrong) | Appendicitis (SNOMED code) | ✓ Yes (new per visit) |
| **Observation** | Vitals & measurements | Temp 38.2°C, BP 120/80 (LOINC codes) | ✓ Yes (new per visit) |

#### Category 3: THE REQUEST & TRACKING (The Referral Hub)
These represent **the request itself and its status** — created once per referral, rarely updated (only status changes).

| Resource | Purpose | Example | Fresh? |
|---|---|---|---|
| **ServiceRequest** | **THE ACTUAL REFERRAL** (links all above) | "Refer Tony to Hospital XYZ for surgery" | ✓ Yes (new per referral) |
| **Task** | Status tracking | Status = "requested" → "in-progress" → "completed" | ~ Status updates |

**Key Insight:** When you send the same patient 2 months later:
- `Patient/23695` is **UPDATED** with new address
- New `Encounter/23691` is **CREATED** (different visit)
- New `Observation` vitals are **CREATED** (different measurements)
- New `ServiceRequest/23694` is **CREATED** (different referral)
- Old data (`Encounter/23690`, `Observation` from June) is **UNTOUCHED**

### Mapping to Your FHIR: Send Test Form

```
Your Form Field                 →  FHIR Resource
├─ Patient Dropdown             →  Patient/23695
├─ Patient Details              →  (from Patient resource)
├─ Your login (Dr. Strange)      →  Practitioner/23476
├─ Your Facility (DiWA)          →  Organization + PractitionerRole (SENDER)
├─ Receiving Hospital            →  Organization + PractitionerRole (RECEIVER)
├─ Referral Category             →  ServiceRequest.category (Emergency/Outpatient)
├─ Service Type                  →  ServiceRequest.reasonCode (Consultation/Diagnostics/Procedure)
├─ Chief Complaint               →  Condition/23691 + ServiceRequest.note
├─ Vitals (BP, Temp, etc.)       →  Observation/23692 (6 LOINC-coded measurements)
└─ [Preview] [Confirm & Send]    →  POST bundle with all 9 resources

Sandbox Response                 ← IDs
├─ Patient/23695
├─ Practitioner/23476
├─ PractitionerRole/23688 (sender)
├─ PractitionerRole/23689 (receiver)
├─ Encounter/23690
├─ Condition/23691
├─ Observation/23692
├─ ServiceRequest/23693  ← STORE THIS
└─ Task/23694
```

---

## 3. Identifiers: The Key to Safe, Idempotent Sends

### The Problem Without Identifiers

```
SEND #1: POST Patient {name: "Tony", dob: "1988-04-12"}
         → Created: Patient/23695

SEND #2 (timeout, retry): POST same Patient
         → Created: Patient/23696 (DUPLICATE!)

SEND #3: POST same Patient again
         → Created: Patient/23697 (ANOTHER DUPLICATE!)
```

**Result:** 3 identical Patient records on sandbox. Chaos.

### The Solution: Conditional PUT by Identifier

```
PUT Patient?identifier=https://diwa-irdss.local/fhir/identifier/test|DIWA-IRDSS-TEST-PT-00001
  ↓
  Sandbox searches by identifier
  ↓
  IF found: Update it (200 OK)
  IF not found: Create it (201 Created)
  ↓
  Always same Patient ID (idempotent)
```

**Result:** Safe to send/retry infinitely. No duplicates. Data stays consistent.

### Our Identifier Strategy

```
System: https://diwa-irdss.local/fhir/identifier/test
Prefix: DIWA-IRDSS-TEST-
Value:  {ResourceType}-{LocalId}

Example: DIWA-IRDSS-TEST-PT-00001
         (Patient #1 in your local system)
```

**Key:** Identifier = local patient/doctor ID. So:
- Same patient in your system → always same identifier → always same resource on sandbox
- Send 2 months later? Same identifier → sandbox updates existing resource
- Different hospital sends same patient? Different identifier → different resource on sandbox (OK, they track their own copy)

---

## 4. Backend Endpoints: Different Workflows

We separated concerns into **7 backend endpoints**, each handling one business function:

| Endpoint | When? | Purpose |
|---|---|---|
| `fhir_send_referral.php` | User clicks "Confirm & Send" | Build 9-resource bundle, POST to sandbox, extract ServiceRequest ID |
| `fhir_poll_incoming_referrals.php` | Every 60s (auto) | Check if anyone sent us referrals (search by our Organization) |
| `fhir_get_referral_detail.php` | User clicks "View" | Multi-GET to fetch all 9 resources for one referral, display clinical detail |
| `fhir_save_incoming_patient.php` | User clicks "Save to Our Patients" | Map FHIR Patient back to local DB |
| `fhir_list_organizations.php` | Tab open, receives dropdown load | GET all orgs on sandbox (cached, 60s TTL) |
| `fhir_register_organization.php` | Tab open, on register action | PUT your facility as an Organization on sandbox, cache the ID |
| `fhir_connection_status.php` | Every 60s (auto, header badge) | GET your Organization (short timeout) to show "Connected" or "Unreachable" |
| `fhir_shared.php` | Helpers used by all above | Build resources, extract IDs, fetch clinical detail across 7+ resources |

**Why separate?** Each represents a different user action, permission level, error handling strategy, and timing.

---

## 5. Tracking & Audit: ServiceRequest ID is the Key

Every referral you send gets a **ServiceRequest ID** from the sandbox (e.g., `ServiceRequest/23693`).

### Local Tracking: `fhir_sent_referrals` Table

```sql
CREATE TABLE fhir_sent_referrals (
  id INT PRIMARY KEY,
  facility_id INT,
  patient_id INT,
  patient_name VARCHAR,
  service_request_id VARCHAR,  ← THE KEY (ServiceRequest/23693)
  receiving_org VARCHAR,
  receiving_org_display_name VARCHAR,
  sent_at TIMESTAMP
);
```

### What We Can Track

**Single query answers these:**

- "What referrals did DiWA send?"
  ```sql
  SELECT * FROM fhir_sent_referrals WHERE facility_id = 3;
  ```

- "What did we send to Hospital XYZ?"
  ```sql
  SELECT * FROM fhir_sent_referrals WHERE receiving_org = 'Organization/99999';
  ```

- "How many times did we send Tony Stark?"
  ```sql
  SELECT COUNT(*) FROM fhir_sent_referrals WHERE patient_id = 1;
  ```

- "Prove we sent this referral (for legal/compliance)."
  ```
  1. Pull fhir_sent_referrals row: ServiceRequest/23693, sent 2026-09-16
  2. Pull audit_logs: User=Dr. Strange, Action=FHIR_REFERRAL_SENT
  3. GET /fhir/ServiceRequest/23693 from sandbox: Confirm it exists
  4. Show the original bundle JSON that was sent
  ```

---

## 6. Two-Way Data Flow: Send vs. Receive

### SEND (You → Sandbox → Another Hospital)

```
User fills form
  ↓
App builds 9-resource bundle
  ↓
POST to sandbox (conditional PUTs by identifier)
  ↓
Sandbox responds with created IDs
  ↓
Extract ServiceRequest/23693, store locally in fhir_sent_referrals
  ↓
Other hospitals poll sandbox and see your ServiceRequest
```

### RECEIVE (Another Hospital → Sandbox → You)

```
Your app polls fhir_poll_incoming_referrals.php every 60s
  ↓
Search: ServiceRequest?performer={YourOrg}
  ↓
Find new referrals addressed to you
  ↓
Display them in "FHIR: Receive" tab
  ↓
Toast/badge notify staff
  ↓
Staff clicks "View" → Multi-GET all 9 resources
  ↓
Display full clinical picture
  ↓
Staff clicks "Save to Our Patients" → Map FHIR Patient to local DB
```

---

## 7. Caching Strategy: Smart Fetching

To avoid hammering the shared sandbox, we cache strategically:

| What | Where | TTL | Invalidated By |
|---|---|---|---|
| Organizations list | Memory (module closure) | 60s | Manual Refresh, after registration |
| Send history (local DB) | Memory | 60s | Manual Refresh, after send |
| Receive polling | Gap-based (10s min between re-fetches) | — | Background 60s poll, manual Refresh |

**Key:** Cache is in-memory only, clears on page reload. No stale localStorage risk.

---

## 8. Three Critical Lessons From Real Testing

### Lesson 1: Terminology Bindings Are Strict

Some FHIR fields require **real SNOMED/LOINC codes**, not text.

**Failed sends we caught:**
- `Patient.contact.relationship` → Required code `N` (Next-of-Kin), not text
- `PractitionerRole.code` → Required SNOMED (158965000=Doctor, 265937000=Nurse), not text
- `ServiceRequest.category` → Required codes (73770003=Emergency, 440655000=Outpatient)
- `ServiceRequest.reasonCode` → Required codes (Consultation/Diagnostics/Procedure/Others)

**Lesson:** Read the IG closely, or discover via real 422 errors.

### Lesson 2: Different Hospitals Address Differently

Real Connectathon traffic showed:
- Your system: `ServiceRequest.performer` → `PractitionerRole` → `Organization`
- Other hospitals: `ServiceRequest.performer` → `Organization` directly

**Lesson:** Don't assume one addressing style. Poll must search BOTH.

### Lesson 3: Network Timeouts Are Real

A 19-resource bundle on a shared sandbox can take 6+ minutes to validate.

**Lesson:** Idempotent identifiers + conditional PUTs are not optional — they're how you survive timeouts safely.

---

## 9. Architectural Decisions & Rationale

### Decision 1: Keep FHIR Separate from IOL/IRDSS

**Choice:** FHIR integration is a **fully separate code path**, not wired into existing `send_referral.php` (IOL flow).

**Why:** IOL uses custom-shaped FHIR with extensions, not PH Core/PH eReferral IG profiles. Merging would require rebuilding IOL itself (out of scope).

**Impact:** Two export flows, two sandbox targets, but zero risk of breaking the stable IOL system.

### Decision 2: Backend Endpoints Over Monolithic Send

**Choice:** 7 separate backend endpoints instead of one `fhir_gateway.php` doing everything.

**Why:** Each endpoint = one user workflow. Different error handling, permissions, timing. Easier to test, debug, and iterate.

### Decision 3: In-Memory Caching, Not Persistent

**Choice:** Cache in JS module closures, not localStorage/DB.

**Why:** Clears on page reload, no risk of stale data across sessions. Matches the app's existing pattern for other transient state.

### Decision 4: Local ServiceRequest ID Tracking

**Choice:** Store `ServiceRequest/{id}` in local `fhir_sent_referrals` table.

**Why:** Single source of truth for auditing. Users can ask "what did we send?" without querying the sandbox. Legal/compliance proof doesn't depend on sandbox availability.

---

## 10. What's Next: Roadmap for Discussion

### Phase 0 (✅ Done): POC Proof of Connection

- One-way export of referrals to sandbox
- 9-resource bundle structure validated
- Sandbox responds with IDs

### Phase 1 (In Progress): Complete Field Mapping

- Real SNOMED codes (not text placeholders)
- PhilHealth/PhilSys identifiers extracted
- Clinical data fully captured
- Audit trail complete

### Phase 2 (Future): Bidirectional Sync

- Receive referrals from other hospitals
- Display clinical detail locally
- Update `Task.status` as staff progresses
- Sync results back to sending hospital

### Phase 3+ (Future): Production Readiness

- Move from test sandbox to NHFR/production FHIR server
- Add encryption/signing (already have RSA infrastructure for IOL)
- Compliance review (legal, DPA, privacy)
- Staff training
- Rollout to network hospitals

---

## 11. Key Takeaways for the Team

1. **FHIR is relational, not flat** — Resources link by ID, avoiding duplication
2. **Identifiers make it safe** — Conditional PUTs are idempotent, survive retries
3. **9 resources, 1 ServiceRequest** — That ID is your audit trail
4. **Separate concerns** — 7 endpoints, each does one thing well
5. **Real testing beats theory** — 422 errors taught us what "required binding" means
6. **Cache strategically** — Shared sandbox needs respect; poll every 60s, not every second
7. **Track locally** — Your own DB is the source of truth, not the sandbox
8. **Build incrementally** — Phase 0 (send), Phase 1 (complete data), Phase 2 (receive), Phase 3+ (production)
9. **Build coded dropdowns from their official ValueSets** — Do not invent options or send display
   text alone. Retrieve the allowed `system`, `code`, and `display` values from the terminology
   server's `ValueSet/$expand` operation, cache them locally, and validate the selected code again
   on the backend.

### Terminology rule for dropdowns

This rule applies to dropdowns representing a **FHIR coded element**, not every dropdown in the
user interface. Patient, practitioner, and receiving-hospital selectors choose actual FHIR
resources or local records; their options do not come from SNOMED CT.

| Coded field | Authoritative source | Typical coding system |
|---|---|---|
| Practitioner role (`PractitionerRole.code`) | `https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role` | SNOMED CT |
| Referral category (`ServiceRequest.category`) | `https://www.fhir.doh.gov.ph/pheref/ValueSet/referral-category` | SNOMED CT |
| Reason for referral / service type (`ServiceRequest.reasonCode`) | `https://www.fhir.doh.gov.ph/pheref/ValueSet/reason-for-referral-service-type` | SNOMED CT |
| PWD disability type | `https://fhir.doh.gov.ph/pheref/ValueSet/pwd-disability-type-vs` | Use whatever systems the expansion returns |
| Administrative gender | `http://hl7.org/fhir/ValueSet/administrative-gender` | Base FHIR codes, not SNOMED CT |
| Task status | `http://hl7.org/fhir/ValueSet/task-status` | Base FHIR codes, not SNOMED CT |
| Referral priority (`ServiceRequest.priority`) | FHIR `request-priority` codes | Base FHIR codes (`routine`, `urgent`, `asap`, `stat`), not SNOMED CT |

Example terminology request:

```http
GET https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role
```

The application should save and transmit the complete coding selected from the expansion:

```json
{
  "system": "http://snomed.info/sct",
  "code": "158965000",
  "display": "Doctor"
}
```

The current prototype already maps Doctor and Nurse to codes from this Practitioner Role
ValueSet. A production-ready implementation should load/cache the official expansion so newly
added or revised allowed roles do not require editing hard-coded frontend options.

### Ontoserver and Shrimp: what each one is for

**Ontoserver** is the terminology server. It hosts and processes healthcare terminologies,
CodeSystems, and ValueSets used by the FHIR profiles. Our application can call its FHIR API at
`https://tx.fhirlab.net/fhir` to:

- use `ValueSet/$expand` to obtain the allowed choices for a coded dropdown;
- use `ValueSet/$validate-code` to verify that a submitted system/code is allowed; and
- use `CodeSystem/$lookup` to retrieve details about a particular code.

**Shrimp** is the human-facing terminology browser connected to Ontoserver. It lets developers,
clinicians, and analysts visually search concepts, inspect hierarchies, and see which codes and
display names belong to a ValueSet. This is useful while designing and reviewing dropdowns.

The application should **not scrape dropdown values from the Shrimp web page**. Shrimp is for
people to explore the terminology; the application should retrieve the same authoritative values
from Ontoserver's FHIR API, cache the expansion, and retain a reviewed fallback for temporary
terminology-server outages.

In short:

```text
PH eReferral profile says which ValueSet is required
        ↓
Ontoserver expands and validates that ValueSet for the application
        ↓
The application displays the returned code + display as dropdown options

Shrimp provides a visual browser so people can inspect those same concepts
```

This means “use official FHIR dropdown values” does not mean every option is a FHIR-defined or
SNOMED code. It means following the binding declared by the relevant FHIR profile: the selected
ValueSet may contain SNOMED CT, LOINC, base FHIR, or Philippine-specific codes. Always preserve
the full `system`, `code`, and `display` combination.

### How Ontoserver supports IRDSS

Ontoserver is useful to an intelligent referral system, but it is the **terminology service**, not
the referral recommendation engine. It gives IRDSS standardized codes and allowed values for
referral categories, practitioner roles, diagnoses, procedures, service types, disability types,
and other coded clinical fields. This reduces inconsistent free text and gives the routing logic
cleaner, interoperable data to evaluate.

IRDSS remains responsible for the intelligence and operational decisions, including:

- checking hospital services, specialists, beds, equipment, and current availability;
- considering severity, location, distance, and estimated travel time;
- applying referral rules and exclusions; and
- ranking or recommending appropriate receiving hospitals.

The intended relationship is:

```text
Referral form
    ↓
Ontoserver supplies and validates standard codes
    ↓
IRDSS evaluates capability, availability, severity, and location
    ↓
FHIR adapter sends the standardized referral
    ↓
Receiving hospital
```

For the prototype, required ValueSet expansions should be cached with reviewed local fallback
values. For production, synchronize those ValueSets periodically instead of contacting Ontoserver
every time a user opens a form.

---

## 12. Discussion Points for Team

1. **Scope of deployment:** Are we targeting the test sandbox first, or jumping to NHFR/production?
2. **Staff readiness:** Do nurses/doctors understand what "referred via FHIR" means? Training needed?
3. **Network hospitals:** Which hospitals should we pilot with? Do they have FHIR infrastructure?
4. **Data privacy:** Are we confident about sending PHI to a shared public sandbox, even with test identifiers?
5. **Compliance:** Have we checked with DPA/legal about the identifier system and audit trail?
6. **Integration with IOL:** Should Phase 2/3 eventually converge (both send and receive via same system)?
7. **Rollback plan:** If something breaks in production, how do we safely stop using FHIR?

---

## References

- `hackathon_tracker/TRACKER.md` — Detailed decision log (29 entries)
- `hackathon_tracker/SANDBOX_SAFETY_RULES.md` — Safety rules for sandbox interaction
- `connectathon/HL7-FHIR-Connectathon/CODEX.md` — What the Connectathon event is
- `connectathon/HL7-FHIR-Connectathon/README.md` — Original event materials

---

**Prepared:** September 16, 2026  
**Next Review:** TBD (after team discussion)
