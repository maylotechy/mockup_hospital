-- Phase 2: additive FHIR clinical coding foundation for the Mock Hospital.
-- Existing diagnosis, chief_complaint, disease severity, and vital columns are
-- intentionally retained for compatibility with current referral payloads.

ALTER TABLE `initiated_referrals`
  ADD COLUMN `diagnosis_system` VARCHAR(255) NULL AFTER `diagnosis`,
  ADD COLUMN `diagnosis_code` VARCHAR(100) NULL AFTER `diagnosis_system`,
  ADD COLUMN `diagnosis_display` VARCHAR(255) NULL AFTER `diagnosis_code`,
  ADD COLUMN `diagnosis_text` TEXT NULL AFTER `diagnosis_display`,
  ADD COLUMN `chief_complaint_text` TEXT NULL AFTER `diagnosis_text`,
  ADD COLUMN `chief_complaint_system` VARCHAR(255) NULL AFTER `chief_complaint_text`,
  ADD COLUMN `chief_complaint_code` VARCHAR(100) NULL AFTER `chief_complaint_system`,
  ADD COLUMN `chief_complaint_display` VARCHAR(255) NULL AFTER `chief_complaint_code`,
  ADD COLUMN `triage_system` VARCHAR(255) NULL AFTER `chief_complaint_display`,
  ADD COLUMN `triage_code` VARCHAR(50) NULL AFTER `triage_system`,
  ADD COLUMN `triage_display` VARCHAR(100) NULL AFTER `triage_code`,
  ADD COLUMN `referral_priority` VARCHAR(20) NULL AFTER `triage_display`,
  ADD COLUMN `condition_severity_system` VARCHAR(255) NULL AFTER `referral_priority`,
  ADD COLUMN `condition_severity_code` VARCHAR(100) NULL AFTER `condition_severity_system`,
  ADD COLUMN `condition_severity_display` VARCHAR(255) NULL AFTER `condition_severity_code`,
  ADD COLUMN `fhir_condition_id` VARCHAR(100) NULL AFTER `condition_severity_display`,
  ADD COLUMN `fhir_service_request_id` VARCHAR(100) NULL AFTER `fhir_condition_id`,
  ADD INDEX `idx_initiated_referrals_diagnosis_code` (`diagnosis_code`),
  ADD INDEX `idx_initiated_referrals_triage_code` (`triage_code`),
  ADD INDEX `idx_initiated_referrals_priority` (`referral_priority`),
  ADD INDEX `idx_initiated_referrals_fhir_condition` (`fhir_condition_id`),
  ADD INDEX `idx_initiated_referrals_fhir_service_request` (`fhir_service_request_id`);

CREATE TABLE IF NOT EXISTS `initiated_referral_observations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `initiated_referral_id` INT NOT NULL,
  `fhir_observation_id` VARCHAR(100) NULL,
  `loinc_code` VARCHAR(50) NOT NULL,
  `display` VARCHAR(255) NULL,
  `value_numeric` DECIMAL(12,4) NULL,
  `unit_code` VARCHAR(50) NULL,
  `unit_display` VARCHAR(100) NULL,
  `measurement_context` VARCHAR(20) NOT NULL DEFAULT 'referral',
  `observed_at` DATETIME(6) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_initiated_observation_fhir_id` (`fhir_observation_id`),
  KEY `idx_initiated_observation_ref_context` (`initiated_referral_id`, `measurement_context`),
  KEY `idx_initiated_observation_ref_loinc` (`initiated_referral_id`, `loinc_code`),
  CONSTRAINT `fk_initiated_observation_referral`
    FOREIGN KEY (`initiated_referral_id`) REFERENCES `initiated_referrals` (`id`)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
