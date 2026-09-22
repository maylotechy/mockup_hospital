# Hackathon Tracker

Running log of decisions and changes for the **mock_hospitals ↔ HL7 FHIR Connectathon** integration work. Newest entry on top. This file exists so Codex (or anyone picking this up cold) can follow the history without re-deriving it — read this before touching anything related to the FHIR/Connectathon integration.

> ⚠️ **Before sending ANY request to the FHIR sandbox — read [`SANDBOX_SAFETY_RULES.md`](SANDBOX_SAFETY_RULES.md) first, every time.** It's a shared public server with no delete/undo available to us. This is not optional and not a one-time read.

Related reading:
- [`connectathon/HL7-FHIR-Connectathon/CODEX.md`](../connectathon/HL7-FHIR-Connectathon/CODEX.md) — what the Connectathon event and sandbox are
- [`connectathon/HL7-FHIR-Connectathon/README.md`](../connectathon/HL7-FHIR-Connectathon/README.md) — original event materials (tracks, data dictionary, servers)

---

## 2026-09-16 (32) — Complete Refer Onward flow with receiving-hospital selection

**Status:** Code complete and locally linted; no sandbox request was made while implementing or testing it.

The **Refer Onward** action now opens a modal where staff can review the patient/source referral and choose a different receiving Organization from the existing shared Organization cache. The current facility is excluded. Changing the destination invalidates the previous preview, and **Confirm & Send** remains disabled until the new transaction Bundle has been previewed. A second warning dialog explicitly confirms the real public-sandbox write.

Added `backend/fhir_forward_referral.php`. It re-fetches the source referral server-side, verifies that it was addressed to the logged-in facility, verifies the selected Organization exists, and rejects choosing the current facility. It never updates the received referral. Instead it creates a new profiled `ServiceRequest`, `Task`, and `Provenance`, plus project-owned test Practitioner/PractitionerRole resources. The new ServiceRequest links to the original through `basedOn` and references the same existing Patient, Encounter, Conditions, Observations, Procedures, and DiagnosticReports, so the clinical data is carried forward without duplicating or altering it. The endpoint supports `dry_run: true` for preview and records a local audit event only after a successful confirmed send.

`fetchFhirReferralDetail()` now also returns `source_organization_ref`, allowing the chooser to label the original sender. The FHIR Receive description and JavaScript cache version were updated accordingly.

---

## 2026-09-16 (31) — Refer Onward action added to the FHIR Receive table

**Status:** UI scaffold complete; no sandbox write and no onward-referral Bundle is sent yet.

Added a **Refer Onward** button beside **View** in every FHIR Receive DataTable row. Selecting it records the row's `service_request_id`, opens the existing complete referral-detail panel for clinical review, displays an informational toast, and dispatches a `fhir:refer-onward:selected` browser event carrying `{ serviceRequestId }`. That event is the stable hand-off point for the next implementation step: the receiving-organization selector, new onward reason/current clinical data, Bundle preview, and confirmed send.

The button deliberately does not reuse or mutate the original referral and does not contact the sandbox beyond the existing detail GET triggered for review. The future send must create a new ServiceRequest linked to the original referral.

---

## 2026-09-16 (33) — ServiceRequest.priority now sent (routine/stat)

**Status:** Code complete. Small, prompted by a user question about whether `priority` was SNOMED or a value set (it's neither -- FHIR's own built-in `request-priority` CodeSystem, `http://hl7.org/fhir/request-priority`, type `code` not CodeableConcept).

- New `fhirReferralPriority()` in `fhir_shared.php` -- a 2-value map (`emergency` -> `stat`, everything else -> `routine`), not a lookup, since that's all mock_hospitals' `referral_category` field ever produces.
- Wired into `ServiceRequest.priority` in `fhir_send_referral.php`, right next to `.category`. Was previously only ever read (never sent) -- `fhir-connectathon-receive.js:315` already displayed `sr.priority` on incoming referrals from other teams, but our own outgoing bundles never populated it.

---

## 2026-09-16 (32) — NHFR-based Organization search + new "FHIR: Patients" tab

**Status:** Code complete, not yet exercised live. Scoped with the user first (asked about a referral tracking/timeline feature -> investigation found one already exists locally for the IOL flow but nothing analogous for FHIR-sent referrals, which led into three separate raw-FHIR-interaction asks the user had queued up: generic Patient search, Organization search-by-NHFR, and Patient read-by-id -> scoped as two concrete workflow features -> approved).

**New:** `FHIR_NHFR_ID_SYSTEM` constant in `fhir_shared.php` (`https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code`, the REAL PH National Health Facility Registry identifier system from the official Connectathon Postman collection -- confirmed by grepping `connectathon/HL7-FHIR-Connectathon/ph-ereferral-collection/`, not invented). Deliberately separate from `FHIR_TEST_ID_SYSTEM` -- mock_hospitals has no NHFR code of its own to register under, this only searches for *other*, real, already-registered facilities.

1. **"Search by NHFR Code" on FHIR: Organizations** -- new endpoint `fhir_search_organization_by_nhfr.php` (`GET Organization?identifier={FHIR_NHFR_ID_SYSTEM}|{code}`, unencoded per the existing `buildDiwaOrganizationResource()` convention -- `sendFhirRequest()` does no encoding of its own). New search box + result card in the tab, each result gets a **"Use as Receiving Organization"** button that jumps to the Send Test tab and pre-selects that org -- this is what actually replaces scrolling the full 200+-org list or falling back to the placeholder, not just a dead-end lookup.
   - This hand-off has a real async race: switching tabs fires the Send tab's own `init()` -> `loadReceivingOrgs()` concurrently with the explicit selection call, and either can resolve last. Fixed with a monotonic sequence-number guard in `fhir-connectathon-send.js`'s `loadReceivingOrgs()` (`receivingOrgsLoadSeq`) -- a resolved call only touches the DOM if it's still the most recent one issued, and `selectReceivingOrg(orgRef, name)` (now exposed on `window.FhirConnectathonSend`) also injects the option if the picked org wasn't already in the cached list, so the hand-off doesn't depend on it being present there.

2. **New "FHIR: Patients" tab** (browse only, explicitly NOT a duplicate-prevention gate -- said so in the tab's own banner, since our sends already dedupe via our own identifier and a different team's same-named patient is still a separate record here):
   - `fhir_search_patients.php` -- `GET Patient?_count=20&_sort=-_lastUpdated`, same DataTable/skeleton-loader conventions as the other three FHIR tabs.
   - `fhir_get_patient.php` -- `GET Patient/{id}`, for a "Look Up by ID" box on the same tab (pairs with browse -- paste a known id from elsewhere instead of paging through the list).
   - New shared helper `fhirSimplifyPatient()` in `fhir_shared.php` (id/name/dob/gender/identifiers), matching the existing Organization-simplification shape convention from `fhir_list_organizations.php`.
   - New `frontend/js/fhir-connectathon-patients.js`, new sidebar nav entry, new `switchTab('fhirPatients')` branch and `$allTabs` entry in `app.js` -- same IIFE-module/lazy-`init()` pattern as every other FHIR tab.

**Next step when resumed:** none of this has touched the live sandbox yet -- the NHFR search, the Patient browse, and the id lookup all need a real exercise against `cdr.pheref.fhirlab.net` before relying on them.

---

## 2026-09-16 (31) — "Referring Practitioner" picker on the Send Test form

**Status:** Code complete, not yet exercised live. Scoped with the user first (asked "why is it optional" about Receiving Organization -> led into "can we choose who the practitioner is" -> scoped -> approved as written).

Previously the sending `Practitioner`/`PractitionerRole` in the bundle was always hardcoded to whoever was logged in (`getLoggedInUser()`) -- no way to submit on a colleague's behalf.

- **New endpoint** `backend/fhir_list_practitioners.php` -- read-only, returns `doctor`/`nurse` users at the caller's own `facility_id` (`is_active = 1`), each flagged `is_self`. Deliberately NOT a reuse of `manage_users.php`, which is `requireRole(['facility_admin'])`-gated; the Send Test tab is open to any doctor/nurse (facility_admin can't even see it -- `data-nav-role="staff"` hides it from admins), so it needed its own narrow endpoint.
- **Form**: new "Referring Practitioner" `<select name="practitioner_id">` on `#fhirSendForm`, between Patient and Receiving Organization. `fhir-connectathon-send.js`'s new `loadPractitioners()` populates it and pre-selects whichever option came back `is_self: true` -- so nothing changes for the common case of a doctor/nurse sending their own referral.
- **Backend**: `fhir_send_referral.php` now resolves `practitioner_id` (defaulting to the logged-in user's own id if omitted) against `users` scoped to the caller's own `facility_id` and `role IN ('doctor','nurse')`, 400s if it doesn't resolve. Critically, this is kept **separate from `$user`**: `buildFhirReferralTestBundle()`'s second parameter was renamed `$practitioner` and now drives the Practitioner identifier/name/PractitionerRole.code, while `$user` (the actual logged-in session) is still what `logAuditEvent()` and `fhir_sent_referrals.created_by_user_id` record. A nurse submitting on a doctor's behalf is traceable to the nurse in the local audit trail; the FHIR resource correctly names the doctor.
- Scoped out for now (available as a fast follow-up if wanted): attaching `users.license_number` as a Practitioner identifier -- the picked row already carries it, just isn't used yet.

**Next step when resumed:** nobody has run Preview/Confirm & Send with a non-self practitioner selected yet.

---

## 2026-09-16 (30) — Loading skeletons for all 6 DataTables

**Status:** Code complete, all touched files pass `node --check`. User asked for this generically ("on datatable, if data is still loading, display a skeleton loading"), so applied to every DataTable in the app, not just the FHIR tabs.

New shared helper `frontend/js/table-skeleton.js` (loaded early, right after the DataTables JS libs) — `window.TableSkeleton.renderRows(tbodySelector, columnCount, rowCount)` fills a `<tbody>` with plain placeholder `<tr>`s (pulsing gray bars of varying width, matching the `animate-pulse`/`bg-slate-200` style the Receive tab's detail panel already used for its own loading state). Deliberately never handed to `.DataTable()` itself — only the real render functions call that — so a skeleton row can never be mistaken for data, paginated, or searched.

Wired into all 6 tables, each with a trigger matched to how that table actually loads:
- **Patient Records / My Referrals / System Logs** (`app.js`): skeleton shown on every load. Patients and Logs previously had ad-hoc Bootstrap-spinner/`animate-spin` placeholders — replaced with the shared skeleton for consistency. My Referrals had no loading state before at all.
- **FHIR: Send history** (`fhir-connectathon-send.js`): only shown on an actual cache-miss fetch, not when `loadSentHistory()` serves from its 60s in-memory cache (see entry 29) -- otherwise every cache hit would flash a skeleton for no reason.
- **FHIR: Organizations** (`fhir-connectathon-organizations.js`): shown at the start of every `loadOrganizations()` call. A cache hit resolves near-instantly so the flash is a single frame at most; not worth threading cache-hit/miss state through just to suppress it.
- **FHIR: Receive** (`fhir-connectathon-receive.js`): gated behind the existing `firstLoad` flag -- only the very first `poll()` shows a skeleton. The background 60s auto-poll and manual Refresh both call the same `poll()` but must *not* blank out already-good rows out from under the user mid-session.

Not touched: Manage Users, Pending Referrals, Incoming Patients tabs -- none of them use `<table id="...">` + `.DataTable()`, they're a different markup pattern.

---

## 2026-09-16 (29) — In-memory caching for the Send/Receive/Organizations DataTables

**Status:** Code complete, all three files pass `node --check`. Scoped with the user first (asked "is it possible" -> gave tradeoffs -> user asked for a written scope -> approved with "go as long as it will not ruin the system").

Goal: avoid re-fetching from the backend (and, worse, the shared sandbox) every single time one of these three tabs is re-opened, since `init()` on each module previously did that unconditionally.

1. **Organizations tab** (`fhir_list_organizations.php`, ~200 orgs, the heaviest of the three): `fhir-connectathon-organizations.js` gained a shared `getOrganizations(forceRefresh)` — an in-memory `{organizations, fetchedAt}` cache with a 60s TTL, exposed on `window.FhirConnectathonOrgs`. `fhir-connectathon-send.js`'s receiving-org dropdown now calls this instead of fetching `fhir_list_organizations.php` itself (previously fetched separately in both files on every tab-switch) -- with a defensive direct-fetch fallback if that module somehow isn't loaded. Manual Refresh and a just-completed registration both pass `forceRefresh=true`; the registration success handler now **awaits** `loadOrganizations(true)` before calling `FhirConnectathonSend.init()`, specifically to avoid a race where the dropdown could otherwise read the pre-registration cache if it ran before the forced refresh resolved.

2. **Send tab's "Previously Sent Referrals"** (`fhir_get_sent_referrals.php`, local DB only): same TTL-cache pattern (60s), invalidated (forced) by Refresh and immediately after a referral is actually sent.

3. **Receive tab**: deliberately *not* a TTL cache -- it already has its own new-referral diffing state (`seenServiceRequestIds`/`firstLoad`), and layering a separate cache on top risked corrupting that (re-flagging seen referrals as new, or masking a real new one). Instead, added a `lastPolledAt` timestamp and a 10s minimum re-fetch gap: re-opening the tab within 10s of the last poll just re-renders, it doesn't fire another GET. The background 60s auto-poll (`startPolling()`) and the manual Refresh button are both untouched and always hit the sandbox live.

All caches are in-memory only (plain JS closures over module state), not `localStorage` -- clears on page reload, no risk of stale data surviving across sessions.

---

## 2026-09-16 (28) — Header badge: live FHIR sandbox connection status

**Status:** Code complete, linted. Confirmed with the user first that this means the deployed app will fire an automatic background request to the sandbox every ~60s (not just on user clicks) before building it -- user chose "live reachability" over the no-network "registration-only" alternative.

User asked whether the header (next to the "Level 1 Hospital" tier badge) could show whether the facility is currently connected to the FHIR sandbox or not.

**What it shows**, as a small pill next to `#sidebarFacilityTier`:
- **Not Registered** (gray) -- facility has no cached `fhir_organization_id` yet (see FHIR: Organizations tab). No network call needed for this state.
- **Connected** (green) -- registered, and a GET of our own Organization on the sandbox just succeeded.
- **Unreachable** (red) -- registered, but that GET failed or timed out.

**Backend:** new `backend/fhir_connection_status.php` -- reads the facility's cached `fhir_organization_id` (pure DB read); if present, does a single `GET {orgRef}` against the sandbox. Uses a short 6s timeout, not the usual 60s used for transaction Bundle sends -- this runs unattended on every poll cycle, so it should fail fast against a slow sandbox rather than hold connections open. `sendFhirRequest()` in `backend/config.php` gained an optional `$timeoutSeconds` param (default 60, unchanged for every existing caller) to support this.

**Frontend:** new `frontend/js/fhir-connectathon-status.js` (`FhirConnectathonStatus.init()`), same module-per-concern pattern as the other `fhir-connectathon-*.js` files -- kept out of `app.js` entirely except for one `init()` call from `showDashboardView()`. Unlike the Receive tab's poller (which only starts once that tab is opened), this one starts as soon as the dashboard loads and keeps running regardless of which tab is active, on the same gentle 60s cadence as the Receive poll (rule 6: no hammering a shared public sandbox).

---

## 2026-09-16 (24) — Real bug found and fixed: polling missed referrals addressed via a direct Organization reference

**Status:** Fixed, linted. Confirmed the underlying gap was real (not hypothetical) using live sandbox data before writing any code.

**How it was found:** a long manual debugging session (all user-approved GETs) tracing a real other Connectathon participant's ("Baguio General Hospital and Medical Center", automated `R12-TEAM01` test traffic) referrals to figure out why the user's FHIR: Receive tab wasn't showing anything from them. Along the way: discovered a second, unrelated Organization that happens to also display as "DiWA Center" (`Organization/23530`, using the real NHFR identifier system with a placeholder value `DOH-R12-RECV-TEST` -- a different org entirely, not registered by this user) which Baguio's script had been targeting instead of the user's real `Organization/23405`. Eventually Baguio's script *did* send one correctly addressed to `Organization/23405` (`ServiceRequest/23645`) -- and it was invisible to our poll.

**Root cause:** `ServiceRequest.performer` on that referral was `{"reference": "Organization/23405"}` -- a **direct** Organization reference. Our own adapter always builds `.performer` pointing at a `PractitionerRole` (which in turn points at the Organization) -- so `fhir_poll_incoming_referrals.php`'s search (`ServiceRequest?performer=PractitionerRole/...`) only ever looked for that shape and would silently miss anyone who addresses an Organization directly, which is equally valid FHIR. This is exactly the gap flagged as a possibility back when this feature was first built (see entry 19's note: "if whoever sent it built their bundle differently... our poll wouldn't find it") -- now confirmed with real traffic instead of being theoretical.

**Fix:** `fhir_poll_incoming_referrals.php`'s `ServiceRequest?performer=` search now includes our own `Organization` reference directly alongside the `PractitionerRole` references, in the same comma-separated OR query -- no extra request needed, one search now covers both addressing styles. Also hardened `fhir_shared.php`'s `fetchFhirReferralDetail()` the same way: `.requester` resolution now checks whether the reference is a `PractitionerRole` (resolve one hop to its org, as before) or an `Organization` directly, instead of assuming only the former.

---

## 2026-09-16 (27) — Vitals always show all 6 (LOINC-matched, "--" when missing); panel restructured into cards

**Status:** Code complete, linted, and locally verified (Node test against the actual Baguio observation data -- Blood Pressure correctly shows "180/110 mmHg", the other 5 correctly show "--").

Two complaints from the user about entry (26)'s new detail panel: vitals the sender didn't include (Temp, HR, etc.) just silently didn't appear at all rather than showing as missing, and the overall panel looked cluttered (one long stack of label/value pairs with thin divider lines between sections).

**Vitals fix**: replaced `renderObservations()`'s old approach (render whatever Observations happen to be present) with a **fixed list of 6 standard vitals** (Blood Pressure combined into one Systolic/Diastolic tile, Heart Rate, Respiratory Rate, Temperature, Oxygen Saturation, Weight) matched by **LOINC code** (`findQuantityByLoinc()`, checking both top-level `Observation.valueQuantity` and BP-style `.component` entries) rather than by whatever text happened to be sent -- so it's robust to differently-worded `.code.text` values from other senders. Every tile always renders; missing ones show `--` instead of just not existing.

**Layout fix**: `frontend/index.html`'s detail panel restructured from one flat stack with `border-t` divider lines into six separate `bg-slate-50` cards (Patient / Referral / Vitals / Conditions / Procedures / Diagnostic Reports / Task), each with its own header -- matches the app's existing card convention (e.g. the Patient Details card on the Send Test tab) instead of inventing a new pattern. `renderConditions()`/`renderProcedures()`/`renderDiagnosticReports()` simplified from bordered per-item boxes to compact single-line-per-item text (still returning a plain `--` when the list is empty, consistent with every other field on the panel).

---

## 2026-09-16 (26) — Receive detail panel now shows the full clinical picture, not just patient demographics

**Status:** Code complete, linted, and locally tested (rendering helpers run against Node with the actual Baguio referral data the user pasted -- correct output for category/reason/note and the BP-panel-to-systolic/diastolic split).

Prompted by the user getting a real referral detail response back (confirming entry 24's fix worked) and asking to see everything, not just the patient fields the panel showed before.

**`frontend/index.html`**: detail panel content gained five new sections between the existing Patient grid and the raw JSON dump: **Referral** (category/priority/status/authoredOn/reason/note), **Conditions/Diagnoses**, **Vitals/Observations**, **Treatment/Procedures**, **Laboratory/Diagnostic Reports**, **Task Status**.

**`frontend/js/fhir-connectathon-receive.js`** gained rendering helpers: `codeableConceptText()`/`codeableConceptListText()` (best-effort display from a FHIR CodeableConcept: `.text`, else first `.coding[].display`), `renderConditions()`, `renderObservations()` (handles both a single `.valueQuantity` observation and a multi-`.component` one like the BP panel -- splits it into separate Systolic/Diastolic lines), `renderProcedures()`, `renderDiagnosticReports()`. `viewDetail()` now populates all of these from the same `fetchFhirReferralDetail()` response that was already being fetched -- no new backend calls needed, this was purely about actually using data the endpoint already returned.

---

## 2026-09-16 (25) — Loading skeleton for the Receive tab's "View" detail panel

**Status:** Code complete, linted.

Added `#fhirReceiveDetailSkeleton` (a `animate-pulse` placeholder matching the real content's layout: name/gender-dob/phone/address/identifiers/source-org fields plus a tall block standing in for the JSON viewer) as a sibling to the existing `#fhirReceiveDetailContent` inside the detail panel. `viewDetail()` in `fhir-connectathon-receive.js` shows the skeleton and hides the real content the moment the panel opens, then swaps them back once the fetch resolves successfully -- the error path still just hides the whole panel (unchanged), so there's no risk of the skeleton being left stuck visible.

---

## 2026-09-15 (23) — Local "Previously Sent Referrals" history, with the chosen receiving facility

**Status:** Code complete, linted, and locally unit-tested (`fhirExtractCreatedRef()` against a simulated transaction-response Bundle -- correct). Not yet exercised live.

User asked to see the referrals we've sent, including which receiving org was picked -- the send-side counterpart to entry (19)'s receive-side history table. Unlike the receive side, this doesn't need to poll the sandbox at all: `fhir_send_referral.php` already knows everything at send time, so it just needed to record it locally.

**DB migration:** new `fhir_sent_referrals` table (`facility_id`, `patient_id`, `patient_name`, `service_request_ref`, `receiving_org_ref`, `receiving_org_name`, `referral_category`, `service_type`, `reason_text`, `http_status`, `created_by_user_id`, `created_at`).

**`fhir_shared.php` gained `fhirExtractCreatedRef($requestBundle, $responseBundle, $resourceType)`** -- finds the real server-assigned reference (e.g. `"ServiceRequest/23498"`) for one resource type by matching entry position between the request and transaction-response Bundles (FHIR guarantees the response is in the same order as the request) and reading that entry's `response.location`. This is also just generally useful infrastructure -- the exact mechanism needed for entry (21)/(22)'s earlier debugging (finding what a send actually created) is now a reusable function instead of a one-off manual lookup.

**`fhir_send_referral.php`**: on a successful (non-dry-run) send, extracts the real `ServiceRequest` ref via the function above and inserts one row into `fhir_sent_referrals` -- wrapped in its own try/catch so a local-history write failure never blocks the actual response, same principle as `send_referral.php`'s IOL-side local persistence. Also now accepts `receiving_org_display_name` from the frontend (avoids an extra GET to resolve the org's name after the fact -- the frontend already has it from the dropdown).

**New file:** `backend/fhir_get_sent_referrals.php` -- local-only read (no sandbox contact), facility-scoped, last 100 rows.

**Frontend:** new "Previously Sent Referrals" table on the Send Test tab (same DataTable convention as everywhere else), refreshed automatically after every successful send and via a manual Refresh button. `fhir-connectathon-send.js`'s receiving-org `<select>` now stashes each org's plain name in a `data-name` attribute when populating the dropdown, read back at submit time as `receiving_org_display_name`.

**Verified locally**: `fhirExtractCreatedRef()` correctly matches request/response entries by position and parses `"ServiceRequest/23498/_history/1"` down to `"ServiceRequest/23498"`; returns `null` cleanly for a missing resource type or a null response (e.g. dry_run).

---

## 2026-09-15 (22) — Fixed the remaining 422s: ServiceRequest.category/reasonCode, and a real field-meaning mismatch

**Status:** Fixed and verified locally against `buildFhirReferralTestBundle()`. Not yet re-sent to confirm the 422 is fully gone.

Same referral, re-sent after entry (21)'s fix -- still 422, now down to exactly two `error`-severity issues, both on `ServiceRequest`:
1. `.category[0]` -- required binding to "Referral Category VS".
2. `.reasonCode[0]` -- required binding to "Reason for Referral (Service Type) VS".

**Looked up both real expansions (with the user's go-ahead for the GETs) before touching anything:**
- `referral-category` VS has **only 2 codes** -- SNOMED `73770003` Emergency / `440655000` Outpatient. Our form's 3-option Emergency/Urgent/Routine dropdown had no clean 3-to-2 mapping, so the options themselves changed to match the real value set exactly, rather than guessing which of Urgent/Routine should collapse into which code.
- `reason-for-referral-service-type` VS has 4 codes -- Consultation/Diagnostics/Procedure/Others (SNOMED `11429006`/`165197003`/`71388002`/`3457005`). **This revealed a real field-meaning mismatch, not just a missing code**: despite its name, this value set is a *service-type* categorization, not a clinical/capacity reason like "Higher Level of Care Required" -- the two are answering different questions. mock_hospitals' free-text reason field was never going to map onto this value set correctly no matter what code we picked.

**Fix, confirmed with the user before implementing (changes the meaning of an existing required field):**
- `fhir_shared.php` gained `fhirReferralCategoryCoding()` and `fhirServiceTypeCoding()`, both mapping fixed option strings to the real fetched codes (never fabricated), same pattern as `fhirPractitionerRoleCoding()` from entry (21).
- Referral Category dropdown (Send Test form) changed from Emergency/Urgent/Routine to **Emergency/Outpatient**.
- New required **Service Type** dropdown added (Consultation/Diagnostics/Procedure/Others) -> feeds `ServiceRequest.reasonCode`.
- The existing free-text "Reason for Referral" field is unchanged in the UI, but now lands in **`ServiceRequest.note`** instead of `reasonCode` -- preserved as real clinical/capacity context, just no longer forced into a coded slot it was never a match for.
- `frontend/js/fhir-connectathon-send.js` -- `collectFormPayload()` includes `service_type`; the generic `[required]` walk in `validateForm()` picks up the new field automatically (no extra JS needed for validation).

**Verified locally**: `ServiceRequest.category` now carries SNOMED `73770003` (Emergency), `.reasonCode` carries SNOMED `11429006` (Consultation), and `.note` carries the original free-text reason ("Higher Level of Care Required") -- all three present and distinct in the same bundle.

**Running tally of what actually needed real terminology** (started as a deferred "Phase 3 nice-to-have," turned out to be load-bearing for basic acceptance): `Patient.contact.relationship`, `PractitionerRole.code` (x2), `ServiceRequest.category`, `ServiceRequest.reasonCode`. Everything else in this integration's text-only fields has held up fine so far.

---

## 2026-09-15 (21) — Fixed a real HTTP 422: two required terminology bindings we'd been sending as text-only

**Status:** Fixed and verified locally against `buildFhirReferralTestBundle()`. Not yet re-sent to the sandbox to confirm the 422 is actually gone -- next real send will confirm.

**What happened:** the user sent a real referral (with Phase 2 fields filled in) and got back a genuine `HTTP 422` with a full `OperationOutcome`. Most of the issues in it were non-blocking (`warning`/`information` severity -- narrative-missing notes, identifier "slice" mismatches for PhilHealth/PhilSys). Two were `error` severity and actually caused the rejection:
1. `Patient.contact[0].relationship[0]` -- required binding to FHIR's base "Patient relationship type" value set; our `{"text": "Parent"}` doesn't satisfy a required binding (unlike most fields in this integration, where text-only is fine).
2. `PractitionerRole.code[0]` (both sending and receiving) -- required binding to the PH eReferral IG's own `practitioner-role` value set; our `{"text": "doctor"}` likewise insufficient.

This is exactly the "terminology improvements" item flagged as Phase 3 and deliberately deferred earlier in this session -- except it turned out not to be optional. Whether a field's text-only fallback is acceptable depends entirely on whether that field has a *required* vs. *extensible*/`preferred` binding, which isn't knowable without either reading the IG's StructureDefinitions closely or, as happened here, just trying to send and reading the `OperationOutcome`.

**Fix 1 -- `Patient.contact.relationship` (no lookup needed):** this binds to a *generic* base value set (`v2-0131`) with broad categories (Emergency Contact / Next-of-Kin / etc.), not specific relations -- there's no clean match for "Parent" or "Spouse" in it anyway. Since every contact this app collects genuinely is the patient's next of kin (that's what the form calls it), the code `N` ("Next-of-Kin") is always correct regardless of the specific relationship. Added `{system: http://terminology.hl7.org/CodeSystem/v2-0131, code: N, display: Next-of-Kin}` as `.coding`, kept the specific relationship (Parent/Spouse/etc.) in `.text` alongside it.

**Fix 2 -- `PractitionerRole.code` (needed a real lookup, with the user's go-ahead for the GET):** queried `GET https://tx.fhirlab.net/fhir/ValueSet/$expand?url=https://www.fhir.doh.gov.ph/pheref/ValueSet/practitioner-role` -- the terminology server's real, current expansion (11 codes: Doctor/Nurse/Midwife/Pharmacist/Medical Technologist/Laboratory Aide/Dentist/Dental Aide/Optometrist/Barangay health worker/Primary Care Worker). Added `fhirPractitionerRoleCoding($role)` to `fhir_shared.php`, mapping only `doctor`/`nurse` (the only values `users.role` can actually produce for someone sending a referral) to their real SNOMED codes (`158965000`/`265937000`) fetched from that expansion -- never fabricated. The receiving-side placeholder role, which was hardcoded text `"clinician"`, now uses the same helper with `'doctor'` as a fixed default (documented as a known simplification -- we have no real data on what role the receiving-side practitioner actually holds, since that side is always our own placeholder).

**Verified locally**: `Patient.contact[0].relationship[0]` now has the `v2-0131`/`N` coding; both `PractitionerRole.code[0]` entries now carry the SNOMED `158965000` (Doctor) coding.

---

## 2026-09-15 (20) — View full referral detail + save incoming patient to local records

**Status:** Code complete, linted. The pure data-mapping logic (name/gender/address/identifier/next-of-kin extraction from a FHIR Patient) was tested locally against a fake Patient object -- correct. The multi-GET fetch itself (`fetchFhirReferralDetail()`) has NOT been exercised live yet -- it needs a real service_request_id from the user's own successful Postman test (entry 19's follow-up) to try against.

Prompted by the user actually receiving a referral via entry 19's polling and asking to see the full patient data, then save it locally -- closing the loop the same way `receive_transferred_patient.php` already does for the IOL side.

**Design choice: mirror the existing IOL "transferred-in patient" convention exactly**, rather than inventing a separate one. Read `receive_transferred_patient.php` first to confirm the pattern: `patients.source_referral_id` / `source_facility` / `transferred_address` / `transferred_details_snapshot`, a possible-duplicate check (`findPossibleDuplicatePatient()`, already global via `config.php`) with a link-or-create resubmit flow. The FHIR version reuses all of this so a FHIR-sourced patient behaves identically everywhere else in the app to an IOL-transferred one -- `source_referral_id` is prefixed `FHIR-{serviceRequestId}` to keep it in a distinct namespace from IOL's `ref_...` ids.

**`backend/fhir_shared.php` gained two new shared pieces** (refactored out of `fhir_poll_incoming_referrals.php`, which duplicated `refId()`/`humanName()` locally before this):
- `fhirRefId()` / `fhirHumanName()` -- renamed with an `fhir` prefix now that they're shared, to avoid the generic names colliding with anything else.
- `fetchFhirReferralDetail($serviceRequestId)` -- the multi-GET fetch used by both the view and the save feature: `GET ServiceRequest/{id}`, then `Patient/{id}`, then `Condition`/`Observation`/`Procedure`/`DiagnosticReport` scoped to the same Encounter (falling back to subject-based search if the ServiceRequest has no `.encounter`), then `Task?focus=ServiceRequest/{id}`, then resolves the sending facility's name via the requester `PractitionerRole` -> `Organization`. Up to ~7 GETs for one deliberate, user-triggered "View" click -- not polling, so this doesn't fall under the same "keep it gentle" concern as entry 19's recurring poll.

**New files:**
- `backend/fhir_get_referral_detail.php` -- thin wrapper around `fetchFhirReferralDetail()` for the "View" button.
- `backend/fhir_save_incoming_patient.php` -- re-fetches the referral server-side by `service_request_id` (never trusts a client-supplied patient payload, same principle as `receive_transferred_patient.php`), maps FHIR `Patient` fields to the local schema (name, gender, dob, phone, address components, PhilHealth/PhilSys identifiers by matching on `identifier.system` containing "philhealth"/"philsys", next-of-kin from `Patient.contact` into `patient_contacts`), and inserts or links exactly like the IOL flow. Idempotent on `source_referral_id`.

**Changed:** `frontend/index.html` -- Actions column + View button per row on the Receive table, a new detail panel (key fields + full JSON) with a "Save to Our Patients" button. `frontend/js/fhir-connectathon-receive.js` -- `viewDetail()`, `saveIncomingPatient()`/`handleSaveClick()` (with the same possible-duplicate Swal confirm pattern used elsewhere: Link to Existing / Save as New / Cancel), `showSaveResult()` (inline banner + toast).

**Bug caught before it happened, not after:** `audit_logs.action` is `varchar(30)`; my first draft of the two new action strings (`FHIR_CONNECTATHON_PATIENT_SAVED[_LINKED]`) were 32/38 characters -- would have silently failed to log (caught by `logAuditEvent()`'s own try/catch, so it wouldn't have broken saving, just silently dropped the audit trail). Checked the column width before running anything and shortened both to `FHIR_RECEIVE_PATIENT_SAVED` (26) / `FHIR_RECEIVE_PATIENT_LINKED` (27).

**Next step when resumed:** exercise this live -- open the referral the user already received via Postman (entry 19), click View, confirm the detail panel and JSON look right, then Save to Our Patients and confirm it shows up in Patient Records with the FHIR-sourced snapshot data.

---

## 2026-09-15 (19) — Built the receiving side: poll for referrals sent to our own Organization

**Status:** Code complete, linted, and locally tested (the id-extraction/name-resolution parsing logic, against a simulated HAPI-style response -- no network). **Nothing sent to the sandbox for this entry**, and no live poll has run yet.

User's plan: build this, then separately register a *second* Organization via Postman and send a referral targeting our own `Organization/23405` from outside our app entirely, to prove the receiving side actually detects referrals we didn't send ourselves.

**How it finds "referrals sent to us"**: every eReferral bundle creates a fresh `PractitionerRole` per referral (no identifier reuse -- roles aren't stable facility identities the way Organizations are), so there's no direct way to search `ServiceRequest` by our Organization. Two GETs per poll instead:
1. `GET /PractitionerRole?organization={ourOrgRef}` -- every role anyone (including other systems via Postman) has ever pointed at our registered Organization.
2. `GET /ServiceRequest?performer={role1,role2,...}&_include=ServiceRequest:subject&_sort=-_lastUpdated&_count=50` -- every referral whose performer is one of those roles, with the Patient pulled into the *same* response via `_include` (avoids an N+1 Patient-fetch-per-referral).

**New files:**
- `backend/fhir_poll_incoming_referrals.php` -- the above, filtered by `facilities.fhir_organization_id` for the logged-in user's own facility. Returns `registered: false` with a friendly message if the facility hasn't registered an Organization yet (nothing to filter by). Read-only throughout.
- `frontend/js/fhir-connectathon-receive.js` -- new module (`window.FhirConnectathonReceive.init()`). Renders results as a DataTable (same convention as Organizations/Logs). Tracks previously-seen `service_request_id`s client-side (a `Set`, resets on page reload -- no DB table for this yet) to detect genuinely *new* referrals since the last poll, and fires a `showToast('info', ...)` plus a sidebar badge count (`#navFhirReceiveBadge`, same visual pattern as the real `#navPendingBadge`) when something new shows up. Badge/highlight clears once the user actually opens the tab or hits Refresh.
- **Polling cadence deliberately gentle**: starts only once the tab is first opened (not globally on login), 60-second interval, two GETs per tick. This is a genuine recurring automated request against third-party shared infrastructure, which is different from every other request in this integration so far (all previously either a one-off user-triggered Preview/Send/Register click, or a Claude-initiated ad-hoc GET the user explicitly approved each time) -- flagging this distinction here since it's the first *standing* automated poll against the sandbox, not a per-click one-off.

**Changed files:** `frontend/index.html` (sidebar badge, replaced the FHIR: Receive placeholder with a real table + "not registered yet" banner), `frontend/js/app.js` (one-line `switchTab('fhirReceive')` branch now calls `FhirConnectathonReceive.init()`, mirroring the other two tabs).

**Next step when resumed:** nobody has opened the FHIR: Receive tab yet, so no real poll has happened. Once the user registers a second Organization via Postman and sends a referral targeting `Organization/23405`, opening this tab (or waiting up to 60s if already open) should surface it with a toast and badge.

---

## 2026-09-15 (18) — Seeded PhilSys ID + next-of-kin for all 42 patients

**Status:** Local DB seed only, unrelated to the sandbox.

Added `scratch/seed_patient_philsys_and_kin.php` (same style as `scratch/reseed_patient_names.php`) and ran it: every patient now has a deterministic 16-digit PhilSys-style PSN (`patients.philsys_id`) and a next-of-kin contact in `patient_contacts` (name drawn from the same character pool, offset by 7 so nobody is their own next of kin; relationship cycles through Spouse/Parent/Sibling/Child/Guardian/Friend; phone follows the `09` + 9-digit pattern already used elsewhere in the seed data). Re-dumped `database/schema.sql` afterward, same safe temp-file-then-verify-then-replace pattern as before.

This makes Phase 2's live testing checklist actually exercisable -- every patient in the Send Test dropdown now has real PhilSys/next-of-kin data to include in the bundle, not just the freshly-registered ones.

---

## 2026-09-15 (17) — Phase 2 (Complete Patient and Clinical Data) implemented

**Status:** Code complete, linted, and locally unit-tested (both the DB query directly and `buildFhirReferralTestBundle()` with fake data covering every present/absent combination). **Nothing sent to the sandbox.**

Before implementing, asked the user one scoping question: should PhilSys ID / Next of Kin live only on the isolated Send Test form, or be wired into the real "Add Patient" registration form (persisted, used everywhere)? User chose the latter -- **this is the first Phase 2/entry-17 change that touches the core patient registration flow**, not just isolated FHIR tooling, unlike everything before it.

**DB migration:** `patients` gained nullable `philsys_id VARCHAR(20)`; new `patient_contacts` table (`id`, `patient_id`, `name`, `relationship`, `phone`, `created_at`, FK to `patients` ON DELETE CASCADE) -- one row per patient in practice (Add Patient only ever collects one next-of-kin), though the schema doesn't enforce that.

**1. PhilSys identifier:**
- `frontend/index.html` (Add Patient form) -- new optional "PhilSys ID" input in the existing Socio-Economic & Health Insurance card.
- `backend/save_patient.php` -- accepts and stores it.
- `backend/get_patients.php` -- returns it.
- `backend/fhir_send_referral.php` -- adds `Patient.identifier` (`system: http://philsys.gov.ph/fhir/Identifier/philsys-id`) only when the patient has one on file. Verified locally: 1 identifier without, 2 with.

**2. Clinical history:** new optional "Clinical History" textarea on the Send Test form, mapped to `Condition.note` on the *chief-complaint* Condition (not the diagnosis one) -- kept deliberately distinct from Chief Complaint per the spec ("why the patient came" vs. "narrative/history"). Verified locally: `note` key entirely absent when empty (not an empty array), present with the right text when filled in.

**3. Next of kin:**
- `frontend/index.html` (Add Patient form) -- new optional "Next of Kin" card (Name/Relationship/Phone).
- `backend/save_patient.php` -- validates that a phone is present whenever a name is given (spec: "not mandatory," but a name with no way to reach them isn't useful), inserts into `patient_contacts`.
- `backend/get_patients.php` -- LEFT JOINs the most recent contact per patient (a subquery keyed on `MAX(id)`, since a plain join would risk duplicate patient rows if the table ever holds more than one contact per patient -- it doesn't today, but the query is written to stay correct if that ever changes).
- `backend/fhir_send_referral.php` -- adds `Patient.contact` (name/relationship/telecom) only when both name and phone exist; omitted entirely otherwise (verified: no `contact` key when absent, not `contact: []`).
- Both PhilSys ID and Next of Kin also now show on the FHIR Send Test tab's "Patient Details" card, matching how PhilHealth already displays there.

**4. Treatment given:** new optional "Treatment Given" textarea (Send Test form only -- this one's per-encounter, not a patient attribute, so it stayed out of Add Patient per the earlier scoping decision). Generates a `Procedure` resource (`status: completed`, `.note`) only when filled in -- no `performedDateTime` asserted since mock_hospitals doesn't capture when treatment was actually given, only that it was. Verified locally: `Procedure` entirely absent from the bundle when the field is empty.

**5. Laboratory results:** new optional "Laboratory Results" textarea (Send Test form only). Generates a `DiagnosticReport` (`status: final`, `.conclusion`) only when filled in -- no `presentedForm`/attachment, since this tool has no file-upload plumbing (documented inline as a known limitation, matching the spec's "minimum: report text, conclusion" allowance). Verified locally: `DiagnosticReport` entirely absent when empty.

**Also changed:** `frontend/js/app.js`'s Add Patient submit handler (`$('#patientForm').on('submit', ...)`) now includes the four new field values in its manually-built `formData` object -- it doesn't serialize the form generically, so the new inputs would've been silently dropped otherwise. Caught this by reading the actual submit handler rather than assuming form fields flow through automatically.

**Phase 2 testing checklist (per the user's own spec) -- still needs a live pass:** patient identifiers correct, clinical history stays separate from chief complaint, `Procedure` only appears when treatment data exists, `DiagnosticReport` only appears when lab data exists. All four verified locally against the bundle-builder directly; not yet exercised through the actual UI end to end.

**Deferred to Phase 3 (per the approved spec, not done here):** terminology/coding improvements (replacing `{text: "doctor"}`-style free text with real mappings), and the pre-send Bundle validation workflow.

---

## 2026-09-15 (16) — Phase 1 (Core Referral Completeness) implemented

**Status:** Code complete, linted, and locally unit-tested against `buildFhirReferralTestBundle()`/`buildDiwaOrganizationResource()` directly with fake data (no network) covering every new branch. **Nothing sent to the sandbox for this entry.**

User pasted a detailed phased spec (Phase 1/2/3) for PH eReferral compliance, explicitly asking for inspection + a plan before implementing, and approved the plan as presented. This entry covers everything approved as "Phase 1 — Core Referral Completeness":

**1. Organization address + telecom:**
- DB migration: `facilities` gained nullable `address VARCHAR(255)`, `phone VARCHAR(20)`, `fhir_organization_id VARCHAR(64)` columns (ran directly against the dev DB via a PHP one-liner, then re-dumped `database/schema.sql` — same pattern as the earlier patient-name reseed).
- `fhir_shared.php`: `buildDiwaOrganizationResource()` now takes optional `$address`/`$phone` and adds `.address`/`.telecom` only when non-empty (verified locally: both fields appear correctly when supplied, resource stays minimal when not).
- UI: "Register My Facility" card (FHIR: Organizations tab) gained two optional inputs, prefilled from the DB and saved on every register attempt regardless of sandbox outcome (`fhir_register_organization.php` UPDATEs `facilities.address`/`.phone` before attempting the PUT).

**2. Cache FHIR Organization ID (avoid re-PUTting every referral) -- the improvement suggested by the earlier external ChatGPT critique, now implemented:**
- On a successful registration, `fhir_register_organization.php` reads the sandbox's returned `id` and stores `Organization/{id}` in `facilities.fhir_organization_id`.
- `fhir_send_referral.php`: the sending-Organization logic now checks this cached ref first. If present, the bundle skips building/PUTting the Organization entirely and references `Organization/{id}` directly in `PractitionerRole.organization` and `Provenance.agent.onBehalfOf` (verified locally: bundle entry count drops by one, and the reference resolves correctly). If absent, falls back to the original conditional-PUT-with-address/phone behavior -- conditional PUT was kept as the fallback per the spec, not removed.

**3. Receiving facility selection:** already existed from entries (10)/(12) above -- confirmed as meeting the spec's requirement, no new work needed here.

**4. PhilHealth identifier:** `fhir_send_referral.php` now adds a second `Patient.identifier` (`system: http://philhealth.gov.ph/fhir/Identifier/philhealth-id`) whenever `patients.philhealth_member = 'Yes'` and a number is on file. Verified locally both ways (1 identifier without PhilHealth, 2 with).

**5. Referral category separation:** new required "Referral Category" `<select>` (Emergency/Urgent/Routine) added to the Send Test form, distinct from the existing "Reason for Referral" text field. `ServiceRequest.category` now carries the category, `.reasonCode` carries the reason -- previously both carried the same `reason_text` value. **Noted a discrepancy to the user**: the README's own prose data-dictionary table says referral category maps to `ServiceRequest.priority`, but the README's own worked example bundle (`ph-ereferral-collection.json`) actually puts referral category into `.category` and never touches `.priority` — implemented to match the actual worked example (what other participants' tooling will pattern-match against) rather than the prose table, per explicit agreement with the user.

**6. Weight Observation:** new "Weight (kg)" input restores what the original IOL form has but this FHIR form dropped; generates an Observation with LOINC `29463-7` ("Body weight"), matching the code used in the reference sample bundle, same pattern as the other five vitals.

**Also fixed while testing:** none this time -- all new logic passed on first local test run (`php -r` invocations exercising `buildFhirReferralTestBundle()` with/without PhilHealth, with/without a cached sending-org ref, and `buildDiwaOrganizationResource()` with/without address+phone).

**Not done (correctly out of scope for Phase 1):** PhilSys identifier, clinical history, next-of-kin, treatment/Procedure, lab results/DiagnosticReport, terminology coding improvements, and the pre-send validation workflow -- all explicitly deferred to Phase 2/3 in the approved plan.

**Next step when resumed:** Phase 1 testing checklist from the user's own spec -- verify all six items live (Organization address/telecom appear when filled in, bundle references the cached org id instead of re-PUTting, PhilHealth identifier appears when applicable, ServiceRequest has both category and reasonCode distinctly, weight Observation exists, and the existing send flow still works) -- before touching Phase 2.

---

## 2026-09-15 (15) — Bug found and fixed: newly-registered orgs could be missing from the list

**Status:** Fixed, syntax-checked. Not yet re-verified live (next tab refresh will show whether `DiWA Center`/`Organization/23405` now appears).

**Symptom:** user registered "DiWA Center" successfully (see entry 14), then logged in as a different mock_hospitals facility and couldn't find it in the Organizations list or the Send tab's receiving-org dropdown.

**Diagnosis (with the user's explicit go-ahead for each GET, per rule 7):**
1. `GET /Organization/23405` -> 200, resource present and correct.
2. `GET /Organization?identifier=https://diwa-irdss.local/fhir/identifier/test|DIWA-IRDSS-TEST-ORG-3` -> 200, `total: 1`, found it.
3. `GET /Organization?_summary=count` -> **`total: 130`** organizations on the whole sandbox.

So the registration was never the problem -- `backend/fhir_list_organizations.php` was calling `GET /Organization?_count=50` with no sort, and the sandbox has 130+ orgs accumulated from every Connectathon participant since June. With no `_sort`, HAPI's default order isn't "newest first," so a fresh registration can easily fall outside an unsorted first-50 page.

**Fix:** changed the query to `Organization?_count=200&_sort=-_lastUpdated` -- raises the fetch limit comfortably above the current total and sorts newest-first so anything just registered always lands on page one regardless of count. Documented inline that this is still a stopgap, not true pagination: if the sandbox's total ever exceeds `_count` again, older entries fall off the end. A proper fix would follow the Bundle's `link.relation=next` or add a server-side search (by name/identifier) instead of fetching everything into one client-side table.

---

## 2026-09-15 (14) — First confirmed live write: facility registered as Organization/23405

**Status:** ✅ Real, confirmed success against the live sandbox -- the first actual write this integration has ever made. Done by the user, not Claude, per the standing rule that Claude asks before firing sandbox requests itself.

The user registered their facility via the "FHIR: Organizations" tab and got back:

```json
{
  "resourceType": "Organization",
  "id": "23405",
  "meta": { "versionId": "1", "lastUpdated": "2026-09-15T12:04:50.715+00:00", "profile": ["https://fhir.doh.gov.ph/phcore/StructureDefinition/ph-core-organization"] },
  "identifier": [{ "system": "https://diwa-irdss.local/fhir/identifier/test", "value": "DIWA-IRDSS-TEST-ORG-3" }],
  "name": "DiWA Center",
  "alias": ["DiWA-IRDSS Test"]
}
```

Confirms: the conditional-PUT-by-identifier flow works end to end against the real sandbox; `versionId: "1"` shows this was a genuine first create, not an update; and the name/alias split from entry (12) came through exactly as designed. This facility (`Organization/23405`) is now selectable in the Send Test tab's "Receiving Organization" dropdown for future test referrals, and should appear in the Organizations tab's table on refresh.

---

## 2026-09-15 (13) — Swal confirm + showToast, replacing native confirm()/alert()

**Status:** UI-only, syntax-checked. Not yet exercised in-browser.

Per the user's request to match the rest of the app's UX instead of native browser dialogs:
- `frontend/js/app.js` -- exposed the existing `showToast(type, message, duration)` (the shared Swal-toast helper already used everywhere else in the app) as `window.showToast`, so the separate fhir-connectathon-*.js modules can call it without duplicating the toast styling.
- `frontend/js/fhir-connectathon-send.js` (`handleConfirmSend`) and `frontend/js/fhir-connectathon-organizations.js` (`handleConfirm`) -- replaced `window.confirm(...)` with `await Swal.fire({icon: 'warning', showCancelButton: true, ...})`, matching the exact confirm-dialog convention already used elsewhere (e.g. `.btn-cancel-referral`'s handler): same `confirmButtonColor: '#dc2626'` / `cancelButtonColor: '#64748b'` / `customClass: { popup: 'rounded-4 shadow-lg' }`. `Swal.fire()` returns a Promise, so this drops in cleanly as `const result = await Swal.fire(...); if (!result.isConfirmed) return;` inside the existing async functions.
- Both handlers now also call `window.showToast('success'|'error', ...)` after the sandbox responds, alongside (not instead of) the existing detailed JSON result panel -- the toast gives the at-a-glance heads-up the rest of the app gives for every action, the panel stays for anyone who wants to inspect the raw response.
- Bumped the `?v=` cache-busting query strings on `app.js` and both fhir-connectathon-*.js script tags in `index.html`.

---

## 2026-09-15 (12) — Organization.name cleaned up, test marker moved to .alias

**Status:** Code changed, syntax-checked and locally verified the JSON shape (no network). Not yet sent anywhere -- the user said they'll do the actual registration themselves via the "FHIR: Organizations" tab.

**Why:** external review (user pasted feedback, apparently from a separate ChatGPT session) flagged two things about the Organization JSON:
1. Suggested using the real `https://fhir.doh.gov.ph/phcore/Identifier/doh-nhfr-code` system with our fake value. **Rejected this** -- explained to the user why: that pollutes the real production NHFR namespace with a non-real code, which is worse than our own scoped `https://diwa-irdss.local/fhir/identifier/test` system, and is exactly what rule 3 in `SANDBOX_SAFETY_RULES.md` exists to prevent. Keeping `FHIR_TEST_ID_SYSTEM` as-is; would only switch to the real namespace once organizers hand us an actual test/dummy NHFR value, not preemptively.
2. Flagged `name: "DiWA-IRDSS Test-DiWA Center"` as mixing an internal label into the real facility name. **Agreed with this one** and implemented it.

**Change:** `backend/fhir_shared.php` -- added `FHIR_TEST_ALIAS` constant (`"DiWA-IRDSS Test"`, derived from `FHIR_TEST_NAME_PREFIX`). `buildDiwaOrganizationResource()` now sets `name` to the real facility name and puts the test marker in `alias: [FHIR_TEST_ALIAS]` instead. Same treatment applied to the inline placeholder receiving-Organization builder in `fhir_send_referral.php` (name now just `"PlaceholderReceivingFacility"`, marker moved to alias). Patient/Practitioner names are deliberately left prefixed as before -- `.alias` isn't a field on those resource types, and a visible marker in the only human-readable field matters more there on a shared public sandbox (documented inline in `fhir_shared.php`).
- `backend/fhir_list_organizations.php` now also returns each org's `alias` array; `frontend/js/fhir-connectathon-organizations.js` renders it as a small amber badge next to the name in the Organizations table, so the visibility this whole convention exists for isn't lost by cleaning up `.name`.

---

## 2026-09-15 (11) — Organizations list is now a paginated DataTable

**Status:** UI-only, no sandbox interaction.

Replaced the plain `divide-y` list under "Organizations on the Sandbox" with a `<table id="fhirOrgsTable">` + jQuery DataTables, matching the exact convention already used by the System Logs (`#logsTable`) and Patient Records tables in `app.js`: destroy-if-exists before re-render, `pageLength: 10` / `lengthMenu: [10, 25, 50]`, search box, and the same `language` label overrides. Columns: Name, Identifiers, Resource (`Organization/{id}`). `frontend/js/fhir-connectathon-organizations.js` gained its first jQuery usage (`renderOrganizationsTable()`) since DataTables is a jQuery plugin -- the rest of the module stays plain DOM/fetch, jQuery/DataTables were already global page dependencies loaded before this script.

---

## 2026-09-15 (10) — Organizations tab: browse the sandbox, register own facility, pick a real receiving org

**Status:** Code complete, syntax-checked and locally unit-tested (bundle-builder logic only, no network). **Nothing has been sent to the sandbox by anyone yet** — still waiting on the user to actually open the tabs and click through.

**Why:** user asked whether the README covers listing/choosing an Organization to send referrals to. It doesn't have a dedicated section, but confirms `GET /Organization` is a standard listed operation (README line ~310) -- any Organization anyone has written to the sandbox is retrievable that way. So "browse" = a plain search, and "add myself" = the same conditional-PUT-by-identifier pattern already used for the sending facility inside the referral bundle, just exposed as its own deliberate action.

**New files:**
- `backend/fhir_shared.php` -- extracted here because a second consumer of the Organization-building logic appeared: `FHIR_TEST_ID_SYSTEM`/`FHIR_TEST_ID_PREFIX`/`FHIR_TEST_NAME_PREFIX` constants, `genFhirUuidV4()`, and `buildDiwaOrganizationResource($facilityId, $facilityName)` (returns the resource + its conditional-PUT URL). `fhir_send_referral.php` was refactored to use this for its own sending-Organization instead of duplicating the literal array.
- `backend/fhir_list_organizations.php` -- `GET /Organization?_count=50` against the sandbox, read-only, returns `{id, name, identifiers}` per org.
- `backend/fhir_register_organization.php` -- registers the logged-in user's own facility as an Organization via conditional PUT, built with `buildDiwaOrganizationResource()`. Same `dry_run` preview convention as the referral sender. `requireRole(['doctor','nurse','facility_admin'])` -- deliberately wider than the referral sender's `['doctor','nurse']`, since this is a one-time setup action, not a clinical one.
- `frontend/js/fhir-connectathon-organizations.js` -- new module (`window.FhirConnectathonOrgs.init()`), same pattern as the other two: loads the org list + the current facility's name, Preview → native-confirm → Register flow identical in shape to the referral Send flow, shows an "Already on sandbox" badge by checking whether an org with identifier `...|DIWA-IRDSS-TEST-ORG-<facilityId>` already exists.

**Changed files:**
- `frontend/index.html` -- new sidebar tab "FHIR: Organizations" (after "FHIR: Receive"), its content section, and a new **Receiving Organization** `<select>` on the Send Test form (optional; empty value keeps today's placeholder-receiving-org behavior).
- `backend/fhir_send_referral.php` -- `buildFhirReferralTestBundle()` now takes an optional 5th param, an existing Organization reference (e.g. `Organization/123`). When given: no placeholder receiving-Organization resource is built or PUT at all -- the receiving `PractitionerRole.organization` references the real org directly (a plain, read-only FHIR reference; never a PUT/PATCH against that org, so this doesn't touch rule 2 in the safety doc). When omitted: unchanged placeholder behavior. Also fixed a bug caught during local testing (see below) and removed the now-duplicated local `genUuidV4()` in favor of the shared one.
- `frontend/js/fhir-connectathon-send.js` -- `collectFormPayload()` includes `receiving_org_ref`; new `loadReceivingOrgs()` populates the dropdown from `fhir_list_organizations.php`, called from `init()` alongside `loadPatients()`. `FhirConnectathonOrgs` calls `FhirConnectathonSend.init()` after a successful registration so the dropdown picks up the newly-registered org without needing a manual tab switch.

**Bug caught by testing, not just linting:** the refactor to `genFhirUuidV4()` missed one call site (inside the per-vital-sign Observation loop), which `php -l` doesn't catch since it's a runtime "undefined function" error, not a syntax error. Found it by actually invoking `buildFhirReferralTestBundle()` locally with fake data (no network) before wiring the frontend, both with and without an existing receiving-org reference -- confirmed entry counts, that the receiving `PractitionerRole` points at the given `Organization/999` when provided, and that no placeholder org entry appears in that case.

**Next step when resumed:** nobody has opened "FHIR: Organizations" or clicked Preview/Register yet, and the Send tab's new dropdown has never been exercised against a real registered org end-to-end.

---

## 2026-09-15 (9) — Inline "Field shouldn't be empty." text under each required field

**Status:** UI-only, no sandbox interaction.

Each of the four required fields (`fhirPatientSelect`, `fhirChiefComplaint`, `fhirWorkingImpression`, `fhirReasonText` -- gave the three text inputs real `id`s for this, they only had `name` before) now has a sibling `<p id="<fieldId>Error" class="hidden text-xs text-red-600 mt-1">Field shouldn't be empty.</p>`. `markFieldInvalid()` in `fhir-connectathon-send.js` toggles that paragraph's `hidden` class in lockstep with the red border/ring highlight (by looking up `${field.id}Error`), so both the highlight and the text appear/disappear together from the same code path -- `validateForm()` and `clearFieldHighlightOnInput()` didn't need any changes beyond that.

---

## 2026-09-15 (8) — Required-field highlighting on the Send form

**Status:** UI-only, no sandbox interaction.

Added a red-asterisk marker (`<span class="text-red-600">*</span>`, matching the exact convention already used on the Register Patient / Refer Patient forms) next to the four required labels (Patient, Chief Complaint, Working Impression/Diagnosis, Reason for Referral), plus actual field-level validation in `frontend/js/fhir-connectathon-send.js`: `validateForm()` walks `#fhirSendForm [required]`, applies the same `REQUIRED_FIELD_ERROR_CLASSES` (`border-red-600 ring-2 ring-red-600/20 bg-red-50/40`) that `app.js`'s Refer Patient form already uses for empty fields, and focuses the first invalid one. Highlight clears per-field as soon as that field gets a value (via a delegated `input`/`change` listener), not just on the next full submit attempt. `handlePreview()` now calls `validateForm()` instead of the old one-line manual check.

---

## 2026-09-15 (7) — Renamed test-data prefix from MOCKHOSP-/MockHospitalsTest- to DIWA-IRDSS-TEST-/DiWA-IRDSS Test-

**Status:** Rename only, no behavior change, nothing sent to the sandbox.

Per the user's request to match actual project branding (DiWA / IRDSS) instead of a generic placeholder name. Updated everywhere the old prefix appeared:
- `backend/fhir_send_referral.php` -- identifier system URL (`https://mockhospitals.local/...` -> `https://diwa-irdss.local/fhir/identifier/test`), every `DIWA-IRDSS-TEST-<ResourceType>-<id>` identifier value, every `DiWA-IRDSS Test-` name prefix (Patient, both Organizations, both Practitioners), and the matching conditional-PUT URLs (which must stay in lockstep with the identifier values they query by).
- `frontend/index.html` -- the on-page warning banner text.
- `hackathon_tracker/SANDBOX_SAFETY_RULES.md` -- the naming-convention section, with a note added that the `-TEST`/`Test` marker itself is load-bearing (signals synthetic data) and must survive any future rebrand.
- `scratch/reseed_patient_names.php` -- comment reference only (the script itself never used this prefix, it renames `patients` rows to character names, unrelated to the FHIR identifier scheme).

---

## 2026-09-15 (6) — Patient Details card on the Send tab, purely local (no sandbox call)

**Status:** UI-only addition, no new backend endpoint needed and nothing sent to the sandbox for this.

- `frontend/index.html`: added `#fhirPatientDetailsCard` inside `#fhirSendForm`, right after the patient `<select>` -- shows Full Name, DOB, computed Age, Gender, Civil Status, Phone, PhilHealth (member/number/status), and Address/Location, all styled to match the app's existing card conventions.
- `frontend/js/fhir-connectathon-send.js`: `loadPatients()` now also caches the full patient list in `patientsById` (it was already fetching all fields from `get_patients.php` for the dropdown, just wasn't keeping them). A new `change` listener on `#fhirPatientSelect` calls `renderPatientDetails()`, which reads straight from that cache -- no extra network round-trip per selection.
- Caught and fixed a self-inflicted bug during this edit: an initial pass accidentally split `#fhirSendForm` into two sibling `<form>` elements (patient select in one, clinical fields in a second, hidden one), which would have silently dropped every clinical field from `FormData` on submit. Caught by re-reading the inserted HTML before moving on -- fixed by merging back into the single form.

---

## 2026-09-15 (5) — Reseeded patient names (cartoon/Marvel), font already Outfit

**Status:** Local dev DB cleanup, unrelated to the FHIR sandbox itself (no request went to FHIRLab for this).

**DB cleanup:**
- Added `scratch/reseed_patient_names.php` (one-off script, same pattern as the existing `scratch/update_patients.php`) and ran it against the local `hospital_db`. It replaced every `patients` row's `first_name`/`last_name` (realistic-looking Filipino test names like "Maria Santos") with a cartoon/Marvel character name (e.g. "Tony Stark", "Homer Simpson", "SpongeBob SquarePants"), cleared `middle_name`/`suffix`, and propagated the new name into `initiated_referrals.patient_name`, the `full_name` field inside `patients.transferred_details_snapshot` JSON, and (matched by old-name string equality, since `audit_logs` has no `patient_id` column) `audit_logs.patient_name`. **42 patients reseeded.**
- Scope was deliberately limited to `patients` — did NOT touch `users.full_name` (several of those are actual team members' real login accounts used for testing, e.g. "Josh Mojica", "Tomi Maylo", not bulk seed data) or `facilities`/`hospitals` (institution names, not "people info"). If the user also wants staff accounts fictionalized, that's a separate ask.
- Regenerated `database/schema.sql` via `mysqldump` afterward (dumped to a temp file first, sanity-checked table count + a reseeded name were present, then replaced the tracked file) so the committed dump reflects the new data. Not committed — per standing instructions, only commit when explicitly asked.

**Font:** Checked `frontend/index.css` / `landing.css` — both already set `body { font-family: 'Outfit', 'Inter', sans-serif; }`, so Outfit was already the actually-rendered font app-wide (including the new FHIR tabs, which inherit it with no overrides of their own). The only stale piece was `tailwind.config.js`'s `fontFamily.sans`, which still listed `'Inter'` first — harmless in practice since it wasn't winning the cascade, but updated to `['Outfit', 'Inter', 'system-ui', 'sans-serif']` for consistency with the CSS that was already in effect.

---

## 2026-09-15 (4) — Moved Send/Receive into the main SPA sidebar (index.html), not standalone pages

**Status:** Superseded the previous standalone-pages approach per explicit user request. Backend adapter (`backend/fhir_send_referral.php`) is unchanged. Still nothing has been fired at the sandbox.

**What changed:**
- Deleted `frontend/fhir-send.html` and `frontend/fhir-receive.html` — functionality moved into `frontend/index.html` instead, as two new sidebar tabs ("FHIR: Send Test", "FHIR: Receive"), `data-nav-role="staff"`, styled with the same Tailwind classes/cards/inputs used elsewhere in the app (matching e.g. the Refer Patient tab's card/input/button conventions) rather than a separate visual style.
- `frontend/js/fhir-connectathon-send.js` rewritten to follow the same module pattern `service_assessment.js` already uses for `window.DOHAssessment`: an IIFE exposing `window.FhirConnectathonSend.init()`, lazily called from `app.js`'s `switchTab()` the first (and every) time the "FHIR: Send Test" tab is opened, rather than running on page load. **This file is still deliberately separate from `app.js`** — the user was explicit about this a second time — `app.js` only gained the minimal SPA glue (tab entries in `$allTabs`, two `switchTab()` branches, two click handlers) needed to show/hide the new content `<div>`s and call into the separate module, exactly mirroring how `loadServiceAssessment()` calls into `DOHAssessment.loadForm()`.
- `frontend/index.html`: added the two sidebar links (after "Incoming Patients"), the two content `<div id="tabFhirSendContent">` / `<div id="tabFhirReceiveContent">` (after "Incoming Patients" content, before "Manage Users"), and the new script tag (loaded before `app.js`, same as `service_assessment.js`).

**Still true from the previous entry (unchanged):** the two-step Preview/Confirm-and-Send flow, the `MOCKHOSP-`/`MockHospitalsTest-` naming convention, the placeholder receiving-facility resources, and the fact that consent is excluded from the bundle entirely.

**Next step when resumed:** same as before — nobody has opened the tab and actually run Preview yet.

---

## 2026-09-15 (3) — Send page built (Phase 0 adapter + UI), nothing fired at the sandbox yet

**Status:** Code complete, syntax-checked locally (`php -l`, Node syntax check) only. **No request has been sent to the FHIR sandbox by anyone yet** — Claude has not tested it live, per the user's explicit instruction that Claude must ask before firing any request itself, GET included (see updated rule 7 in `SANDBOX_SAFETY_RULES.md`).

**Files added:**
- `backend/fhir_send_referral.php` — new adapter, fully separate from `send_referral.php`/IOL. Builds the full PH eReferral transaction Bundle (Patient/Organization x2/Practitioner x2/PractitionerRole x2/Encounter/Condition x2/Observation x0-5/ServiceRequest/Task/Provenance) from one `patients` row + form input. Supports `dry_run: true` (builds and returns the Bundle without contacting the sandbox — used by the Preview step) and `dry_run: false` (actually POSTs via `sendFhirRequest()`).
  - No receiving-facility concept exists in mock_hospitals yet, so the receiving Organization/Practitioner/PractitionerRole are fixed, clearly-labeled placeholders (`MOCKHOSP-ORG-PLACEHOLDER-RECEIVING`, etc.) — a Phase 1 decision, not resolved here.
  - Patient consent is deliberately NOT included anywhere in the bundle, per the earlier discussion — `Provenance` here only carries authorship (who/when), no signature data, since mock_hospitals has no professional-signature capture distinct from patient consent.
  - Every identifier uses `MOCKHOSP-<ResourceType>-<id>` on a project-owned identifier system; every human-readable name is prefixed `MockHospitalsTest-`, per the safety rules' naming convention.
- `frontend/js/fhir-connectathon-send.js` — **new, separate JS file** (explicitly NOT added to `js/app.js` per the user's instruction). Implements a two-step flow: "Preview Bundle" (dry_run) shows the exact payload; "Confirm & Send" is disabled until a preview exists and is invalidated the moment the form changes, so what gets sent always matches what was reviewed. Also shows a native `confirm()` dialog before the actual send, naming the sandbox host explicitly.
- `frontend/fhir-send.html` — new standalone page (flat under `frontend/`, matching the existing `index.html`/`landing.html` convention rather than a nested folder), with an on-page warning banner and a link to the receive page.
- `frontend/fhir-receive.html` — placeholder page per the earlier decision (Send fully built, Receive as a stub) — empty state pointing back at this tracker's Phase 2 entry.

**Safety rule change this session:** `SANDBOX_SAFETY_RULES.md` rule 7 was tightened — Claude must ask the user before firing ANY request itself (GET included) while building/debugging this integration; this does not apply to the deployed app, where a staff member's own click on Preview/Confirm & Send is the go-ahead for that specific request.

**Next step when resumed:** the Send page has never been exercised end-to-end. Before relying on it, someone (the user, deliberately) needs to actually open `frontend/fhir-send.html` logged in as a doctor/nurse, run Preview, review the bundle, and decide whether to hit Confirm & Send against the live sandbox.

---

## 2026-09-15 (2) — FHIR config wired, no mapper/adapter yet

**Status:** Just infrastructure. Still no FHIR resource-building code — that starts when the user picks a phase.

**Changes made:**
- `backend/config.php`: added `FHIR_EREFERRAL_BASE_URL`, `FHIR_CORE_BASE_URL`, `FHIR_TERMINOLOGY_BASE_URL` constants (default to the FHIRLab sandbox, overridable via `.env`) and a new `sendFhirRequest($method, $baseUrl, $path, $bodyJson = null)` helper — a plain unauthenticated cURL client, deliberately separate from `sendSignedIolRequest()`/`sendSignedIolBinaryRequest()` above it, since the FHIRLab sandboxes take no auth at all (no RSA signing, no facility headers).
- `.env`: added commented-out override lines for the three FHIR base URLs (defaults live in code, so this is optional).
- Sanity-checked: `sendFhirRequest("GET", FHIR_EREFERRAL_BASE_URL, "metadata")` → HTTP 200, `CapabilityStatement` from HAPI FHIR 8.10.0. Confirms the wiring works end-to-end from PHP, not just curl on the command line.

**Decisions carried from the scoping conversation (recorded here for Codex):**
- **Don't touch the existing mapper** in `send_referral.php` — its payload-building logic is coupled to the IOL/IRDSS custom shape and its consent/reason validation. The Connectathon side needs a brand-new adapter that reads the same DB tables but independently builds real FHIR resources (Patient/Organization/Practitioner/PractitionerRole/Encounter/Condition/Observation/ServiceRequest/Task/Provenance). Some query duplication is an acceptable tradeoff for keeping this fully decoupled from the production referral flow.
- **DB schema: no full redo needed.** For Phase 0 (POC) no DB changes at all — placeholders cover the gaps. For Phase 1, the plan is small *additive* nullable columns (e.g. an NHFR code on `facilities`, a PRC license number on `users`, a PhilSys ID on `patients`) rather than any redesign — see the gap list in the entry above.
- Endpoints are configured, not hardcoded (see config changes above) — matches how `IOL_HOST`/`IOL_ENDPOINT_URL` already work.

**Next step when resumed:** still waiting on the user to pick Phase 0 (proof-of-connection POST) vs. jumping to Phase 1 (real field mapping + DB additions).

---

## 2026-09-15 — Scoping session, sandbox verified live, implementation deferred

**Status:** Scoped only. No code written yet. User said "later, we will modify" — this integration is intentionally on hold until further notice.

**What was decided / found:**

1. **This is a new, separate integration** — connecting mock_hospitals to the public FHIRLab PH eReferral sandbox (`cdr.pheref.fhirlab.net`) to exchange referral data as real HL7 FHIR resources, for interoperability-standards testing/demo purposes.

2. **Explicitly NOT the same as the existing IOL integration.** mock_hospitals already talks to an IOL (Interoperability Layer) server for IRDSS referral routing/matching, via `backend/send_referral.php` + `sendSignedIolRequest()`/`sendSignedIolBinaryRequest()` in `backend/config.php`. That payload is FHIR-*shaped* (an `Encounter` resource with custom `http://irdss.gov.ph/fhir/StructureDefinition/*` extensions) but is **not** conformant to the PH Core / PH eReferral Implementation Guides — no separate Patient/Organization/Practitioner/ServiceRequest/Task/Provenance resources, no NHFR/PRC/PhilSys identifiers, no SNOMED coding.
   - Decision: **the FHIR Connectathon exporter will be a fully separate code path**, pointing at the FHIRLab sandbox endpoints, not the IOL server. It does not replace or modify the IOL flow. The only future scenario where they'd merge is a much larger, separate project: rebuilding IOL itself to be FHIR-conformant. Not in scope here.

3. **Sandbox connectivity verified live** (2026-09-15):
   - `GET https://cdr.pheref.fhirlab.net/fhir/metadata` → `200`, returns a `CapabilityStatement` from a HAPI FHIR R4 server (v8.10.0), no auth required.
   - `GET https://cdr.pheref.fhirlab.net/fhir/Patient?_count=3` → `200`, returned real `Patient` resources left over from the June 2026 Connectathon run (e.g. `PhCorePatientTest`, a `ShouldFailIfInterceptorWorks` test record). Confirms:
     - No credentials needed — matches the README's claim.
     - Data **persists** across months, and is visible to anyone querying — **only synthetic/test data should ever be sent here, never real patient data.**
     - The server runs HAPI's **MDM (master data management)** — saw a `GOLDEN_RECORD`-tagged Patient — meaning submitted Patients can get auto-merged into existing golden records from other participants. Relevant when we get to writing: our submitted Patient may not stay exactly as submitted.
     - A test record name suggests they have a **validation interceptor** meant to reject non-conformant profiles — worth deliberately testing against when we start posting.

4. **Data/schema gaps identified in mock_hospitals** vs. what the PH eReferral IG's 18-resource bundle expects (see `patients`, `facilities`, `users`, `initiated_referrals` tables in `database/schema.sql`):
   - `facilities.code` is an internal code, not an NHFR national registry code.
   - `users` has no PRC license number field for practitioners.
   - `patients` has PhilHealth number/status but no PhilSys ID field.
   - Referral reason / chief complaint / diagnosis / practitioner role are stored as free text, not SNOMED CT coded.
   - Addresses (region/province/city/barangay) are free-text names, not PSGC codes — `connectathon/HL7-FHIR-Connectathon/terminology/CodeSystem-PSGC.json` could resolve this via lookup when we get there.

5. **Proposed phasing** (not started, no phase chosen yet):
   - **Phase 0 (POC):** one-way export — build one referral's full transaction Bundle (Patient/Organization/Practitioner/PractitionerRole/Encounter/Condition/Observation/ServiceRequest/Task/Provenance) and POST it to the sandbox with placeholders for uncollected fields. Goal: just prove the bundle is accepted.
   - **Phase 1:** real field mapping — decide per-gap whether to add a DB column (e.g. NHFR code) or keep a permanent placeholder.
   - **Phase 2 (optional):** bidirectional — GET a bundle back, reflect `Task.status` into `initiated_referrals.status`. This is the actual "exchange" half, not just export.
   - Out of scope for now: anything beyond the open sandbox; real (non-synthetic) patient data.

**Next step when resumed:** user needs to pick a phase to start at (Phase 0 quick proof-of-connection vs. jumping straight into Phase 1 field-mapping decisions) before any code gets written.
