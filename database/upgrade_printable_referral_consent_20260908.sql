-- Printable referral consent audit metadata for the mock hospital database.
-- The paper original remains with the referring hospital. An optional scanned
-- copy is stored by IOL as a protected referral attachment.

CREATE TABLE IF NOT EXISTS referral_consents (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    initiated_referral_id INT NOT NULL,
    central_referral_id VARCHAR(100) NULL,
    status VARCHAR(30) NOT NULL,
    method VARCHAR(20) NOT NULL,
    consent_text_version VARCHAR(50) NOT NULL,
    witnessed_by VARCHAR(255) NOT NULL,
    recorded_at DATETIME NOT NULL,
    signed_copy_uploaded TINYINT(1) NOT NULL DEFAULT 0,
    central_attachment_id VARCHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_referral_consents_local_referral (initiated_referral_id),
    KEY idx_referral_consents_central_referral (central_referral_id),
    CONSTRAINT fk_referral_consents_initiated_referral
        FOREIGN KEY (initiated_referral_id) REFERENCES initiated_referrals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
