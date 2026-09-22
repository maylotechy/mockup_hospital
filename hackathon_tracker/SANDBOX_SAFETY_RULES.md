# FHIR Sandbox Safety Rules

**Read this in full before firing ANY request — GET included — against `FHIR_EREFERRAL_BASE_URL`, `FHIR_CORE_BASE_URL`, or `FHIR_TERMINOLOGY_BASE_URL`.** These servers are a public, shared, unauthenticated sandbox (`cdr.pheref.fhirlab.net`, `cdr.phcore.fhirlab.net`, `tx.fhirlab.net`) used by other Connectathon participants, not something mock_hospitals owns or controls. There is no undo button here — no delete access, no admin console, no "restore from backup." Every rule below exists to keep this tool from becoming the thing that corrupts or pollutes someone else's test data.

## Hard rules — no exceptions

1. **Never send `DELETE` to this sandbox.** Not on a resource we think we created, not "just to clean up a mistake." We have no way to distinguish our resource IDs from another participant's with certainty, and a wrong guess destroys someone else's work permanently.
2. **Never `PUT`/`PATCH` a resource by its raw numeric `id`** (e.g. `Patient/7637`) discovered via a `GET`/search. That ID could belong to any participant, past or present. The IG's own conditional-update pattern exists specifically to avoid this — see rule 4.
3. **Only write synthetic/test data. Never real patient data.** No real names, real PhilHealth/PhilSys numbers, real addresses tied to an actual person. Confirm with the user if a value's provenance is unclear before it goes in a write request.
4. **Writes must use conditional `PUT` by an identifier this project controls** (`PUT /{Resource}?identifier={system}|{value}`, per the README's Track 1 pattern), with a value that is unambiguously ours — see the naming convention below. Never let a write target land on an identifier we didn't generate ourselves.
5. **Every write (`POST`/`PUT`) needs the user's explicit go-ahead in that conversation turn** — not implied from earlier scoping talk. "Let's build the exporter" is not the same as "send it now." If it's ambiguous whether the user means to actually fire the request, ask.
6. **No bulk, no loops, no retries-in-a-loop against this sandbox.** It's shared infrastructure with other real participants using it concurrently; hammering it is inconsiderate even without malicious intent. One request, read the response, decide the next step deliberately.
7. **Claude must ask the user before firing ANY request itself — GET included** — every time, during building/debugging this integration (confirmed 2026-09-15, after Claude fired unapproved `GET`s while demonstrating the sandbox earlier). This applies to Claude's own exploratory/test requests (curl, a PHP one-liner, etc.), not to the deployed app: once the Send/Receive pages exist, a logged-in staff member clicking "Preview" or "Confirm & Send" in the UI *is* the go-ahead for that specific request, and the app can fire it without Claude separately asking first. When in doubt about which situation applies, ask.

## Naming convention for anything we write

Every resource this project ever creates on the sandbox must carry an identifier or name that's unmistakably ours, so it's identifiable later (by us or by the FHIRLab maintainers) and never collides with another team's data. Renamed 2026-09-15 from an earlier `MOCKHOSP-`/`MockHospitalsTest-` scheme to match the actual project branding (DiWA / IRDSS):

- Identifier `value` prefix: `DIWA-IRDSS-TEST-<ResourceType>-<shortId>` (e.g. `DIWA-IRDSS-TEST-PATIENT-1`, matching mock_hospitals' own `patients.id`)
- Human-readable names (`Patient.name.family`, `Organization.name`, `Practitioner.name`, etc.): prefix with `DiWA-IRDSS Test-` (e.g. family `"DiWA-IRDSS Test-Stark"`) so it's visually obvious in any search result, the same way the sandbox's own leftover data uses names like `PhCorePatientTest`.
- The `-TEST`/`Test` marker is load-bearing, not decorative -- it's what signals "synthetic data" to anyone (us, other participants, FHIRLab maintainers) who finds these resources later. Never drop it even if a future rebrand changes the `DIWA-IRDSS` part.

## Before every write, confirm out loud (in the response to the user)

- [ ] This is a `POST` (create) or conditional `PUT` by our own identifier — not a raw-ID `PUT`/`PATCH`, never `DELETE`.
- [ ] Every value in the payload is synthetic/test data.
- [ ] The identifier/name follows the `MOCKHOSP-`/`MockHospitalsTest` convention above.
- [ ] The user asked for this specific request to be sent, this turn.
- [ ] The request and its HTTP response get logged in [`TRACKER.md`](TRACKER.md) — method, URL, resource, identifier used, and status code — so there's a full audit trail of everything ever written to the sandbox.

## Log after every write

Append an entry to `TRACKER.md`'s dated log (method, resource + identifier, HTTP status, and one line on what it was for) immediately after the response comes back — success or failure. A stray write with no log entry is a lost audit trail, and this sandbox gives us no way to look it up after the fact.
