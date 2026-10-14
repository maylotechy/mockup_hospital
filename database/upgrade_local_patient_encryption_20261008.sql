-- Additive foundation for hospital-local patient encryption.
-- Existing plaintext columns remain readable during migration and are removed
-- only after dual-read/backfill verification.

ALTER TABLE patients
    ADD COLUMN identity_ciphertext LONGTEXT NULL AFTER facility_id,
    ADD COLUMN identity_blind_index CHAR(64) NULL AFTER identity_ciphertext,
    ADD COLUMN identity_key_version VARCHAR(20) NULL AFTER identity_blind_index,
    ADD COLUMN transferred_snapshot_ciphertext LONGTEXT NULL AFTER transferred_details_snapshot,
    ADD INDEX idx_patients_identity_blind (facility_id, identity_blind_index),
    MODIFY first_name VARCHAR(50) NULL,
    MODIFY last_name VARCHAR(50) NULL,
    MODIFY dob DATE NULL,
    MODIFY gender ENUM('Male', 'Female', 'Other') NULL,
    MODIFY phone VARCHAR(20) NULL,
    MODIFY philhealth_member ENUM('Yes', 'No') NULL,
    MODIFY is_4ps_member ENUM('Yes', 'No') NULL;

ALTER TABLE initiated_referrals
    ADD COLUMN patient_name_ciphertext TEXT NULL AFTER patient_name,
    MODIFY patient_name VARCHAR(255) NULL;

ALTER TABLE audit_logs
    ADD COLUMN patient_name_ciphertext TEXT NULL AFTER patient_name;

ALTER TABLE referral_consents
    ADD COLUMN signer_name_ciphertext TEXT NULL AFTER signer_name,
    ADD COLUMN representative_relationship_ciphertext TEXT NULL AFTER representative_relationship;
