-- Electronic referral consent audit fields for the local mock-hospital record.
-- Run after upgrade_printable_referral_consent_20260908.sql.

ALTER TABLE referral_consents
    ADD COLUMN signer_type VARCHAR(40) NULL AFTER recorded_at,
    ADD COLUMN signer_name VARCHAR(255) NULL AFTER signer_type,
    ADD COLUMN representative_relationship VARCHAR(100) NULL AFTER signer_name,
    ADD COLUMN document_sha256 CHAR(64) NULL AFTER representative_relationship;

