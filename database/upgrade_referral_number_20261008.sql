-- Stores the staff-facing referral number issued by IRDSS (REF-YYYYMM-NNNNN).
-- referral_id remains the random system key used for every API call; older
-- referrals keep a NULL referral_number and the UI falls back to referral_id.

ALTER TABLE initiated_referrals
    ADD COLUMN referral_number VARCHAR(20) NULL AFTER referral_id,
    ADD INDEX idx_initiated_referrals_referral_number (referral_number);
