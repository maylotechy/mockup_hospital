# Phase 6: Clinical urgency — prototype

The fields answer different questions:

| Field | Meaning | Example |
| --- | --- | --- |
| Triage acuity | How urgently the patient needs clinical attention; assigned by a doctor | IRDSS level 3 — Severe |
| Referral priority | How quickly the referral should be handled | urgent |
| Condition severity | How severe the diagnosed condition is; optional and not used as triage | SNOMED Severe — 24484000 |

## Testing

1. Hard-refresh the Mock Hospital page and sign in as a doctor.
2. Open a patient's referral form. Under Referral details, change triage to level 3: priority should become Urgent. Level 4 suggests ASAP and level 5 suggests STAT.
3. Check Override suggested priority, choose a different priority and enter a reason. Submission without an override reason must fail validation.
4. Set triage to level 1 and condition severity to Severe. Suggested priority must remain Routine; condition severity does not change hospital eligibility. It can still trigger an immediate clinical notification.
5. Complete the remaining required details and consent, then submit. Review Referral and receiving details should show all three concepts separately.
6. At the selected receiving facility, open the imported patient's details as a doctor and select Reassess clinical urgency. Change triage, provide a reason, and save. The new triage/priority/severity should appear after reopening details; audit history retains both values. A different facility or a non-doctor must not reassess.
7. An onward referral prefills the current triage, priority and condition severity. A carried-forward priority override requires a fresh justification.

The existing numeric severity field is retained for compatibility, but now represents triage. Older rows are not retrospectively assigned a condition-severity code. Printed/electronic consent labels now call that value Triage Acuity.

## Emergency recommendation behavior

For triage 5, the central recommendation endpoint does not call the ordinary FCM scoring algorithm. It rechecks eligibility among accepting hospitals, then orders valid candidates by capability count, distance, bed availability and ID. The UI labels this emergency ordering as AI bypassed, not an AI match percentage. Clinician destination confirmation remains required. This prototype does not autonomously dispatch a patient or comprehensively assess transfer safety.

## Audit and security

New PostgreSQL table: `referral_urgency_audits`, added by Alembic revision `e6a1c8f2b9d0`. Creation, priority override and reassessment retain account/role, facility, time, reason and previous/new values. The signed hospital system attests the clinical actor to IoL; the PHP platform enforces its logged-in doctor role. Central per-user authentication remains future work. Patient identity remains at hospitals under the existing encrypted direct-transfer workflow.

No Phase 7 FHIR resource construction is included yet. These validated urgency fields are an interim adapter for the forthcoming Condition and ServiceRequest resources.
