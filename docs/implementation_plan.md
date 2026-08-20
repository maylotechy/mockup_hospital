# Implementation Plan & Todos

Planning notes only — nothing in this file has been implemented yet.

---

## 1. What happens after "Mark as Arrived"?

**Current state:** Clicking "Mark as Arrived" (with confirmation dialog) does three things: sets
`arrived_at` on the central `Referral` row (`PATCH /api/v1/referral/{id}/arrive`), pulls decrypted
PII via `/patient-details`, and inserts a local `patients` row via `receive_transferred_patient.php`
(storing `source_referral_id`, `source_facility`, `transferred_details_snapshot`). The referring
facility's "My Referrals" tracker already picks up `arrived_at` on its next poll and shows
"Patient Arrived" as the final tracker step — that loop is already closed.

**Gaps identified (nothing built yet):**

- [ ] **No visible link from Patient Records back to the referral.** The new local patient row
      stores `source_referral_id` / `source_facility`, but the Patient Records table/UI never
      surfaces it. A doctor looking at the patient list can't tell "this patient was transferred
      in from Hospital X" without opening Incoming Patients separately. Add a small "Transferred
      In" badge + originating facility name to the Patient Records row/detail view.
- [ ] **No immediate notification to the referring facility.** Right now the referring side only
      finds out a patient arrived when its own poll cycle runs (`checkAndPollRecommendations`
      every 4s / `pollIncomingReferrals` every 12s). Once real-time push exists (see §3), fire an
      explicit "Patient has arrived at [Facility]" toast on the referring side instead of a silent
      tracker update.
- [ ] **No post-arrival lifecycle.** After arrival the referral is functionally "done" — there's no
      way to record what happened next (admitted, treated, discharged, transferred again). Decide
      whether this is in scope at all before building it; may be out of scope for a referral
      *routing* system vs. a full EMR concern.
- [ ] **No outcome/analytics view.** No report showing referral-to-arrival time gaps
      (`accepted_at` → `arrived_at`), useful for a DOH-facing stat later.

None of the above are urgent — flag for prioritization discussion, don't build blind.

---

## 2. Policy: hospitals should not be able to reject a patient

**Stakeholder input:** told (external, presumably South Cotabato / DOH-adjacent) that a receiving
hospital should not be able to reject a referred patient.

**Current state:** The system does not have an explicit "reject" — the receiving-hospital decision
is `ACCEPTED` or `REDIRECTED` (`ResponsePayloadSchema.decision`, enforced in
`app/routers/referral.py` around line 210). `REDIRECTED` means *this* hospital declines, but the
referral stays broadcast to every other qualified hospital; the referring doctor only sees the
referral as fully dead if *every* broadcasted hospital redirects it (`fully_redirected` check,
`referral.py` ~line 369-379). So today's "REDIRECTED" is closer to "pass" than a hard reject — no
individual hospital can block the patient from being placed, they just opt out.

**Open question — needs clarification before touching code:** does "shouldn't reject" mean:

- (a) Remove the REDIRECTED option entirely — any hospital a referral is broadcast to must accept
      if capability/bed criteria matched (fully rule-enforced, no human override)?
- (b) Keep REDIRECTED, but require a mandatory reason/justification captured for audit — hospitals
      *can* decline but must explain why (staffing, unexpected capacity change, etc.)?
- (c) This is only about the *post-arrival* case — a hospital can't turn away a patient who has
      physically shown up, which is already true today (there's no "un-accept" or reject button
      once `arrived_at` is set)?

**Recommendation:** clarify with the stakeholder before implementing. (a) removes a safety valve
that currently exists for legitimate reasons (e.g., a bed becomes unavailable between broadcast
and response) and would need the hard pre-filter (`routing_filter.py`) to be airtight, since there'd
be no human fallback. (b) is the lower-risk interpretation and preserves flexibility while adding
accountability — my default recommendation if forced to guess, but confirm before building.

**Todo (blocked on clarification):**

- [ ] Confirm which interpretation ((a), (b), or (c)) the stakeholder meant.
- [ ] If (b): add a required `reason` text field to the REDIRECTED decision flow (frontend modal +
      `ResponsePayloadSchema` + `ReferralResponse` model column + display it to the referring
      facility/on any audit view).
- [ ] If (a): remove REDIRECTED entirely from `ResponsePayloadSchema`/decision UI, and audit
      `routing_filter.py`'s hard pre-filter to make sure it can't broadcast to a hospital that
      would legitimately need to decline (stale bed/capability data becomes a bigger risk here).

---

## 3. Replace polling with real-time push

**Current state:** `pollIncomingReferrals()` runs every 12s (`GET /api/v1/referral/incoming`),
`checkAndPollRecommendations()` runs every 4s (`GET /api/v1/referral/{id}/recommendations`), both
via the PHP proxy (`referral_api.php` / `send_referral.php`) to central FastAPI. Worst case,
a doctor's alarm for a critical incoming referral is delayed up to 12s.

**Recommendation (reasoned, not yet built):** favor **Server-Sent Events (SSE)** over full
WebSocket for this specific use case. The data flow is one-directional (server → browser: "new
referral," "referral accepted," "patient arrived"); the browser never needs to push data back over
the same channel since accept/redirect/arrive already go through normal PATCH requests. SSE gets
push notifications with a fraction of WebSocket's complexity:

- FastAPI supports it natively via `StreamingResponse` with `text/event-stream`.
- Browser-native `EventSource` auto-reconnects on drop — no reconnect logic to write.
- No bidirectional connection-manager data structure needed server-side, unlike WebSocket.

Full WebSocket would only be worth the extra complexity (persistent per-facility connection
tracking, auth-over-socket, manual reconnect handling, a PHP-side bridging story since PHP has no
native long-lived socket server) if we needed the browser to push data back over the same channel,
which we don't.

**Phased implementation plan (not started):**

- [ ] **Phase 1 — central (FastAPI):** add an SSE endpoint, e.g.
      `GET /api/v1/referral/stream` (or per-facility `/api/v1/referral/stream/{facility_code}`),
      authenticated the same way as existing endpoints (API key or three-layer auth headers,
      passed however SSE allows — likely a signed query param since `EventSource` can't set custom
      headers). Needs an in-process pub/sub (e.g. an `asyncio.Queue` per connected facility, or a
      simple broadcast list) that `initiate_referral()`, the respond/finalize/arrive handlers push
      events into.
- [ ] **Phase 2 — PHP bridge:** decide whether the browser connects directly to central FastAPI's
      SSE endpoint (bypassing the PHP proxy for this one channel — simpler, but means the browser
      needs a way to authenticate directly against central rather than via the PHP session), or
      whether `referral_api.php` needs to proxy a streaming response (more consistent with the
      current architecture, but PHP streaming proxies are more fragile).
- [ ] **Phase 3 — frontend:** replace `setInterval(pollIncomingReferrals, 12000)` and
      `setInterval(checkAndPollRecommendations, 4000)` with `EventSource` listeners; keep a slower
      poll (e.g. every 60s) as a fallback/reconciliation sync in case an event is missed while
      disconnected, rather than removing polling entirely.
- [ ] **Phase 4 — testing:** verify reconnect behavior (closing laptop lid, WiFi drop, tab
      backgrounding), and verify multiple browser tabs for the same facility don't double-fire
      alarms.

**Not recommended right now:** doing this before Phase 1-2 are validated on a small facility
subset — this is infrastructure work, higher risk than the UI/data work done so far, and should be
scheduled as a dedicated block rather than squeezed in alongside feature work.

---

## Summary priority order (suggested, not decided)

1. Clarify the "no reject" policy question (§2) — blocks nothing else, but needs a stakeholder
   answer before any related code is touched.
2. Small UI gap: surface "Transferred In" origin on Patient Records (§1) — cheap, high clarity win.
3. SSE migration (§3) — larger effort, schedule as its own block once the above are settled.
