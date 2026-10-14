(function initializeIrdssTransferredPatients(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.patients = IRDSS.patients || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, formatDateTime12h, formatAgeDisplay, consentRecordedText } = IRDSS.formatters;
    const { showToast } = IRDSS.ui;
    const OUTCOME_LABELS = Object.freeze({
        DISCHARGED: 'Discharged',
        TRANSFERRED: 'Transferred',
        DECEASED: 'Deceased',
        LEFT_AMA: 'Left AMA'
    });
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    function getDepartureOutcomeLabel(outcome) {
        return OUTCOME_LABELS[outcome] || outcome || 'Out';
    }

    function formatReferralTimestamp(value) {
        return runAction('formatReferralTimestamp', value) || formatDateTime12h(value);
    }

    function refreshPatientViews() {
        load();
        if (IRDSS.patients.list) IRDSS.patients.list.load();
    }

    function load() {
        const isClinicalUser = state.currentUser && (state.currentUser.role === 'doctor' || state.currentUser.role === 'nurse');
        if (!state.currentHospital || !isClinicalUser) return;

        const $list = $('#acceptedPatientsList');
        $.when(
            $.ajax({ url: `${API_BASE}/get_referral_outcomes.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_onward_referred_referral_ids.php`, type: 'GET', dataType: 'json' })
        ).done(function (outcomesResponse, onwardResponse) {
            const data = outcomesResponse[0];
            const onwardData = onwardResponse[0];
            const onwardReferredIds = new Set(
                onwardData && onwardData.success && Array.isArray(onwardData.data) ? onwardData.data : []
            );
            const all = Array.isArray(data) ? data : [];
            const chosen = all.filter(outcome => outcome.outcome === 'CHOSEN');
            const bypassed = all.filter(outcome => outcome.outcome === 'BYPASSED');

            $('#statTransferredToUs').text(chosen.length);
            $('#statRedirectedElsewhere').text(bypassed.length);
            $('#statDischarged').text(chosen.filter(outcome => outcome.departure_outcome === 'DISCHARGED').length);
            $('#statReferredOnward').text(chosen.filter(outcome => onwardReferredIds.has(outcome.referral_id)).length);

            if (chosen.length === 0) {
                $list.html('<div class="px-6 py-6 text-center text-xs text-slate-400">No finalized referrals yet.</div>');
                return;
            }

            $list.html(chosen.map(function (outcome) {
                const arrivalControl = outcome.arrived_at
                    ? `<span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200"><i class="bi bi-check-circle-fill"></i> Arrived ${formatReferralTimestamp(outcome.arrived_at)}</span>`
                    : `<button type="button" data-referral-id="${escapeHtml(outcome.referral_id)}" class="btn-mark-arrived inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-all"><i class="bi bi-box-arrow-in-down"></i> Mark as Arrived</button>`;

                let departureControl = '';
                if (outcome.arrived_at) {
                    if (outcome.departed_at) {
                        departureControl = `<span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200"><i class="bi bi-box-arrow-right"></i> ${escapeHtml(getDepartureOutcomeLabel(outcome.departure_outcome))} ${formatReferralTimestamp(outcome.departed_at)}</span>`;
                    } else if (onwardReferredIds.has(outcome.referral_id)) {
                        departureControl = '<span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200"><i class="bi bi-arrow-right-circle"></i> Referred Onward</span>';
                    } else {
                        departureControl = `<button type="button" data-referral-id="${escapeHtml(outcome.referral_id)}" class="btn-mark-departed inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold transition-all"><i class="bi bi-box-arrow-right"></i> Mark as Out</button>`;
                    }
                }

                return `
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-semibold text-slate-900">${escapeHtml(outcome.clinical_reason || 'Referral')}</p>
                            <p class="text-xs text-slate-500 mt-0.5 break-words">From <strong>${escapeHtml(outcome.referring_facility)}</strong></p>
                            <p class="text-xs text-slate-500 mt-0.5">${formatReferralTimestamp(outcome.created_at)}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 flex-shrink-0">
                            ${arrivalControl}${departureControl}
                            <button type="button" data-referral-id="${escapeHtml(outcome.referral_id)}" class="btn-view-patient-details inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all"><i class="bi bi-person-lines-fill"></i> View Full Patient Details</button>
                        </div>
                    </div>`;
            }).join(''));
        }).fail(function () {
            $list.html('<div class="px-6 py-6 text-center text-xs text-red-500">Could not load finalized referrals.</div>');
        });
    }

    function submitArrival($button, referralId, originalHtml, arrivalVitals) {
        $button.prop('disabled', true).html('<span class="inline-block animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span> Marking...');
        $.ajax({
            url: `${API_BASE}/receive_transferred_patient.php`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(Object.assign({ referral_id: referralId }, arrivalVitals || {})),
            dataType: 'json',
            success(response) {
                if (response.success) {
                    showToast('success', response.message || 'Patient marked as arrived.', 3000);
                    refreshPatientViews();
                    return;
                }
                if (response.possible_duplicate) {
                    const existingPatient = response.existing_patient;
                    window.Swal.fire({
                        icon: 'warning',
                        title: 'Possible Existing Patient',
                        html: `<p class="text-sm text-slate-600 text-start">A patient named <strong>${existingPatient.full_name}</strong> (DOB ${existingPatient.dob}) is already on file at your facility, registered ${formatDateTime12h(existingPatient.registered_at)}. Link this arrival to that record, or create a new one?</p>`,
                        showDenyButton: true,
                        showCancelButton: true,
                        confirmButtonText: 'Link to Existing',
                        denyButtonText: 'Create New Anyway',
                        cancelButtonText: 'Cancel',
                        confirmButtonColor: '#16a34a',
                        denyButtonColor: '#f59e0b',
                        reverseButtons: true
                    }).then(function (choice) {
                        if (choice.isConfirmed) submitArrival($button, referralId, originalHtml, Object.assign({}, arrivalVitals, { duplicate_choice: 'link', link_patient_id: existingPatient.id }));
                        else if (choice.isDenied) submitArrival($button, referralId, originalHtml, Object.assign({}, arrivalVitals, { duplicate_choice: 'new' }));
                        else $button.prop('disabled', false).html(originalHtml);
                    });
                    return;
                }
                $button.prop('disabled', false).html(originalHtml);
                window.Swal.fire({ icon: 'error', title: 'Could Not Mark as Arrived', text: response.message, confirmButtonColor: '#dc3545' });
            },
            error(xhr) {
                $button.prop('disabled', false).html(originalHtml);
                window.Swal.fire({ icon: 'error', title: 'Could Not Mark as Arrived', text: xhr.responseJSON?.message || `Request failed (${xhr.status}).`, confirmButtonColor: '#dc3545' });
            }
        });
    }

    function uploadDepartureAttachments(referralId, attachmentType, files) {
        return Promise.allSettled(Array.from(files || []).map(function (file) {
            const body = new FormData();
            body.append('referral_id', referralId);
            body.append('workflow_stage', 'DEPARTURE');
            body.append('attachment_type', attachmentType);
            body.append('attachment', file);
            return $.ajax({ url: `${API_BASE}/upload_referral_attachment.php`, type: 'POST', data: body, processData: false, contentType: false, dataType: 'json' });
        }));
    }

    function openOnwardReferral(referralId) {
        $.ajax({
            url: `${API_BASE}/get_transferred_patient_details.php?referral_id=${encodeURIComponent(referralId)}`,
            type: 'GET',
            dataType: 'json',
            success(details) {
                if (!details || !details.local_patient_id) {
                    window.Swal.fire({ icon: 'error', title: 'Error', text: "Could not find this patient's local record.", confirmButtonColor: '#dc3545' });
                    return;
                }
                runAction('openReferralForm', details.local_patient_id, null, {
                    diagnosis: details.diagnosis,
                    diagnosis_system: details.diagnosis_system,
                    diagnosis_code: details.diagnosis_code,
                    diagnosis_display: details.diagnosis_display,
                    diagnosis_text: details.diagnosis_text,
                    chief_complaint: details.chief_complaint,
                    chief_complaint_text: details.chief_complaint_text,
                    chief_complaint_system: details.chief_complaint_system,
                    chief_complaint_code: details.chief_complaint_code,
                    chief_complaint_display: details.chief_complaint_display,
                    vital_bp: details.arrival_vital_bp || details.vital_bp || '',
                    vital_hr: details.arrival_vital_hr || details.vital_hr || '',
                    vital_rr: details.arrival_vital_rr || details.vital_rr || '',
                    vital_temp_c: details.arrival_vital_temp_c || details.vital_temp_c || '',
                    vital_o2sat: details.arrival_vital_o2sat || details.vital_o2sat || '',
                    vital_height_cm: details.vital_height_cm || '',
                    vital_weight_kg: details.vital_weight_kg || '',
                    is_pwd: !!details.is_pwd,
                    is_pregnant: !!details.is_pregnant,
                    is_senior_citizen: !!details.is_senior_citizen,
                    has_allergy: !!details.has_allergy,
                    allergy_details: details.allergy_details || '',
                    disease_severity: details.disease_severity || '',
                    triage_code: details.triage_code,
                    referral_priority: details.referral_priority,
                    condition_severity_code: details.condition_severity_code,
                    vitalsAsOf: details.arrived_at || null,
                    ...IRDSS.vitals.latest(details)
                });
            },
            error() {
                window.Swal.fire({ icon: 'error', title: 'Error', text: "Could not look up this patient's local record.", confirmButtonColor: '#dc3545' });
            }
        });
    }

    function submitDeparture($button, referralId, originalHtml, values) {
        $button.prop('disabled', true).html('<span class="inline-block animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span> Saving...');
        $.ajax({
            url: `${API_BASE}/mark_patient_departed.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ referral_id: referralId, outcome: values.outcome, remarks: values.remarks }),
            dataType: 'json',
            success(response) {
                if (!response.success) {
                    $button.prop('disabled', false).html(originalHtml);
                    window.Swal.fire({ icon: 'error', title: 'Could Not Record Departure', text: response.message, confirmButtonColor: '#dc3545' });
                    return;
                }
                const files = values.attachment_files || [];
                if (files.length) {
                    uploadDepartureAttachments(referralId, values.attachment_type || 'OTHER', files).then(function (results) {
                        const failed = results.filter(item => item.status === 'rejected').length;
                        showToast(failed ? 'warning' : 'success', failed ? `Departure saved, but ${failed} attachment(s) failed to upload.` : `Departure saved with ${files.length} attachment(s).`, 4000);
                    });
                } else {
                    showToast('success', response.message || 'Patient departure recorded.', 3000);
                }
                refreshPatientViews();
            },
            error(xhr) {
                $button.prop('disabled', false).html(originalHtml);
                window.Swal.fire({ icon: 'error', title: 'Could Not Record Departure', text: xhr.responseJSON?.message || `Request failed (${xhr.status}).`, confirmButtonColor: '#dc3545' });
            }
        });
    }

    function bindArrival() {
        $(document).on('click.transferredPatients', '.btn-mark-arrived', function () {
            const $button = $(this);
            const referralId = $button.data('referral-id');
            const originalHtml = $button.html();
            window.Swal.fire({
                icon: 'question',
                title: 'Mark Patient as Arrived',
                html: `<p class="text-sm text-slate-600 mb-4 text-start">Confirms the patient has physically arrived at your facility. Optionally record vitals taken on arrival.</p><div class="grid grid-cols-2 gap-3 text-start"><div><label class="block text-xs font-semibold text-slate-500 mb-1">BP (mmHg)</label><input type="text" id="arrivalVitalBp" placeholder="120/80" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">HR (bpm)</label><input type="number" min="0" id="arrivalVitalHr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">RR (br/min)</label><input type="number" min="0" id="arrivalVitalRr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">Temp (°C)</label><input type="text" id="arrivalVitalTemp" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div class="col-span-2"><label class="block text-xs font-semibold text-slate-500 mb-1">O2 Sat (%)</label><input type="number" min="0" max="100" id="arrivalVitalO2sat" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="ref-label" for="arrivalVitalHeight">Height (cm)</label><input type="number" step="0.1" min="0" id="arrivalVitalHeight" class="ref-input"></div><div><label class="ref-label" for="arrivalVitalWeight">Weight (kg)</label><input type="number" step="0.1" min="0" id="arrivalVitalWeight" class="ref-input"></div><div class="col-span-2"><label class="ref-label" for="arrivalObservedAt">Measured at</label><input type="datetime-local" step="1" id="arrivalObservedAt" class="ref-input"></div><div class="col-span-2"><label class="ref-label" for="arrivalOxygenMethod">Oxygen measurement method</label><select id="arrivalOxygenMethod" class="ref-input"><option value="unknown">Not specified</option><option value="pulse-oximetry">Pulse oximetry</option></select></div></div>`,
                showCancelButton: true,
                confirmButtonText: 'Mark as Arrived',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#f59e0b',
                reverseButtons: true,
                focusConfirm: false,
                didOpen() {
                    const date=new Date();
                    $('#arrivalObservedAt').val(new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19));
                },
                preConfirm() {
                    const values={ arrival_vital_bp: $('#arrivalVitalBp').val() || '', arrival_vital_hr: $('#arrivalVitalHr').val() || '', arrival_vital_rr: $('#arrivalVitalRr').val() || '', arrival_vital_temp_c: $('#arrivalVitalTemp').val() || '', arrival_vital_o2sat: $('#arrivalVitalO2sat').val() || '',
                        arrival_vital_height_cm:$('#arrivalVitalHeight').val() || '',arrival_vital_weight_kg:$('#arrivalVitalWeight').val() || ''};
                    if (Object.values(values).some(value=>value!=='')) {
                        const time=new Date($('#arrivalObservedAt').val());
                        if (!Number.isFinite(time.getTime())) {window.Swal.showValidationMessage('Enter the actual measurement time.');return false;}
                        values.arrival_observed_at=time.toISOString();
                    }
                    values.arrival_oxygen_method=$('#arrivalOxygenMethod').val() || 'unknown';
                    return values;
                }
            }).then(function (result) {
                if (result.isConfirmed) submitArrival($button, referralId, originalHtml, result.value);
            });
        });
    }

    function bindDeparture() {
        $(document).on('click.transferredPatients', '.btn-mark-departed', function () {
            const $button = $(this);
            const referralId = $button.data('referral-id');
            const originalHtml = $button.html();
            window.Swal.fire({
                icon: 'question',
                title: 'Mark Patient as Out',
                html: `<div class="text-start"><label class="block text-xs font-semibold text-slate-500 mb-1">Outcome</label><select id="departureOutcome" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-3"><option value="DISCHARGED">Discharged</option><option value="TRANSFERRED">Referred to Another Facility</option><option value="LEFT_AMA">Left Against Medical Advice</option><option value="DECEASED">Deceased</option></select><div id="departureRemarksWrap"><label class="block text-xs font-semibold text-slate-500 mb-1">Remarks (optional)</label><textarea id="departureRemarks" rows="3" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm"></textarea><label class="block text-xs font-semibold text-slate-500 mt-3 mb-1">Clinical result type (optional)</label><select id="departureAttachmentType" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-2"><option value="DISCHARGE_SUMMARY">Discharge Summary</option><option value="LAB_RESULT">Laboratory Result</option><option value="XRAY">X-ray / Imaging</option><option value="PRESCRIPTION">Prescription</option><option value="OTHER">Other Clinical Document</option></select><input id="departureAttachments" type="file" multiple accept="application/pdf,image/jpeg,image/png" class="block w-full text-xs text-slate-600"><p class="text-[10px] text-slate-400 mt-1">Up to 5 PDF, JPEG, or PNG files; maximum 5 MB each.</p></div><p id="departureTransferNote" class="text-xs text-slate-500 mt-2 hidden">This opens the Refer Patient form for this patient.</p></div>`,
                showCancelButton: true,
                confirmButtonText: 'Confirm',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#475569',
                reverseButtons: true,
                focusConfirm: false,
                didOpen() {
                    $('#departureOutcome').on('change', function () {
                        const isTransfer = $(this).val() === 'TRANSFERRED';
                        $('#departureRemarksWrap').toggleClass('hidden', isTransfer);
                        $('#departureTransferNote').toggleClass('hidden', !isTransfer);
                    });
                },
                preConfirm() {
                    const files = Array.from($('#departureAttachments')[0]?.files || []);
                    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
                    if (files.length > 5 || files.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))) {
                        return window.Swal.showValidationMessage('Choose up to 5 valid PDF, JPEG, or PNG files, no larger than 5 MB each.');
                    }
                    return { outcome: $('#departureOutcome').val(), remarks: $('#departureRemarks').val() || '', attachment_type: $('#departureAttachmentType').val(), attachment_files: files };
                }
            }).then(function (result) {
                if (!result.isConfirmed) return;
                if (result.value.outcome === 'TRANSFERRED') openOnwardReferral(referralId);
                else submitDeparture($button, referralId, originalHtml, result.value);
            });
        });
    }

    $(document).on('click.transferredPatients', '.btn-view-patient-details', function () {
        const referralId = $(this).data('referral-id');

        $.ajax({
            url: `${API_BASE}/get_transferred_patient_details.php?referral_id=${encodeURIComponent(referralId)}`,
            type: 'GET',
            dataType: 'json',
            success: function (d) {
                const ageDisplay = formatAgeDisplay(d.age, d.age_months, d.age_days);

                const vitalTile = function (label, value, unit) {
                    const displayValue = (value != null && value !== '') ? `${escapeHtml(String(value))}${unit ? ' ' + unit : ''}` : '—';
                    return `
                        <div class="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-center">
                            <p class="text-[10px] uppercase tracking-wide text-slate-500">${label}</p>
                            <p class="font-semibold text-slate-900 text-sm">${displayValue}</p>
                        </div>
                    `;
                };

                const severityNum = parseInt(d.disease_severity, 10) || 0;
                const severityLabelMap = { 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Critical', 5: 'Extreme' };
                const severityColorMap = {
                    1: 'bg-emerald-100 text-emerald-800',
                    2: 'bg-amber-100 text-amber-800',
                    3: 'bg-orange-100 text-orange-800',
                    4: 'bg-red-100 text-red-800',
                    5: 'bg-red-600 text-white'
                };
                const severityText = `Level ${severityNum} (${severityLabelMap[severityNum] || 'Unknown'})`;
                const severityClass = severityColorMap[severityNum] || 'bg-slate-100 text-slate-700';

                const statusTags = [];
                if (d.is_pwd) statusTags.push('PWD');
                if (d.is_pregnant) statusTags.push('Pregnant');
                if (d.is_senior_citizen) statusTags.push('Senior Citizen');
                const tagsRow = statusTags.length > 0
                    ? `<p class="text-sm mt-3 pt-3 border-t border-slate-100"><span class="text-slate-500">Patient Status:</span> <span class="font-semibold text-slate-800">${escapeHtml(statusTags.join(', '))}</span></p>`
                    : '';

                const allergyBanner = d.has_allergy
                    ? `
                        <div class="mb-4 px-3.5 py-3 rounded-lg bg-red-50 border border-red-200">
                            <p class="text-sm text-red-800"><strong>Allergy Alert:</strong> ${escapeHtml(d.allergy_details || 'Known allergy (unspecified)')}</p>
                        </div>
                    `
                    : '';

                const allAttachments = Array.isArray(d.attachments) ? d.attachments : [];
                const consentAttachments = allAttachments.filter(file => file.attachment_type === 'CONSENT_FORM');
                const clinicalAttachments = allAttachments.filter(file => file.attachment_type !== 'CONSENT_FORM');
                const signerTypeLabels = {
                    PATIENT: 'Patient',
                    PARENT_GUARDIAN: 'Parent or guardian',
                    AUTHORIZED_REPRESENTATIVE: 'Authorized representative'
                };
                const electronicConsentAudit = d.consent_method === 'ELECTRONIC' ? `
                    <div class="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-slate-700">
                        <p><span class="text-slate-500">Signed by:</span> <strong>${escapeHtml(d.consent_signer_name || '—')}</strong> (${escapeHtml(signerTypeLabels[d.consent_signer_type] || d.consent_signer_type || '—')})</p>
                        ${d.consent_representative_relationship ? `<p class="mt-1"><span class="text-slate-500">Relationship:</span> ${escapeHtml(d.consent_representative_relationship)}</p>` : ''}
                        <p class="mt-1"><span class="text-slate-500">Witness:</span> ${escapeHtml(d.consent_witnessed_by || '—')}</p>
                        <p class="mt-1"><span class="text-slate-500">Signed:</span> ${escapeHtml(d.consent_recorded_at ? formatDateTime12h(d.consent_recorded_at) : '—')}</p>
                        <p class="mt-1 break-all"><span class="text-slate-500">Document SHA-256:</span> <span class="font-mono">${escapeHtml(d.consent_document_sha256 || '—')}</span></p>
                    </div>
                ` : '';

                Swal.fire({
                    title: 'Patient Details',
                    width: '48rem',
                    html: `
                        <div class="text-start text-sm">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                <div class="border border-slate-200 rounded-xl p-4">
                                    <p class="text-xs text-slate-500 mb-0.5">Full Name</p>
                                    <p class="text-lg font-bold text-slate-900 mb-3">${escapeHtml(d.full_name || '—')}</p>
                                    <div class="grid grid-cols-2 gap-y-2 gap-x-3">
                                        ${d.local_patient_id ? `<p class="col-span-2"><span class="text-slate-500">Patient ID:</span> <span class="font-semibold text-slate-800">${escapeHtml(IRDSS.formatters.displayPatientId(d))}</span></p>` : ''}
                                        <p><span class="text-slate-500">DOB:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.date_of_birth || '—')}</span></p>
                                        <p><span class="text-slate-500">Gender:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.gender || '—')}</span></p>
                                        <p><span class="text-slate-500">Age:</span> <span class="font-semibold text-slate-800">${escapeHtml(String(ageDisplay))}</span></p>
                                        <p><span class="text-slate-500">Civil Status:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.civil_status || '—')}</span></p>
                                        <p class="col-span-2"><span class="text-slate-500">Phone:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.phone || '—')}</span></p>
                                        <p class="col-span-2"><span class="text-slate-500">PhilHealth ID:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.philhealth_status || '—')}${d.philhealth_number ? ' (' + escapeHtml(d.philhealth_number) + ')' : ''}</span></p>
                                    </div>
                                </div>

                                <div class="border border-slate-200 rounded-xl p-4">
                                    <p class="text-xs text-slate-500 mb-0.5">Diagnosis</p>
                                    <p class="text-base font-bold text-slate-900 mb-3">${escapeHtml(d.diagnosis || '—')}</p>
                                    ${d.diagnosis_code ? `<p class="text-sm text-slate-600 mb-3">${escapeHtml(d.diagnosis_display)} · SNOMED CT ${escapeHtml(d.diagnosis_code)}</p>` : ''}
                                    <p class="mb-2"><span class="text-slate-500">Chief Complaint:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.chief_complaint_text || d.chief_complaint || '—')}</span></p>
                                    ${d.chief_complaint_code ? `<p class="text-sm text-slate-600 mb-3">${escapeHtml(d.chief_complaint_display)} — SNOMED CT ${escapeHtml(d.chief_complaint_code)}</p>` : ''}
                                    <p class="mb-2"><span class="text-slate-500">Referral Reasons:</span> <span class="font-semibold text-slate-800">${escapeHtml(runAction('referralReasonsText', d))}</span></p>
                                    <p class="mb-2"><span class="text-slate-500">Consent:</span> <span class="font-semibold ${String(d.consent_status || '').toUpperCase() === 'GRANTED' ? 'text-emerald-700' : 'text-red-700'}">${consentRecordedText(d.consent_status, d.consent_method)}</span></p>
                                    <p class="mb-3"><span class="text-slate-500">Triage Acuity:</span> <span class="${severityClass} px-2.5 py-1 rounded-full text-xs font-bold ml-1">${severityText}</span></p>
                                    <p class="mb-2 text-sm">Referral Priority: <strong>${escapeHtml((d.referral_priority || 'Legacy / not recorded').toUpperCase())}</strong></p>
                                    <p class="mb-2 text-sm">Condition Severity: <strong>${escapeHtml(d.condition_severity_display || 'Not specified')}</strong></p>
                                    ${state.currentUser?.role === 'doctor' && !d.departed_at ? `<button type="button" class="btn-reassess-urgency ref-btn-secondary my-2" data-ref-id="${escapeHtml(referralId)}">Reassess clinical urgency</button>` : ''}
                                    <p><span class="text-slate-500">Referring Facility:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.referring_facility || '—')}</span></p>
                                    ${tagsRow}
                                </div>
                            </div>

                            ${allergyBanner}

                            <div class="mb-4 border border-slate-200 rounded-xl p-4">
                                <p class="font-semibold text-slate-800 mb-1">Patient Consent</p>
                                ${electronicConsentAudit}
                                ${consentAttachments.length
                                    ? runAction('attachmentLinksHtml', referralId, consentAttachments)
                                    : '<p class="text-xs text-slate-400">No signed patient consent copy uploaded.</p>'}
                            </div>

                            ${clinicalAttachments.length ? `
                                <div class="mb-4 border border-slate-200 rounded-xl p-4">
                                    <p class="font-semibold text-slate-800 mb-1">Clinical Attachments</p>
                                    ${runAction('attachmentLinksHtml', referralId, clinicalAttachments)}
                                </div>
                            ` : ''}

                            <p class="mb-4"><strong class="text-slate-800">Address:</strong> <span class="text-slate-700">${escapeHtml(d.address || '—')}</span></p>

                            <div>
                                <p class="font-semibold text-slate-800 mb-2">Vitals at Time of Referral</p>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    ${vitalTile('BP', d.vital_bp)}
                                    ${vitalTile('HR', d.vital_hr, 'bpm')}
                                    ${vitalTile('RR', d.vital_rr, 'rpm')}
                                    ${vitalTile('Temp', d.vital_temp_c, '°C')}
                                    ${vitalTile('O2 Sat', d.vital_o2sat, '%')}
                                    ${vitalTile('Height', d.vital_height_cm, 'cm')}
                                    ${vitalTile('Weight', d.vital_weight_kg, 'kg')}
                                </div>
                            </div>

                            ${(d.arrival_vital_bp || d.arrival_vital_hr || d.arrival_vital_rr || d.arrival_vital_temp_c || d.arrival_vital_o2sat || d.arrival_vital_height_cm || d.arrival_vital_weight_kg) ? `
                                <div class="mt-4">
                                    <p class="font-semibold text-slate-800 mb-2">Vitals at Arrival${d.arrived_at ? ' &middot; ' + formatReferralTimestamp(d.arrived_at) : ''}</p>
                                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        ${vitalTile('BP', d.arrival_vital_bp)}
                                        ${vitalTile('HR', d.arrival_vital_hr, 'bpm')}
                                        ${vitalTile('RR', d.arrival_vital_rr, 'rpm')}
                                        ${vitalTile('Temp', d.arrival_vital_temp_c, '°C')}
                                        ${vitalTile('O2 Sat', d.arrival_vital_o2sat, '%')}
                                        ${vitalTile('Height', d.arrival_vital_height_cm, 'cm')}
                                        ${vitalTile('Weight', d.arrival_vital_weight_kg, 'kg')}
                                    </div>
                                </div>
                            ` : ''}
                            ${(d.observations || []).length ? `<details class="mt-4 border-t border-slate-200 pt-3"><summary class="font-semibold cursor-pointer">Measurement history · FHIR Observations</summary><div class="overflow-x-auto mt-3"><table class="w-full text-xs text-left"><thead><tr><th class="p-2">Measurement</th><th class="p-2">Value / UCUM unit</th><th class="p-2">Recorded context / time</th><th class="p-2">Observation ID</th></tr></thead><tbody>${d.observations.map(obs=>`<tr class="border-t border-slate-100"><td class="p-2">${escapeHtml(obs.display)}<br>LOINC ${escapeHtml(obs.loinc_code)}</td><td class="p-2">${escapeHtml(String(obs.value ?? 'Not recorded'))} ${escapeHtml(obs.unit)}</td><td class="p-2">${escapeHtml(obs.measurement_context)}<br>${escapeHtml(formatReferralTimestamp(obs.observed_at))}</td><td class="p-2 font-mono break-all">${escapeHtml(obs.fhir_observation_id)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
                        </div>
                    `,
                    confirmButtonColor: '#16a34a',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            },
            error: function (xhr) {
                const errData = xhr.responseJSON || {};
                Swal.fire({
                    icon: 'error',
                    title: 'Could Not Load Patient Details',
                    text: errData.detail || 'This referral may not be finalized to your facility.',
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    });


    function init() {
        if (initialized) return;
        initialized = true;
        $('#btnRefreshAcceptedPatients').on('click.transferredPatients', load);
        bindArrival();
        bindDeparture();
    }

    IRDSS.patients.transferred = Object.freeze({ configure, init, load, getDepartureOutcomeLabel });
})(window, window.jQuery);
