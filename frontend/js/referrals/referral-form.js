(function initializeIrdssReferralForm(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, formatPatientName, calculatePrintableAge, calculateAgeYears } = IRDSS.formatters;
    const { switchTab, getHospitalLogoPath } = IRDSS.navigation;
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    /**
     * Fetches a patient's local record and opens/pre-fills the Refer Patient form for
     * them -- shared by the Patient Records "Refer" button and, separately, the "Refer
     * to Another Facility" option on an already-transferred-in patient's Mark as Out
     * flow, so re-referring a patient onward always goes through this one real path
     * instead of a redundant manual "Transferred" label.
     *
     * @param {number} patientId
     * @param {jQuery|null} $btn - triggering button, gets a loading spinner while fetching
     * @param {object|null} clinicalData - when re-referring an already transferred-in
     *   patient, their last known vitals/status/severity/timestamp (see the
     *   "Referred to Another Facility" branch below for how this is built). Never
     *   passed for a brand-new patient -- there's no prior clinical data to reuse.
     */
    function openReferralFormForPatientId(patientId, $btn, clinicalData) {
        const originalText = $btn ? $btn.html() : null;
        if ($btn) $btn.html('<span class="spinner-border spinner-border-sm" role="status"></span>').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/get_patients.php`,
            type: 'GET',
            data: { id: patientId },
            dataType: 'json',
            success: function (response) {
                if ($btn) $btn.html(originalText).prop('disabled', false);

                if (response.success && response.data) {
                    const patient = response.data;
                    state.currentReferralPatient = patient;

                    // Clean slate every time -- without this, a partially-filled-then-
                    // abandoned re-referral (with prefilled vitals) could leak into the
                    // next patient's form if the doctor opens a normal "Refer" afterward.
                    $('#referralForm')[0].reset();
                    IRDSS.diagnosis.set();
                    IRDSS.symptom.set();
                    IRDSS.urgency.set(clinicalData || {});
                    IRDSS.vitals.set(clinicalData || {});
                    resetAdditionalReferralReasons();

                    $('#modalPatientId').val(patient.id);
                    $('#modalPatientName').text(formatPatientName(patient));
                    $('#modalPatientDob').text(patient.dob);
                    const patientAgeYears = calculateAgeYears(patient.dob);
                    $('#modalPatientAge').text(calculatePrintableAge(patient.dob));
                    $('#modalPatientGender').text(patient.gender);
                    $('#modalPatientPhone').text(patient.phone || 'N/A');
                    $('#modalPatientPhoneField').toggleClass('hidden', !patient.phone);

                    // Pregnancy is not applicable to male patients, so the option is hidden
                    const isMale = String(patient.gender || '').trim().toLowerCase() === 'male';
                    $('#modalIsPregnant').prop('disabled', isMale).prop('checked', false);
                    $('#modalIsPregnantOption').toggleClass('hidden', isMale);

                    switchTab('referPatient');
                    // Pre-fill the location selector from the patient's own registered
                    // address instead of always defaulting to Davao City
                    runAction('initializeReferralLocation', {
                        region: patient.region,
                        province: patient.province,
                        city: patient.city_municipality,
                        barangay: patient.barangay
                    });

                    if (clinicalData) {
                        IRDSS.diagnosis.set(clinicalData);
                        IRDSS.symptom.set(clinicalData);
                        $('#modalChiefComplaint').val(clinicalData.chief_complaint_text || clinicalData.chief_complaint || '');
                        if (clinicalData.vital_bp) {
                            const bpParts = String(clinicalData.vital_bp).split('/');
                            $('#modalVitalBpSystolic').val(bpParts[0] || '');
                            $('#modalVitalBpDiastolic').val(bpParts[1] || '');
                        }
                        if (clinicalData.vital_hr) $('#modalVitalHr').val(clinicalData.vital_hr);
                        if (clinicalData.vital_rr) $('#modalVitalRr').val(clinicalData.vital_rr);
                        if (clinicalData.vital_temp_c) $('#modalVitalTemp').val(clinicalData.vital_temp_c);
                        if (clinicalData.vital_o2sat) $('#modalVitalO2sat').val(clinicalData.vital_o2sat);
                        if (clinicalData.vital_height_cm) $('#modalVitalHeight').val(clinicalData.vital_height_cm);
                        if (clinicalData.vital_weight_kg) $('#modalVitalWeight').val(clinicalData.vital_weight_kg);

                        $('#modalIsPwd').prop('checked', !!clinicalData.is_pwd);
                        $('#modalIsPregnant').prop('checked', !isMale && !!clinicalData.is_pregnant);
                        $('#modalHasAllergy').prop('checked', !!clinicalData.has_allergy);
                        if (clinicalData.has_allergy && clinicalData.allergy_details) {
                            $('#modalAllergyDetails').val(clinicalData.allergy_details);
                        }

                        if (clinicalData.disease_severity) $('#modalSeverity').val(clinicalData.disease_severity);

                        // Vitals are a reading from a point in time, not a static fact like
                        // PWD/pregnant status -- flag prominently that they may be stale
                        // instead of letting them look like a just-taken measurement.
                        if (clinicalData.vitalsAsOf) {
                            $('#modalVitalsPrefillTimestamp').text(runAction('formatReferralTimestamp', clinicalData.vitalsAsOf));
                            $('#modalVitalsPrefillNotice').removeClass('hidden');
                        }
                    } else {
                        $('#modalVitalsPrefillNotice').addClass('hidden');
                    }

                    const isSeniorCitizen = patientAgeYears !== null && patientAgeYears >= 60;
                    // Senior status comes from the date of birth; only shown when it applies
                    $('#modalIsSeniorCitizen')
                        .prop('checked', isSeniorCitizen)
                        .prop('disabled', true);
                    $('#modalIsSeniorCitizenOption').toggleClass('hidden', !isSeniorCitizen);
                    $('#modalSeniorCitizenNote').text(isSeniorCitizen ? `(${patientAgeYears} years old)` : '');

                    updateReasonDropdown();
                    toggleAllergyDetails();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: response.message || 'Could not fetch patient details.',
                        confirmButtonColor: '#2563eb'
                    });
                }
            },
            error: function (xhr) {
                if ($btn) $btn.html(originalText).prop('disabled', false);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: `Failed to fetch patient data (${xhr.status}).`,
                    confirmButtonColor: '#2563eb'
                });
            }
        });
    }

    const REFERRAL_REASONS = {
        HUMAN_RESOURCE: [
            'No Available Anaesthesiologist', 'No Available Cardiologist', 'No Available Cardio Thoracic Surgeon',
            'No Available Dentist', 'No Available Dermatologist', 'No Available Endocrinologist', 'No Available Orthodontist',
            'No Available Rheumatologist', 'No Available Urologist', 'No Available General Physician',
            'No Available Family Medicine Physician', 'No Available General Surgeon', 'No Available Critical Care Surgeon',
            'No Available Internal Medicine', 'No Available Neurologist', 'No Available Gastroenterologist',
            'No Available Toxicologist', 'No Available Neonatologist', 'No Available Nephrologist', 'No Available Neurosurgeon',
            'No Available Obstetrician-Gynecologist', 'No Available Oncologist', 'No Available Ophthalmologist',
            'No Available Haematologist', 'No Available Colorectal Surgeon', 'No Available ENT Specialist',
            'No Available Orthopaedic Surgeon', 'No Available Paediatrician', 'No Available Psychiatrist',
            'No Available Diabetologist', 'No Available Pulmonologist'
        ],
        HEALTH_FACILITY: [
            'No Available Delivery Room', 'No Available Operating Room', 'No Available Intensive Care Unit',
            'No Available Coronary Care Unit', 'No Available Critical Care Unit (CCU)', 'No Available Neonatal Intensive Care Unit',
            'No Available Pediatrics Intensive Care Unit', 'No Available Burn Unit', 'No Available CoVid19 Isolation',
            'Full Delivery Room', 'Full Operating Room', 'Full Intensive Care Unit', 'Full Coronary Care Unit',
            'Full Critical Care Unit (CCU)', 'Full Neonatal Intensive Care Unit', 'Full Pediatrics Intensive Care Unit',
            'Full Burn Unit', 'Full CoVid19 Isolation'
        ],
        MEDICATION: [
            'No Available Anaesthesia Medication', 'No Available Anti-Convulsant Medication', 'No Available Epinephrine',
            'No Available Anti-Rabies Vaccine', 'No Available Anti-Tetanus Vaccine', 'No Available Anti-Venom',
            'No Available Thrombolytic Medication', 'No Available Blood Product', 'No Available Dialysis Medication',
            'No Available Insulin', 'No Available MGSO4', 'No Available Nitroglycerine'
        ],
        DIAGNOSTIC_EQUIPMENT: [
            'No Available Mammogram Machine', 'No Available Cardiac Monitor', 'No Available Anaesthesia Machine',
            'No Available CT Scan Machine', 'No Available 2D Echo Ultrasound Machine', 'No Available Ultrasonography Machine',
            'No Available Endoscopy Machine', 'No Available Colonoscopy Machine', 'No Available MRI Machine',
            'No Available Incubator', 'No Available ECG Machine', 'No Available Dental X-Ray', 'No Available X-Ray Machine',
            'No Available PET Scan', 'Non Functional Ultrasonography Machine', 'Non Functional Endoscopy Machine',
            'Non Functional 2D Echo Ultrasound Machine', 'Non Functional Colonoscopy Machine', 'Non Functional CT Scan Machine',
            'Non Functional Mechanical Ventilator', 'Non Functional Mammogram Machine', 'Non Functional Cardiac Monitor',
            'Non Functional Anaesthesia Machine', 'Non Functional MRI Machine', 'Non Functional Incubator',
            'Non Functional ECG Machine', 'Non Functional X-Ray Machine', 'Non Functional PET Scan'
        ],
        HEALTH_SERVICES: [
            'No Available Animal Bite Center Services', 'No Available Safe Birthing Facility Services',
            'No Available Dental Services', 'No Available Dialysis Services', 'No Available Laboratory Services',
            'No Available Surgical Services', 'No Available Ultrasound Services', 'No Available X-Ray Services',
            'No Available Endoscopy Services', 'No Available Colonoscopy Services', 'No Available Mammogram Services',
            'No Available Patient Admission Services', 'No Available Admission Services',
            'No Animal Bite Center Services Beyond Operating Hours', 'No Safe Birthing Facility Services Beyond Operating Hours',
            'No Dental Services Beyond Operating Hours', 'No Dialysis Services Beyond Operating Hours',
            'No Laboratory Services Beyond Operating Hours', 'No Surgical Services Beyond Operating Hours',
            'No Ultrasound Services Beyond Operating Hours', 'No X-Ray Services Beyond Operating Hours',
            'No Endoscopy Services Beyond Operating Hours', 'No Colonoscopy Services Beyond Operating Hours',
            'No Mammogram Services Beyond Operating Hours'
        ],
        MEDICAL_PROCEDURE: [
            'No Available Chest Tube Thoracostomy'
        ]
    };

    function referralReasonCode(label) {
        return String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
    }

    function referralReasonsText(data) {
        const reasons = Array.isArray(data?.referral_reasons) ? data.referral_reasons : [];
        if (!reasons.length) return data?.clinical_reason || data?.reason_text || data?.reason || 'Referral Request';
        return reasons.map((reason, index) => `${index === 0 || reason.is_primary ? 'Primary: ' : 'Additional: '}${reason.label || reason.text || reason.code}`).join(' • ');
    }

    function attachmentLinksHtml(referralId, attachments) {
        if (!Array.isArray(attachments) || !attachments.length) return '<p class="text-xs text-slate-400">No clinical attachments.</p>';
        return attachments.map(file => {
            const stage = file.attachment_type === 'CONSENT_FORM'
                ? 'Signed consent'
                : (file.workflow_stage === 'DEPARTURE' ? 'Departure result' : 'Referral document');
            return `<button type="button" class="btn-preview-referral-attachment w-full flex items-center justify-between gap-3 py-2 text-left text-sm text-blue-700 hover:underline border-b border-slate-100 last:border-0" data-referral-id="${escapeHtml(referralId)}" data-attachment-id="${escapeHtml(file.id)}" data-filename="${escapeHtml(file.original_filename || 'Attachment')}" data-mime-type="${escapeHtml(file.mime_type || '')}"><span><i class="bi bi-paperclip me-1"></i>${escapeHtml(file.original_filename || 'Attachment')}</span><span class="text-[10px] text-slate-400">${escapeHtml(stage)} · Preview</span></button>`;
        }).join('');
    }

    $(document).on('click.referralForm', '.btn-preview-referral-attachment', function () {
        const referralId = String($(this).data('referral-id'));
        const attachmentId = String($(this).data('attachment-id'));
        const filename = String($(this).data('filename') || 'Attachment');
        const mimeType = String($(this).data('mime-type') || '');
        const baseUrl = `${API_BASE}/download_referral_attachment.php?referral_id=${encodeURIComponent(referralId)}&attachment_id=${encodeURIComponent(attachmentId)}`;
        const previewUrl = `${baseUrl}&preview=1`;
        const previewHtml = mimeType === 'application/pdf'
            ? `<iframe src="${previewUrl}" title="${escapeHtml(filename)}" class="w-full h-[65vh] rounded-lg border border-slate-200"></iframe>`
            : `<div class="flex justify-center bg-slate-100 rounded-lg p-3 max-h-[65vh] overflow-auto"><img src="${previewUrl}" alt="${escapeHtml(filename)}" class="max-w-full h-auto object-contain rounded"></div>`;

        Swal.fire({
            title: escapeHtml(filename),
            width: '64rem',
            html: `${previewHtml}<div class="mt-3 text-center"><a href="${baseUrl}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="bi bi-download"></i> Download File</a></div>`,
            confirmButtonText: 'Close',
            confirmButtonColor: '#64748b',
            customClass: { popup: 'rounded-3xl shadow-xl' }
        });
    });

    function populateAdditionalReferralReasonSelect($select) {
        $select.empty().append('<option value="" selected hidden disabled>select additional reason...</option>');
        Object.keys(REFERRAL_REASONS).forEach(category => {
            const $group = $('<optgroup>').attr('label', category.replaceAll('_', ' '));
            REFERRAL_REASONS[category].forEach(label => $('<option>').val(label).text(label).appendTo($group));
            $select.append($group);
        });
    }

    function getAdditionalReferralReasons() {
        if (!$('#enableAdditionalReasons').is(':checked')) return [];
        return $('.additional-reason-select').map(function () { return $(this).val(); }).get().filter(Boolean);
    }

    function resetAdditionalReferralReasons() {
        $('#enableAdditionalReasons').prop('checked', false);
        $('#additionalReasonsFields').addClass('hidden');
        $('.additional-reason-row').slice(1).remove();
        populateAdditionalReferralReasonSelect($('.additional-reason-select').first().val(''));
        $('#btnAddAdditionalReason').prop('disabled', false).removeClass('opacity-40 cursor-not-allowed');
    }

    $('#enableAdditionalReasons').on('change.referralForm', function () {
        $('#additionalReasonsFields').toggleClass('hidden', !this.checked);
        if (!this.checked) resetAdditionalReferralReasons();
    });
    $('#btnAddAdditionalReason').on('click.referralForm', function () {
        const count = $('.additional-reason-row').length;
        if (count >= 3) return;
        const $row = $('<div class="additional-reason-row flex items-center gap-2 min-w-0"></div>');
        const $select = $('<select class="additional-reason-select ref-input flex-1 min-w-0"></select>');
        populateAdditionalReferralReasonSelect($select);
        $row.append($select).append('<button type="button" class="btn-remove-additional-reason w-10 h-10 rounded-lg text-red-600 hover:bg-red-50" aria-label="Remove additional reason"><i class="bi bi-trash"></i></button>');
        $(this).before($row);
        if (count + 1 >= 3) $(this).prop('disabled', true).addClass('opacity-40 cursor-not-allowed');
    });
    $(document).on('click.referralForm', '.btn-remove-additional-reason', function () {
        $(this).closest('.additional-reason-row').remove();
        $('#btnAddAdditionalReason').prop('disabled', false).removeClass('opacity-40 cursor-not-allowed');
    });

    function updateReasonDropdown() {
        const category = $('#modalReasonCategory').val();
        const $reasonSelect = $('#modalReasonSelect');

        $reasonSelect.empty().append('<option value="" selected disabled hidden>select a reason...</option>');

        if (!category) {
            $reasonSelect.prop('disabled', true);
            return;
        }

        if (category === 'OTHER') {
            $reasonSelect.prop('disabled', true);
            $('#modalReasonText').removeClass('hidden').val('');
            return;
        }

        $reasonSelect.prop('disabled', false);
        const reasons = REFERRAL_REASONS[category] || [];
        reasons.forEach(reason => {
            $reasonSelect.append(`<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`);
        });
    }

    $('#modalReasonCategory').on('change.referralForm', updateReasonDropdown);

    $('#modalReasonSelect').on('change.referralForm', function () {
        const selected = $(this).val();
        if (selected) {
            $('#modalReasonText').addClass('hidden').val(selected);
        }
    });

    /**
     * Reveal the free-text allergy details field only when "Has Allergy" is checked.
     */
    function toggleAllergyDetails() {
        if ($('#modalHasAllergy').is(':checked')) {
            $('#modalAllergyDetails').removeClass('hidden');
        } else {
            $('#modalAllergyDetails').addClass('hidden').val('');
        }
    }
    $('#modalHasAllergy').on('change.referralForm', toggleAllergyDetails);

    // Shared invalid-field highlight, applied/cleared by the validation pass below
    // and by the live input/change listener that clears it once a field is fixed.
    const REQUIRED_FIELD_ERROR_CLASSES = 'border-red-600 ring-2 ring-red-600/20 bg-red-50/40';

    /**
     * Highlights every empty required field in the referral form in red (instead
     * of the browser's default one-at-a-time validation UI, which #referralForm's
     * novalidate attribute disables) and returns whether the form is valid overall.
     */
    function validateReferralForm(requireConsent = true) {
        if (!IRDSS.urgency.validate()) return false;
        if (!IRDSS.vitals.validate()) return false;
        if ($('#modalConditionSeverity').val() && !String($('#modalDiagnosis').val() || '').trim()) {
            IRDSS.ui.showToast('error','Enter a working diagnosis before assigning condition severity.',4000); return false;
        }
        let isValid = true;
        let $firstInvalid = null;

        function markField($field, invalid) {
            $field.toggleClass(REQUIRED_FIELD_ERROR_CLASSES, invalid);
            if (invalid) {
                isValid = false;
                if (!$firstInvalid) $firstInvalid = $field;
            }
        }

        // Generic required fields, excluding the hidden reason-text proxy -- that
        // one's handled specially below since it's not the control the user
        // actually sees/interacts with once a real (non-"Others") reason is picked.
        $('#referralForm [required]').not(':disabled').not('#modalReasonText').each(function () {
            const $field = $(this);
            markField($field, !String($field.val() || '').trim());
        });

        // Referral Reason: validate category first, then reason or free-text
        const categorySelected = $('#modalReasonCategory').val();
        if (!categorySelected) {
            markField($('#modalReasonCategory'), true);
        } else if (categorySelected === 'OTHER') {
            markField($('#modalReasonText'), !String($('#modalReasonText').val() || '').trim());
        } else {
            const reasonSelected = $('#modalReasonSelect').val();
            markField($('#modalReasonSelect'), !reasonSelected);
        }

        const additionalReasons = getAdditionalReferralReasons();
        const primaryReason = String($('#modalReasonText').val() || '').trim().toLowerCase();
        const normalizedAdditional = additionalReasons.map(reason => String(reason).trim().toLowerCase());
        if ($('#enableAdditionalReasons').is(':checked')) {
            $('.additional-reason-select').each(function () { markField($(this), !$(this).val()); });
            const invalidAdditional = additionalReasons.length > 3
                || normalizedAdditional.includes(primaryReason)
                || new Set(normalizedAdditional).size !== normalizedAdditional.length;
            if (invalidAdditional) {
                markField($('.additional-reason-select').first(), true);
            }
        }

        const files = Array.from($('#referralAttachments')[0]?.files || []);
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        markField(
            $('#referralAttachments'),
            files.length > 5 || files.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))
        );

        const consentFiles = Array.from($('#signedConsentForm')[0]?.files || []);
        const consentMethod = String($('#consentMethod').val() || 'PAPER').toUpperCase();
        markField(
            $('#signedConsentForm'),
            consentFiles.length > 1
                || consentFiles.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))
                || (requireConsent && consentMethod === 'ELECTRONIC' && consentFiles.length !== 1)
        );
        if (requireConsent) {
            if (consentMethod === 'PAPER') {
                markField($('#paperConsentConfirmed'), !$('#paperConsentConfirmed').is(':checked'));
            } else {
                const electronicConsentComplete = Boolean(
                    $('#consentSignerType').val()
                    && $('#consentSignerName').val()
                    && $('#consentRecordedAt').val()
                    && /^[a-f0-9]{64}$/i.test(String($('#consentDocumentSha256').val() || ''))
                    && ($('#consentSignerType').val() === 'PATIENT' || $('#consentRepresentativeRelationship').val())
                );
                markField($('#consentMethodElectronicCard'), !electronicConsentComplete);
            }
        }

        if ($firstInvalid) {
            $firstInvalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            $firstInvalid.focus();
        }

        return isValid;
    }

    window.getReferralConsentSnapshot = function () {
        const primaryReason = $('#modalReasonText').val() || $('#modalReasonSelect').val();
        const isDoctor = String(state.currentUser?.role || '').toLowerCase() === 'doctor';
        const clinicianBaseName = state.currentUser?.full_name || state.currentUser?.name || state.currentUser?.username || 'Clinical staff';
        const clinicianName = isDoctor && !/^(dr\.?|doctor)\s+/i.test(String(clinicianBaseName).trim())
            ? `Dr. ${clinicianBaseName}`
            : clinicianBaseName;
        const isPhilHealthMember = String(state.currentReferralPatient?.philhealth_member || '').toLowerCase() === 'yes';
        const hasAllergy = $('#modalHasAllergy').is(':checked');
        const gender = String($('#modalPatientGender').text() || '').trim();

        return {
            patientName: String($('#modalPatientName').text() || '').trim(),
            phone: String($('#modalPatientPhone').text() || '').trim(),
            dateOfBirth: String($('#modalPatientDob').text() || '').trim(),
            age: calculatePrintableAge($('#modalPatientDob').text()),
            gender,
            patientLocation: String($('#displayResolvedAddress').text() || '').trim(),
            pwd: $('#modalIsPwd').is(':checked') ? 'Yes' : 'No',
            pregnant: gender.toLowerCase() === 'male' ? 'Not applicable' : ($('#modalIsPregnant').is(':checked') ? 'Yes' : 'No'),
            hasAllergy: hasAllergy ? 'Yes' : 'No',
            allergyDetails: hasAllergy ? String($('#modalAllergyDetails').val() || 'Not specified').trim() : 'Not applicable',
            philHealthMember: isPhilHealthMember ? 'Yes' : 'No',
            philHealthType: isPhilHealthMember ? String(state.currentReferralPatient?.philhealth_status_type || 'Not specified').trim() : 'Not applicable',
            philHealthNumber: isPhilHealthMember ? String(state.currentReferralPatient?.philhealth_number || '').trim() : '',
            referringHospital: state.currentHospital?.name || 'Referring facility',
            receivingHospital: 'To be determined through IRDSS',
            chiefComplaint: String($('#modalChiefComplaint').val() || '').trim(),
            diagnosis: String($('#modalDiagnosis').val() || 'Not specified').trim(),
            severity: String($('#modalSeverity option:selected').text() || '').trim(),
            referralPriority: String($('#modalReferralPriority').val() || '').toUpperCase(),
            conditionSeverity: String($('#modalConditionSeverity option:selected').text() || 'Not specified'),
            reasons: [primaryReason, ...getAdditionalReferralReasons()].filter(Boolean).map(value => String(value).trim()),
            vitals: {
                bloodPressure: `${$('#modalVitalBpSystolic').val() || '--'}/${$('#modalVitalBpDiastolic').val() || '--'} mmHg`,
                heartRate: `${$('#modalVitalHr').val() || '--'} bpm`,
                respiratoryRate: `${$('#modalVitalRr').val() || '--'} br/min`,
                temperature: `${$('#modalVitalTemp').val() || '--'} \u00b0C`,
                oxygenSaturation: `${$('#modalVitalO2sat').val() || '--'}%`,
                height: `${$('#modalVitalHeight').val() || '--'} cm`,
                weight: `${$('#modalVitalWeight').val() || '--'} kg`
            },
            clinicianName,
            clinicianRole: isDoctor ? 'Referring Doctor' : 'Referring Nurse',
            clinicianLicenseNumber: state.currentUser?.license_number || 'Not recorded',
            hospitalLogoUrl: new URL(getHospitalLogoPath(state.currentHospital?.code), window.location.href).href,
            irdssLogoUrl: new URL('assets/logos/IRDSS_long.png', window.location.href).href
        };
    };

    // Clear the red highlight on a required field as soon as it's fixed, rather
    // than making the doctor resubmit to find out it's no longer invalid.
    // #modalReasonCategory and #modalReasonSelect are included even though they don't have [required] attributes --
    // they're flagged manually above since the real requirement lives on the reason dropdowns.
    $(document).on('input.referralForm change.referralForm', '#referralForm [required], #modalReasonCategory, #modalReasonSelect, .additional-reason-select, #referralAttachments, #signedConsentForm, #paperConsentConfirmed, [name="consentMethodChoice"]', function () {
        const $field = $(this);
        if (String($field.val() || '').trim()) {
            $field.removeClass(REQUIRED_FIELD_ERROR_CLASSES);
        }
    });

    // Returns to Patient Records without saving
    function cancelReferPatient() {
        $('#referralForm')[0].reset();
        IRDSS.diagnosis.set();
        IRDSS.symptom.set();
        $('#modalReasonSelect').empty().append('<option value="" selected disabled hidden>select a reason...</option>').prop('disabled', true);
        resetAdditionalReferralReasons();
        toggleAllergyDetails();
        switchTab('patients');
    }
    $('#btnCancelReferral, #btnCancelReferral2').on('click.referralForm', cancelReferPatient);
    function init() {
        if (initialized) return;
        initialized = true;
        populateAdditionalReferralReasonSelect($('.additional-reason-select').first());
    }

    IRDSS.referrals.form = Object.freeze({
        configure,
        init,
        openForPatient: openReferralFormForPatientId,
        cancel: cancelReferPatient,
        validate: validateReferralForm,
        reasonCode: referralReasonCode,
        reasonsText: referralReasonsText,
        attachmentLinksHtml,
        getAdditionalReasons: getAdditionalReferralReasons,
        resetAdditionalReasons: resetAdditionalReferralReasons,
        toggleAllergyDetails
    });
})(window, window.jQuery);
