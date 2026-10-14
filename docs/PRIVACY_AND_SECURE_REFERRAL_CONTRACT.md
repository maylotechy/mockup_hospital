# IRDSS Privacy and Secure Referral Contract

## Purpose

This contract defines the prototype boundary between hospital-owned patient records and the Central IRDSS referral-routing service.

## Data States

### Hospital-local persistent data

The sending and finalized receiving hospitals may retain the complete patient record required for care. Direct identifiers and sensitive documents must be encrypted locally at rest.

### Central persistent data

Central IRDSS retains only pseudonymous referral identifiers, the minimum clinical routing summary, facility identifiers, workflow status, timestamps, and audit metadata.

### Central transient data

For new direct-transfer referrals, Central IRDSS holds no identity package, even temporarily. It issues short-lived transfer authorization, and the receiving hospital retrieves recipient-encrypted identity directly from the sending hospital. Existing pre-cutover vault referrals retain compatibility reads. See [Direct Patient Transfer](DIRECT_PATIENT_TRANSFER.md) for the current prototype's scope, including the separate attachment workflow.

## Disclosure Stages

| Stage | Candidate hospital sees | Selected hospital receives | Central persistence |
| --- | --- | --- | --- |
| Matching | Masked patient token and minimum clinical summary | Same as other candidates | Routing summary and workflow metadata |
| Finalized to receiver | Selection confirmation | Recipient-encrypted snapshot directly from sender | Routing/workflow metadata and access authorization |
| Arrived | No additional identity | Locally decrypted patient record and updated observations | Status and audit metadata |
| Redirected/onward | Updated masked routing summary | New recipient-encrypted snapshot after selection | Routing/workflow metadata |
| Completed | Final workflow outcome | Hospital-owned clinical record | Minimum outcome and audit retention record |

## Cryptographic Separation

- RSA request signatures authenticate the sending system and protect request integrity.
- JWT authorizes a short-lived operation; it does not encrypt the patient payload.
- HTTPS/TLS protects data while travelling between systems.
- mTLS additionally authenticates both systems at the transport layer.
- Recipient encryption protects the full FHIR package from Central IRDSS and unintended facilities.
- AES-256-GCM protects sensitive values stored in each hospital's local database.
- FHIR Provenance records who authored or signed clinical content.
- AuditEvent records security-relevant access and workflow activity.

## Prototype Decisions

- Existing RSA request signing remains active during migration.
- Legacy plaintext local columns remain readable only during the additive migration.
- New cryptography uses explicit version prefixes and authenticated context.
- The mock-up may use environment-provided keys; production requires managed secrets and documented rotation/recovery.
- Central direct-identity removal occurs only after encrypted delivery and local import pass end-to-end tests.
