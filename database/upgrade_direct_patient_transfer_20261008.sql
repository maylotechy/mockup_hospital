CREATE TABLE IF NOT EXISTS patient_transfer_outbox (
  transfer_id VARCHAR(35) PRIMARY KEY,
  facility_id INT NOT NULL,
  patient_id INT NOT NULL,
  snapshot_ciphertext MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_transfer_facility (facility_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
