-- ========================================================
-- Database Schema for Multi-Tier Facility HIS
-- Database: hospital_db
-- ========================================================

CREATE DATABASE IF NOT EXISTS `hospital_db` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `hospital_db`;

DROP TABLE IF EXISTS `initiated_referrals`;
DROP TABLE IF EXISTS `service_assessments`;
DROP TABLE IF EXISTS `patients`;
DROP TABLE IF EXISTS `users`;
DROP TABLE IF EXISTS `facilities`;

-- ========================================================
-- Facilities Table (BHS / RHU / Hospital tiers)
-- ========================================================
CREATE TABLE `facilities` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `code` VARCHAR(20) NOT NULL UNIQUE,
  `name` VARCHAR(150) NOT NULL,
  `tier_level` ENUM('BHS', 'RHU', 'Level 1 Hospital', 'Level 2 Hospital', 'Level 3 Hospital') NOT NULL,
  `is_assessment_completed` BOOLEAN NOT NULL DEFAULT FALSE,
  `api_key` VARCHAR(64) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- Users Table (per-staff logins, scoped to a facility)
-- ========================================================
CREATE TABLE `users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `facility_id` INT NOT NULL,
  `username` VARCHAR(50) NOT NULL UNIQUE,
  `password` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `role` ENUM('facility_admin', 'doctor', 'nurse') NOT NULL,
  `license_number` VARCHAR(30) NULL,
  `trainings` TEXT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `fk_users_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- Patients Table (DOH iClinicSys-style enrollment record)
-- ========================================================
CREATE TABLE `patients` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `facility_id` INT NOT NULL,

  -- Demographics
  `first_name` VARCHAR(50) NOT NULL,
  `middle_name` VARCHAR(50) NULL,
  `last_name` VARCHAR(50) NOT NULL,
  `suffix` VARCHAR(10) NULL,
  `dob` DATE NOT NULL,
  `gender` ENUM('Male', 'Female', 'Other') NOT NULL,
  `civil_status` ENUM('Single', 'Married', 'Widow/er', 'Separated') NULL,
  `phone` VARCHAR(20) NOT NULL,

  -- Residential Address
  `region` VARCHAR(100) NULL,
  `province` VARCHAR(100) NULL,
  `city_municipality` VARCHAR(100) NULL,
  `barangay` VARCHAR(100) NULL,
  `zip_code` VARCHAR(10) NULL,

  -- Socio-Economic & Health Insurance
  `philhealth_member` ENUM('Yes', 'No') NOT NULL DEFAULT 'No',
  `philhealth_number` VARCHAR(20) NULL,
  `philhealth_status_type` ENUM('Member', 'Dependent') NULL,
  `is_4ps_member` ENUM('Yes', 'No') NOT NULL DEFAULT 'No',

  `created_by_user_id` INT NULL,

  -- Populated only when this patient record originated from an incoming referral marked
  -- "Arrived" -- lets Patient Records show where a transferred-in patient came from, and
  -- lets get_transferred_patient_details.php serve a local-first snapshot instead of
  -- re-fetching from the central IRDSS server every time.
  `source_referral_id` VARCHAR(100) NULL,
  `source_facility` VARCHAR(150) NULL,
  `transferred_address` VARCHAR(255) NULL,
  `transferred_details_snapshot` JSON NULL,

  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT `fk_patients_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_patients_created_by` FOREIGN KEY (`created_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- Service Assessments Table (streamlined DOH HFP checklist)
-- One row per facility -- completing it flips facilities.is_assessment_completed
-- ========================================================
CREATE TABLE `service_assessments` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `facility_id` INT NOT NULL UNIQUE,

  -- Bed Capacity Metrics
  `authorized_bed_capacity` INT NOT NULL DEFAULT 0,
  `functional_beds` INT NOT NULL DEFAULT 0,

  -- Critical Service Capabilities
  `has_icu` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_nicu` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_er_trauma` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_delivery_room` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_hemodialysis` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_blood_bank` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_ct_mri` BOOLEAN NOT NULL DEFAULT FALSE,

  -- Specialist Availability
  `has_cardiologist` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_obgyn` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_neurologist` BOOLEAN NOT NULL DEFAULT FALSE,
  `has_general_surgeon` BOOLEAN NOT NULL DEFAULT FALSE,

  `submitted_by_user_id` INT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT `fk_assessment_facility` FOREIGN KEY (`facility_id`) REFERENCES `facilities` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_assessment_submitted_by` FOREIGN KEY (`submitted_by_user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- Initiated Referrals Table (local best-effort log of every referral this facility
-- sent to the central IRDSS server, kept even if the central transmission failed)
-- ========================================================
CREATE TABLE `initiated_referrals` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `hospital_id` INT NOT NULL,
  `referral_id` VARCHAR(100) NULL,
  `patient_id` INT NOT NULL,
  `patient_name` VARCHAR(255) NOT NULL,
  `reason` VARCHAR(255) NULL,
  `chief_complaint` VARCHAR(255) NULL,
  `diagnosis` VARCHAR(255) NULL,
  `vital_bp` VARCHAR(20) NULL,
  `vital_hr` SMALLINT NULL,
  `vital_rr` SMALLINT NULL,
  `vital_temp_c` DECIMAL(4,1) NULL,
  `vital_o2sat` SMALLINT NULL,
  `status` VARCHAR(50) DEFAULT 'AWAITING',
  `sync_status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `http_status` SMALLINT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================================
-- Seed Data
-- ========================================================

-- Facilities spanning the full DOH tier hierarchy (BHS -> RHU -> Hospital Levels 1-3)
INSERT INTO `facilities` (`id`, `code`, `name`, `tier_level`, `is_assessment_completed`, `api_key`) VALUES
(1, 'BHS-MALAGOS', 'Malagos Barangay Health Station', 'BHS', FALSE, 'irdss_api_key_malagos_bhs_1a2b3c4d5e'),
(2, 'RHU-MINTAL', 'Mintal Rural Health Unit', 'RHU', FALSE, 'irdss_api_key_mintal_rhu_6f7g8h9i0j'),
(3, 'HOSP-STJUDE', 'St. Jude General Hospital', 'Level 1 Hospital', FALSE, 'irdss_api_key_stjude_9a8b7c6d5e4f3a'),
(4, 'HOSP-CITYCARE', 'City Care Medical Center', 'Level 2 Hospital', TRUE, 'irdss_api_key_citycare_1b2c3d4e5f6a'),
(5, 'HOSP-METRO', 'Metro Health Medical Center', 'Level 3 Hospital', FALSE, 'irdss_api_key_metro_9z8y7x6w5v4u');

-- Users (seeded with password: password123)
-- Facility administrators authenticate centrally via IRDSS login delegation.
-- Doctors and nurses remain authenticated locally for offline resilience.
INSERT INTO `users` (`id`, `facility_id`, `username`, `password`, `full_name`, `role`, `license_number`, `trainings`) VALUES
(4, 3, 'stjude_doctor', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Dr. Miguel Santos', 'doctor', '0123456', 'BLS Certification 2023, ACLS Training 2024'),
(5, 3, 'stjude_nurse', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Nurse Angela Cruz', 'nurse', 'N-002233', 'BLS Certification 2023'),
(7, 4, 'citycare_doctor', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Dr. Patricia Reyes', 'doctor', '0456789', 'ACLS Training 2024, PALS Certification 2022'),
(8, 4, 'citycare_nurse', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Nurse Bea Gonzales', 'nurse', 'N-004455', 'BLS Certification 2024'),
(10, 5, 'metro_doctor', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Dr. Isabel Mendoza', 'doctor', '0789012', 'ACLS Training 2023'),
(11, 5, 'metro_nurse', '$2y$10$Ph9ncmz1mnF1sVTf/5G33uIGmItImjInm/itSrkLmnQUvauYEww6S', 'Nurse Julius Ramos', 'nurse', 'N-006677', 'BLS Certification 2023, Basic Life Support Refresher 2025');


-- Sample Patients for St. Jude General Hospital (facility 3)
INSERT INTO `patients` (`facility_id`, `first_name`, `middle_name`, `last_name`, `suffix`, `dob`, `gender`, `civil_status`, `phone`, `region`, `province`, `city_municipality`, `barangay`, `zip_code`, `philhealth_member`, `philhealth_number`, `philhealth_status_type`, `is_4ps_member`, `created_by_user_id`) VALUES
(3, 'Maria', 'Lopez', 'Santos', NULL, '1988-04-12', 'Female', 'Married', '+639171234567', 'Region XI', 'Davao del Sur', 'Davao City', 'Talomo', '8000', 'Yes', 'PH-1234-5678-9012', 'Member', 'No', 4),
(3, 'Juan', 'Ramos', 'Dela Cruz', 'Jr.', '1975-11-23', 'Male', 'Married', '+639189876543', 'Region XI', 'Davao del Sur', 'Davao City', 'Buhangin', '8000', 'No', NULL, NULL, 'Yes', 5);

-- Sample Patients for City Care Medical Center (facility 4)
INSERT INTO `patients` (`facility_id`, `first_name`, `middle_name`, `last_name`, `suffix`, `dob`, `gender`, `civil_status`, `phone`, `region`, `province`, `city_municipality`, `barangay`, `zip_code`, `philhealth_member`, `philhealth_number`, `philhealth_status_type`, `is_4ps_member`, `created_by_user_id`) VALUES
(4, 'Elena', 'Bacani', 'Reyes', NULL, '1995-08-05', 'Female', 'Single', '+639205551234', 'Region XI', 'Davao del Sur', 'Davao City', 'Poblacion', '8000', 'Yes', 'PH-2234-5678-9013', 'Dependent', 'No', 7),
(4, 'Carlos', 'Uy', 'Mendoza', NULL, '1962-02-17', 'Male', 'Widow/er', '+639174448899', 'Region XI', 'Davao del Sur', 'Davao City', 'Matina', '8000', 'Yes', 'PH-3234-5678-9014', 'Member', 'No', 8);

-- Sample Patients for Metro Health Medical Center (facility 5)
INSERT INTO `patients` (`facility_id`, `first_name`, `middle_name`, `last_name`, `suffix`, `dob`, `gender`, `civil_status`, `phone`, `region`, `province`, `city_municipality`, `barangay`, `zip_code`, `philhealth_member`, `philhealth_number`, `philhealth_status_type`, `is_4ps_member`, `created_by_user_id`) VALUES
(5, 'Antonio', 'Bermudez', 'Luna', NULL, '1980-10-29', 'Male', 'Married', '+639193332211', 'Region XI', 'Davao del Sur', 'Davao City', 'Toril', '8000', 'No', NULL, NULL, 'Yes', 10),
(5, 'Sofia', 'Castillo', 'Gonzales', NULL, '1992-06-14', 'Female', 'Single', '+639157778899', 'Region XI', 'Davao del Sur', 'Davao City', 'Agdao', '8000', 'Yes', 'PH-4234-5678-9015', 'Member', 'No', 11);

-- Completed Service Assessment for City Care Medical Center (facility 4) -- demonstrates the unlocked state
INSERT INTO `service_assessments` (`facility_id`, `authorized_bed_capacity`, `functional_beds`, `has_icu`, `has_nicu`, `has_er_trauma`, `has_delivery_room`, `has_hemodialysis`, `has_blood_bank`, `has_ct_mri`, `has_cardiologist`, `has_obgyn`, `has_neurologist`, `has_general_surgeon`, `submitted_by_user_id`) VALUES
(4, 120, 98, TRUE, FALSE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, 7);
