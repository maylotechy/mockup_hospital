# Frontend PHP Template Refactor Plan

[All project plans](README.md)

## Objective

Replace the large `frontend/index.html` with a small `frontend/index.php` entry point and focused PHP view files. Preserve the existing layout, JavaScript modules, backend APIs, security boundaries and referral workflows. This is a maintainability refactor, not a redesign or a rewrite of the application.

Status: Planned. No HTML-to-PHP migration has started.

## Feasibility

The application already uses PHP backend endpoints and runs through Laragon/Apache, so server-side template includes fit the current setup. The work is moderate: extracting markup is straightforward; preserving DOM structure, IDs, script order and URLs requires careful testing. Renaming the file alone will not reduce its size.

PHP assembles the page on the server; JavaScript continues to handle navigation, forms, API calls and live updates. Included files can contain ordinary HTML. No framework or ES-module migration is required. PHP rendering alone does not add authentication or replace backend authorization.

## Proposed structure

```text
frontend/
  index.php
  index.html                  # Temporary compatibility redirect after cutover
  views/
    layout/
      head.php
      sidebar.php
      header.php
      scripts.php
    auth/
      login.php
    pages/
      patient-records.php
      refer-patient.php
      my-referrals.php
      pending-referrals.php
      incoming-patients.php
      administration.php
      analytics.php
      audit-logs.php
    shared/
      dialogs.php
  js/                         # Existing feature modules remain
  index.css
```

Finalize file boundaries after inspecting actual page containers. JavaScript-generated SweetAlert dialogs remain in their existing JS modules; do not duplicate them in PHP.

## Phases

| Phase | Work | Acceptance criteria | Status |
| --- | --- | --- | --- |
| 1. Inventory and baseline | Identify page boundaries, shared markup, DOM IDs, asset paths, navigation links and script dependencies. Record representative workflow checks. | A complete extraction map and baseline checks exist; no behavior changes. | Not started |
| 2. PHP entry point and layout | Add `index.php`; extract head, sidebar, header and script includes. Keep existing body markup and script order intact. | New entry point renders correctly through Apache; existing HTML entry remains available during comparison. | Not started |
| 3. Authentication and patient views | Extract login, patient records and referral form into focused views. | Login/logout, patient registration, referral validation, coding, vitals and consent still work. | Not started |
| 4. Referral workflow views | Extract My Referrals, pending referrals and incoming patients. Preserve all event hooks. | Tracking, cancellation conflicts, acceptance, selection, encrypted patient transfer, arrival and onward referral work. | Not started |
| 5. Administration and shared UI | Extract administrative/reporting views and remaining static dialogs. Remove duplicated markup only after verifying references. | Role-specific views, reports, audit logs and shared controls retain their behavior; IDs remain unique. | Not started |
| 6. Cutover and regression checks | Update actual navigation links and entry URLs; support old `index.html` bookmarks with a tested redirect. Run syntax, DOM and workflow checks. | PHP entry is the default; old links still resolve; mobile layouts and API paths work; no unintended security changes. | Not started |

## Implementation rules

- Use fixed, explicit `require __DIR__ . '/views/...'` paths. Never derive include paths from request parameters.
- Keep the browser-facing asset URLs relative to `frontend/index.php`; include-file folders do not change the browser's URL base.
- Preserve IDs, class/event hooks, page wrappers, form fields and script dependency order.
- Keep presentation views separate from backend business logic, database operations and keys.
- Escape any new server-rendered dynamic values with `htmlspecialchars` and appropriate flags/encoding.
- Keep authentication and facility/role authorization enforced by existing backend endpoints. Hidden UI elements are not access control.
- Prevent direct standalone rendering of internal PHP views using an entry-point guard if applicable.
- Keep source files and existing work recoverable through version control; do not delete unrelated connectathon or clinical implementation files.
- Do not add dependencies, redesign unrelated pages or change referral contracts as part of this extraction.

## Verification

Run PHP syntax checks for every new view and entry point, plus existing JavaScript regression checks. Compare rendered DOM IDs, expected page containers and asset references against the baseline. Test through Apache, not by opening PHP files directly from disk.

Manually verify desktop/mobile layouts, authentication, patient forms, diagnosis/symptom searches, clinical measurement times, consent, submission, hospital selection, tracking, stale acceptance after cancellation, arrival/departure, onward referral and role-restricted administration. Confirm signed API calls, WebSocket/polling and encrypted patient transfer remain unchanged.

## Completion

The frontend entry point is concise, feature markup lives in clearly named views, old entry links are compatible, and the existing hospital workflows behave the same. Update this plan after each completed phase with checks performed and any remaining limitations.
