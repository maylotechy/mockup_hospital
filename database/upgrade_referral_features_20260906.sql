-- Multiple referral reasons for the Laragon hospital's local referral history.
-- Clinical attachment metadata/files remain protected on the central IOL server.

CREATE TABLE IF NOT EXISTS initiated_referral_reasons (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    initiated_referral_id INT NOT NULL,
    reason_code VARCHAR(100) NOT NULL,
    reason_label VARCHAR(255) NOT NULL,
    is_primary TINYINT(1) NOT NULL DEFAULT 0,
    sort_order TINYINT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_initiated_referral_reason_order (initiated_referral_id, sort_order),
    KEY idx_initiated_referral_reason_referral (initiated_referral_id),
    CONSTRAINT fk_initiated_referral_reason_referral
        FOREIGN KEY (initiated_referral_id) REFERENCES initiated_referrals(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO initiated_referral_reasons
    (initiated_referral_id, reason_code, reason_label, is_primary, sort_order)
SELECT
    ir.id,
    UPPER(TRIM(BOTH '_' FROM REGEXP_REPLACE(ir.reason, '[^A-Za-z0-9]+', '_'))),
    ir.reason,
    1,
    0
FROM initiated_referrals ir
WHERE ir.reason IS NOT NULL
  AND TRIM(ir.reason) <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM initiated_referral_reasons irr
      WHERE irr.initiated_referral_id = ir.id
  );
