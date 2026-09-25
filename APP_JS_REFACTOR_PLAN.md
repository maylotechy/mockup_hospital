# Frontend `app.js` Modularization Plan

## Objective

Split the current `frontend/js/app.js` into focused feature files while preserving existing behavior, jQuery event handling, shared session state, consent modules, and WebSocket updates.

The original file was approximately 4,992 lines. After Phases 1–3, `app.js` is approximately 3,750 lines and the extracted responsibilities now live in focused modules.

## Progress

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1: Core infrastructure | Completed | Added configuration, shared state, formatter, and UI modules; `app.js` now consumes them. |
| Phase 2: Navigation and authentication | Completed | Extracted session, login/logout, sidebar, role-based navigation, dashboard entry, and tab routing. |
| Phase 3: Patient features | Completed | Extracted patient listing, registration and duplicate handling, PhilHealth fields, and transferred-patient arrival/departure workflows. |
| Phase 4: Referral form and submission | Not started | Next planned implementation phase. |
| Phases 5–9 | Not started | Proceed in the documented order after each phase is verified. |

## Current Responsibilities

The existing `app.js` currently handles:

- API base URL configuration
- Session and authentication state
- Sidebar and tab navigation
- Role-based access and dashboard initialization
- Patient listing and registration (extracted in Phase 3)
- Referral form preparation and validation
- Referral submission
- Paper consent generation and printing
- Recommendations and facility selection
- Incoming and accepted patient workflows (transferred-patient actions extracted in Phase 3)
- Referral timelines and cancellation
- Incoming referral polling and notifications
- Referral decisions and redirect reasons
- Facility analytics and CSV export
- Audit logs
- User administration
- PSGC location selectors and geocoding
- WebSocket lifecycle and message routing
- Shared formatting, escaping, alerts, and toast notifications

There is also a duplicate `loadServiceAssessment()` function that should be consolidated during the refactor.

## Recommended Module Structure

```text
frontend/js/
├── app.js                         # Small bootstrap/initialization entry point
├── core/
│   ├── config.js                  # API URLs and static application configuration
│   ├── state.js                   # Logged-in user, facility, and active referral state
│   ├── api.js                     # Shared AJAX request helpers
│   ├── ui.js                      # Toasts, alerts, loading states, and error messages
│   ├── formatters.js              # Dates, ages, names, escaping, and printable values
│   └── navigation.js              # Sidebar, tabs, role-based navigation
├── auth/
│   └── session.js                 # Login, logout, session check, and dashboard entry
├── patients/
│   ├── patient-list.js            # Patient table and refresh actions
│   ├── patient-form.js            # Add/edit patient workflow and PhilHealth fields
│   └── transferred-patients.js    # Arrival, departure, and accepted-patient records
├── referrals/
│   ├── referral-form.js           # Form preparation, reasons, allergy fields, validation
│   ├── referral-submit.js         # Referral request creation and submission
│   ├── referral-list.js           # My Referrals table, filters, cancellation, timeline
│   ├── recommendations.js         # Recommendations, accepted hospitals, finalization
│   ├── incoming-referrals.js      # Polling, incoming details, decisions, redirects
│   ├── notifications.js           # Notification bell, toast, and alarm sounds
│   └── websocket.js               # Referral WebSocket connection and event routing
├── consent/
│   └── consent-print.js            # Printable referral consent and consent snapshot
├── analytics/
│   └── facility-analytics.js       # Charts, filters, and CSV export
├── admin/
│   ├── users.js                    # Facility user administration
│   ├── audit-logs.js               # System logs
│   └── service-assessment-loader.js # Bridge to the existing assessment module
├── location/
│   └── psgc-location.js            # PSGC cascades, coordinates, and geocoding
├── consent-scanner.js              # Existing standalone module
├── electronic-consent.js           # Existing standalone module
└── service_assessment.js           # Existing standalone module
```

## Shared Application Namespace

Use one controlled global namespace during the transition instead of creating many unrelated global variables.

```javascript
window.IRDSS = window.IRDSS || {
    config: {},
    state: {},
    api: {},
    ui: {},
    formatters: {},
    navigation: {},
    patients: {},
    referrals: {},
    consent: {},
    analytics: {},
    admin: {},
    location: {}
};
```

This staged namespace approach is safer for the current application than immediately changing everything to JavaScript ES modules because:

- Existing code uses jQuery and global browser libraries.
- The consent scanner and electronic consent scripts already communicate through `window` functions.
- The application is served through PHP and can continue using ordinary script tags.
- Features can be extracted one at a time without rewriting the whole frontend.

After the modular split is stable, a later migration to ES modules or a bundler can be considered.

## Shared State

Move mutable cross-feature values into `core/state.js`:

```javascript
IRDSS.state = {
    currentHospital: null,
    currentUser: null,
    currentReferralPatient: null,
    activeInitiatedReferralId: null,
    currentActiveReferralId: null
};
```

Feature-specific values should remain inside their feature modules. Examples include:

- Analytics chart instances inside `facility-analytics.js`
- Incoming notification collections inside `notifications.js`
- WebSocket retry state inside `websocket.js`
- PSGC caches inside `psgc-location.js`
- My Referrals cache inside `referral-list.js`

## Script Loading Order

Until ES modules are introduced, load scripts in dependency order:

```html
<script src="js/core/config.js"></script>
<script src="js/core/state.js"></script>
<script src="js/core/api.js"></script>
<script src="js/core/formatters.js"></script>
<script src="js/core/ui.js"></script>
<script src="js/location/psgc-location.js"></script>
<script src="js/patients/patient-list.js"></script>
<script src="js/patients/patient-form.js"></script>
<script src="js/patients/transferred-patients.js"></script>
<script src="js/consent/consent-print.js"></script>
<script src="js/referrals/referral-form.js"></script>
<script src="js/referrals/referral-submit.js"></script>
<script src="js/referrals/referral-list.js"></script>
<script src="js/referrals/recommendations.js"></script>
<script src="js/referrals/notifications.js"></script>
<script src="js/referrals/incoming-referrals.js"></script>
<script src="js/referrals/websocket.js"></script>
<script src="js/analytics/facility-analytics.js"></script>
<script src="js/admin/users.js"></script>
<script src="js/admin/audit-logs.js"></script>
<script src="js/admin/service-assessment-loader.js"></script>
<script src="js/core/navigation.js"></script>
<script src="js/auth/session.js"></script>
<script src="js/app.js"></script>
```

Existing third-party libraries and standalone consent scripts must remain in the correct relative order.

## Refactoring Phases

### Phase 1: Establish Core Infrastructure

Create:

- `core/config.js`
- `core/state.js`
- `core/formatters.js`
- `core/ui.js`

Move only low-risk helpers first:

- `escapeHtml`
- Date and age formatters
- Patient-name formatting
- Printable value helpers
- Toast and alert helpers
- Error-message cleanup

Acceptance criteria:

- Login page still loads.
- Toasts and error messages still render correctly.
- Existing patient and referral tables display the same values.

### Phase 2: Extract Navigation and Authentication

Move:

- Session checking
- Login and logout handlers
- Role-based navigation
- Sidebar behavior
- Tab switching
- Dashboard initialization

Keep `app.js` as the bootstrap that calls module initialization methods.

Acceptance criteria:

- Admin and clinical users see the correct navigation.
- Assessment lockout still works.
- Login, logout, refresh, and mobile sidebar behavior remain unchanged.

### Phase 3: Extract Patient Features

Move patient listing, patient registration, duplicate handling, PhilHealth fields, and transferred-patient arrival/departure workflows.

Acceptance criteria:

- Patients load and refresh.
- Add/edit patient works.
- Duplicate-patient choices work.
- Incoming patients can be added to local records.
- Arrival and departure actions retain loading indicators.

### Phase 4: Extract Referral Form and Submission

Move:

- Referral reason definitions and selectors
- Additional referral reasons
- Allergy and patient-status fields
- Form preparation and validation
- Referral submission and attachment upload

Expose only the minimal state and methods needed by the consent modules.

Acceptance criteria:

- Required fields are highlighted correctly.
- Multiple referral reasons are preserved.
- Paper, scanned, and electronic consent methods still work.
- The submitted payload remains unchanged before the separate FHIR migration begins.

### Phase 5: Extract Referral Views and Workflow

Separate:

- My Referrals list and timeline
- Recommendations and finalization
- Incoming referral polling
- Referral detail and decisions
- Redirect reasons
- Accepted and transferred patients

Acceptance criteria:

- Referral statuses remain accurate.
- A receiving facility sees only its assigned alerts.
- Accept, redirect, finalize, arrive, refer onward, and discharge continue working.

### Phase 6: Extract Notifications and WebSockets

Move polling state, notification-bell rendering, alarm handling, and WebSocket lifecycle into dedicated modules.

Ensure WebSocket messages trigger public feature refresh methods instead of calling private functions across files.

Acceptance criteria:

- Incoming-referral counts update.
- Polling fallback still works when WebSocket connection fails.
- Reconnect logic does not create duplicate sockets or timers.
- Notification sounds and bell entries do not duplicate.

### Phase 7: Extract Admin and Reporting Features

Move:

- User administration
- Facility analytics
- CSV export
- Audit logs
- Service Assessment bridge

Remove the duplicate `loadServiceAssessment()` definition and retain one implementation.

Acceptance criteria:

- User CRUD works.
- Analytics filters, graphs, and CSV export work.
- Audit logs load and refresh.
- Service Assessment loads exactly once.

### Phase 8: Extract PSGC and Geocoding

Move the reusable location cascade and geocoding cache into `location/psgc-location.js`.

Provide separate initialized instances for patient and referral forms without duplicating the location logic.

Acceptance criteria:

- Region, province, city, and barangay fields cascade correctly.
- Existing addresses prepopulate correctly.
- Coordinates still resolve with safe fallbacks.

### Phase 9: Reduce `app.js` to Bootstrap Code

The final `app.js` should only:

1. Wait for DOM readiness.
2. Configure global AJAX behavior.
3. Initialize modules in dependency order.
4. Start the session check.

Target size: fewer than 150 lines.

## Module Design Rules

- Each module owns its event bindings and feature-specific state.
- Each module exposes an `init()` method and only the public methods other modules require.
- Do not bind the same event in multiple files.
- Use delegated event handlers only for dynamically generated elements.
- Namespace jQuery events where practical, such as `.on('click.referrals', ...)`.
- Do not move code and change its behavior in the same step unless required.
- Avoid copying functions; move them and remove the original immediately after verification.
- Shared helpers belong in `core`, not duplicated across feature modules.
- Facility and user state must be read through `IRDSS.state`.
- API URLs must come from `IRDSS.config`.
- API errors must pass through one shared error formatter.
- Continue escaping server-provided text before inserting it into HTML.

## Verification Checklist After Every Phase

- Browser console contains no loading, reference, or duplicate-handler errors.
- Login and logout work for facility admins, doctors, and nurses.
- Desktop and mobile navigation work.
- Patient table and patient form work.
- Referral form validation and submission work.
- Consent printing, camera scanning, and electronic signature work.
- My Referrals, pending referrals, and incoming patients load.
- Accept, redirect, finalize, arrive, refer onward, and discharge work.
- Attachments can be uploaded and previewed.
- Notifications, polling, and WebSockets work without duplication.
- Analytics, CSV export, logs, users, and Service Assessment work.

## Recommended First Implementation Batch

Start with the low-risk foundation:

1. Create the `IRDSS` namespace.
2. Extract configuration and shared state.
3. Extract formatting and UI helpers.
4. Update existing calls to use the extracted helpers.
5. Verify all existing workflows before extracting the first major feature.

Do not combine this modularization with the FHIR payload refactor in the same commit. Finish and verify the structural split first so later FHIR changes occur in small, clearly owned modules.
