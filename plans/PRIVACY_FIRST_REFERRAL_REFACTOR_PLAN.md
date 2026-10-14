# Privacy-First Referral and Secure Exchange Refactor Plan

[All project plans](README.md)

## Objective

Redesign IRDSS so the Central Interoperability Layer coordinates and audits referrals without permanently storing the patient's complete identity. Full patient information remains encrypted in the sending and receiving hospitals and is disclosed to the selected receiving hospital only after acceptance.

This plan is a prerequisite for the remaining phases in `FHIR_CLINICAL_DATA_REFACTOR_PLAN.md`.

## Current implementation update — 2026-10-08

The current prototype uses **direct hospital-to-hospital recipient encryption**, replacing the central relay for new referrals. Central issues short-lived authorization and routing metadata; the receiver retrieves ciphertext directly from the sender. The sending hospital stores its encrypted referral snapshot locally, and the receiver decrypts and imports it locally. Existing vault referrals retain compatibility reads; vault files were not deleted.

Phase 4's direct-identity removal is implemented for new submissions. Phase 5's 60-second JWT authorization and current-destination validation, and Phase 6's recipient encryption are implemented through this direct-transfer path. Phase 7 uses the existing encrypted receiver import with local decryption added. mTLS, formal Provenance validation, linked onward-referral resources, and key rotation remain pending.

The phase descriptions below document the earlier relay design and its history; the current flow and tested scope are documented in [Direct Patient Transfer](../docs/DIRECT_PATIENT_TRANSFER.md).

## Target Workflow

```text
Sending hospital encrypted local record
  -> minimized routing referral
  -> Central IRDSS authentication, validation, and AI matching
  -> candidate hospital accepts or redirects
  -> Central IRDSS issues scoped authorization to the selected receiver
  -> receiver requests the snapshot directly from the sender
  -> sender encrypts the package with the receiver's public key
  -> receiver verifies, decrypts with its private key, and stores locally
  -> Central IRDSS retains workflow metadata without the identity package
```

If an accepted patient is referred onward, the current receiving hospital becomes the new sender. It creates an updated minimized routing referral, reruns hospital matching, and encrypts the complete updated Bundle for the newly selected facility.

## Security Layers

| Mechanism | IRDSS purpose | Implementation rule |
| --- | --- | --- |
| Existing public/private key | Sign and verify system requests | Retain the existing RSA request-signature flow. Do not reuse its private key as the local database encryption key. |
| JWT | Carry authenticated identity, scopes, recipient, and expiry | Issue short-lived tokens only after request-signature authentication. Use narrow audience and referral-specific scopes. |
| mTLS | Authenticate the connecting facility/system at the TLS layer | Add at the production reverse proxy or API gateway. Certificate identity must map to a registered facility code. |
| HTTPS/TLS | Encrypt all traffic in transit | Required outside isolated local development. Plain HTTP must not be used for production patient traffic. |
| FHIR Provenance/signature | Record clinical authorship and content integrity | Add Provenance for authored referral content; keep operational access events in AuditEvent. |
| Recipient payload encryption | Prevent Central IRDSS from reading full identity packages | Use a dedicated receiving-facility encryption certificate/key pair, separate from signing and local storage keys. |
| Local database encryption | Protect patient identity at rest in each hospital | Use AES-256-GCM with a dedicated facility-held key and authenticated field context. |

## Central Data Boundary

Central IRDSS may persist:

- Referral and workflow identifiers
- Pseudonymous patient token or keyed blind index
- Sending and selected receiving facility codes
- Minimum clinical routing summary required by the matching engine
- Triage, priority, capability requirements, and referral status
- ServiceRequest and Task identifiers
- Consent status and version, without the complete consent document where avoidable
- AuditEvent and Provenance metadata
- Expiry and delivery state for a temporary encrypted identity package

Central IRDSS must not permanently persist in readable or centrally decryptable form:

- Patient name
- Telephone number
- Complete residential address
- PhilHealth number
- Government identifiers
- Complete consent document
- Full longitudinal patient record
- Full accepted-referral Bundle after delivery and retention expiry

Clinical routing information is still sensitive health information. Access control, audit logging, retention limits, and encryption remain required even when direct identity is removed.

## Implementation Phases

### Phase 1: Data Contract and Local Cryptography Foundation

Status: Complete for prototype

- Approve the central/local/transient data classification.
- Define the two-stage routing and identity-transfer workflow.
- Add a local AES-256-GCM encryption helper.
- Add a separate keyed blind-index helper for exact duplicate lookup.
- Add environment-variable contracts for local encryption and blind-index keys.
- Add unit tests for round trip, context binding, tamper detection, legacy plaintext reads, and blind-index determinism.

Acceptance criteria:

- Signing and encryption keys have separate purposes.
- No encryption key is committed to source control or stored in the patient database.
- Encrypted values are versioned so future key rotation and algorithm migration are possible.
- Existing plaintext records remain readable during migration.

### Phase 2: Additive Local Database Migration

Status: Complete for prototype

- Add encrypted columns for direct identifiers.
- Add keyed blind-index columns needed for exact patient lookup.
- Add encryption version/key identifier metadata.
- Add encrypted attachment-storage metadata.
- Keep legacy plaintext columns temporarily for rollback and compatibility.

### Phase 3: Local Dual-Write and Dual-Read

Status: Complete for prototype

- Encrypt new and updated patient identity values before local persistence.
- Prefer encrypted columns on reads and fall back to legacy plaintext.
- Stop logging raw identity or encryption failures containing plaintext.
- Backfill existing local records in controlled batches.

### Phase 4: Minimized Central Routing Referral

Status: In progress

- Create a routing payload without direct patient identifiers.
- Replace the current unkeyed patient identity hash with a keyed pseudonymous token strategy.
- Persist only matching inputs and workflow metadata centrally.
- Mask patient identity in candidate-hospital notifications.

Current progress:

- New referrals no longer write direct patient identity or consent-signer identity into PostgreSQL referral columns.
- Thirty-four legacy referral identity records were moved from PostgreSQL into the encrypted expiring vault; zero direct-identity referral rows remained after verification.
- The existing initiation payload still carries the full identity to Central IRDSS so it can create the transitional encrypted vault package. Splitting this into a minimized routing request plus post-acceptance identity transfer remains pending.

### Phase 5: Acceptance Handshake and Scoped Authorization

Status: Not started

- Confirm the selected receiving facility.
- Issue a short-lived, referral-specific JWT for encrypted package upload/download.
- Include issuer, subject, audience, facility code, referral ID, scopes, issued-at, expiry, and token ID.
- Prevent replay and revoke tokens when the referral destination changes.

### Phase 6: Recipient-Encrypted FHIR Bundle Relay

Status: Not started

Transitional foundation implemented: Central IRDSS now uses an encrypted file vault outside PostgreSQL and deletes an identity package after the receiving hospital acknowledges successful encrypted local import. The vault currently uses a Central-held symmetric key; recipient-only public-key encryption remains the target for this phase.

- Register a dedicated payload-encryption public key for every facility.
- Encrypt the complete FHIR Bundle for the selected receiving facility.
- Store only ciphertext, checksum, recipient, creation time, and expiry centrally.
- Allow only the selected receiver to download it.
- Require receipt acknowledgment and automatically purge expired/delivered ciphertext.

### Phase 7: Receiving Hospital Import

Status: Not started

- Decrypt the package locally using the receiving facility's private key.
- Validate the FHIR Bundle, Provenance, references, and content checksum.
- Link or create the local patient using encrypted identity and blind indexes.
- Record an immutable local import and access audit event.

### Phase 8: Redirect and Onward Referral

Status: Not started

- Redirect before acceptance using the minimized routing referral.
- For onward referral, use updated clinical information and rerun AI matching.
- Create a new ServiceRequest and Task linked to the parent referral.
- Encrypt a new complete Bundle only for the newly selected facility.
- Revoke access held by a previous destination when appropriate.

### Phase 9: Transport and Clinical Trust

Status: Not started

mTLS is explicitly deferred until the PostgreSQL identity-removal and local-encryption workflow is stable. Existing RSA request signatures remain active during this work.

- Require HTTPS/TLS for all deployed endpoints.
- Add mTLS at the production gateway.
- Add FHIR Provenance for authorship and signatures.
- Add FHIR AuditEvent-compatible operational auditing.
- Test certificate rotation, JWT expiry, replay protection, and clock skew.

### Phase 10: Central Data Removal and Cutover

Status: Not started

- Stop writing direct patient identity to new central referrals.
- Verify receiving hospitals can import accepted referrals reliably.
- Migrate or securely remove existing central identity fields under an approved retention policy.
- Remove compatibility reads only after rollback and recovery testing.
- Document backup, restore, breach response, and key-recovery procedures.

## Key Management Rules

- Request-signing keys, payload-encryption keys, JWT signing keys, and local database encryption keys must be distinct.
- Private keys never leave the facility or designated secure key service.
- Production secrets belong in a secret manager, HSM, or protected deployment secret—not source control or ordinary database tables.
- Store a non-secret key identifier with ciphertext to support rotation.
- Backups containing encrypted patient data must also be encrypted and access-controlled.
- Key loss can make data unrecoverable; recovery and rotation procedures must be tested before production.
