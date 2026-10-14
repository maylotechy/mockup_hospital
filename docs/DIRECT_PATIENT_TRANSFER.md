# Direct Hospital-to-Hospital Patient Transfer

Implemented for the local mock deployment on 2026-10-08.

## Current flow

1. The sending hospital validates the patient and consent locally. It encrypts the referral-time identity snapshot in its own MySQL `patient_transfer_outbox` table using the existing local AES-256-GCM key.
2. It sends Central IRDSS a random transfer identifier, a facility-scoped keyed patient token, age summary, gender, consent metadata without signer identity, and clinical routing inputs. Names, birth dates, phone numbers, addresses, PhilHealth identifiers, and signer identity are removed before transmission.
3. Central IRDSS performs the existing matching, acceptance, and finalization workflow. It creates no new `.identity` vault file.
4. Only after finalization, the chosen receiver obtains a 60-second RS256 JWT authorization from `/api/v1/referral/{id}/patient-details`. This includes the registered sender endpoint, recipient public encryption key, and referral context. Other hospitals receive HTTP 403.
5. The receiver backend calls the sender's `export_patient_transfer.php` endpoint. The sender verifies the pinned IoL authorization signature and checks the current destination again through `/api/v1/patient-transfer/validate`.
6. The sender encrypts the snapshot to the receiver's public key using a Sodium sealed box and signs the ciphertext and ticket with the existing RSA request-signing key.
7. The receiver verifies the source signature, decrypts using its own private transfer key, verifies referral/recipient context, and stores the imported record and snapshot under local AES-256-GCM encryption when arrival is recorded.

Central IRDSS does not carry or store the full identity package in this path. The sender must be reachable during retrieval. After local import, the receiver serves its encrypted local snapshot.

## Keys and registration

The mock deployment uses three distinct key purposes:

- Existing RSA system key: authenticate requests and sign the transfer response.
- Separate Sodium/X25519 payload pair per mock facility: encrypt for the receiver and decrypt locally.
- Separate central RSA authorization pair: sign and verify short-lived access tickets.

Local database AES keys remain separate. Hospital private transfer keys stay in `storage/patient_transfer/facility-{local_id}.key`. Central stores only public facility keys and approved endpoints in its ignored `storage/patient_transfer/facilities.json` directory. Its authorization private key cannot decrypt a patient package.

The initial directory maps central facility codes to local mock facility IDs. The prototype's existing RSA signing credential still represents the shared multi-hospital mock application; deployment to independently operated systems requires their own registered signing credentials and encryption pairs.

Provision this local installation with:

```powershell
cd C:\IRDSS\irdss_project
& C:\IRDSS\.venv\Scripts\python.exe -m scripts.setup_direct_patient_transfer
```

Provisioning is repeatable and preserves existing hospital private keys. It adds the local outbox table, pins the central authorization public key at the hospital, and registers matching hospitals. Remote hospital URLs must use HTTPS; HTTP is accepted only for loopback development endpoints. Redirects are disabled during package retrieval. Apache denies web access to the mock storage folder using `storage/.htaccess`.

## Migration boundary

- Newly initiated referrals must use `identity_mode: DIRECT`; full-identity initiation requests are rejected.
- Existing vault referrals retain the old reader and delivery acknowledgment so already sent referrals remain accessible. Existing vault files have not been removed.
- Patient duplicate tokens are now keyed and facility scoped. Cross-hospital identity deduplication needs a separate design; unrelated hospital keys do not yield a universal patient token.
- Clinical summaries still reside centrally for routing. Attachments retain their existing central storage workflow and are outside this identity-transfer change; moving consent/clinical attachment bytes to direct encrypted delivery is separate work.
- The hospital snapshot preserves the current custom referral document. This change does not convert it into a fully validated PH eReferral transaction Bundle.
- mTLS, formal FHIR Provenance verification, managed key rotation, and retention automation remain later work.

## Verification

The live cross-language test creates a synthetic referral, checks that identity is absent from central routing JSON and PostgreSQL identity columns, confirms no vault file is created, retrieves the record directly through the PHP sender endpoint, and decrypts it at the receiver. It also rejects pre-finalization access, wrong recipients, tampered/expired tickets, and changed destinations. Its synthetic local outbox and central referral records are deleted afterward.

```powershell
& C:\IRDSS\.venv\Scripts\python.exe -m unittest tests.test_direct_patient_transfer -v
```

The test requires Apache/MySQL and the central application on port 8081.

Reference: [PHP Sodium sealed-box documentation](https://www.php.net/manual/en/function.sodium-crypto-box-seal.php). Sealed boxes provide recipient-only encryption and ciphertext integrity; the separate RSA signature supplies sender authentication.
