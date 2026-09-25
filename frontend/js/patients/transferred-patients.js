(function initializeIrdssTransferredPatients(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.patients = IRDSS.patients || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, formatDateTime12h } = IRDSS.formatters;
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
                    vitalsAsOf: details.arrived_at || null
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
                html: `<p class="text-sm text-slate-600 mb-4 text-start">Confirms the patient has physically arrived at your facility. Optionally record vitals taken on arrival.</p><div class="grid grid-cols-2 gap-3 text-start"><div><label class="block text-xs font-semibold text-slate-500 mb-1">BP (mmHg)</label><input type="text" id="arrivalVitalBp" placeholder="120/80" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">HR (bpm)</label><input type="number" min="0" id="arrivalVitalHr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">RR (br/min)</label><input type="number" min="0" id="arrivalVitalRr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div><label class="block text-xs font-semibold text-slate-500 mb-1">Temp (°C)</label><input type="text" id="arrivalVitalTemp" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div><div class="col-span-2"><label class="block text-xs font-semibold text-slate-500 mb-1">O2 Sat (%)</label><input type="number" min="0" max="100" id="arrivalVitalO2sat" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm"></div></div>`,
                showCancelButton: true,
                confirmButtonText: 'Mark as Arrived',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#f59e0b',
                reverseButtons: true,
                focusConfirm: false,
                preConfirm() {
                    return { arrival_vital_bp: $('#arrivalVitalBp').val() || '', arrival_vital_hr: $('#arrivalVitalHr').val() || '', arrival_vital_rr: $('#arrivalVitalRr').val() || '', arrival_vital_temp_c: $('#arrivalVitalTemp').val() || '', arrival_vital_o2sat: $('#arrivalVitalO2sat').val() || '' };
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

    function init() {
        if (initialized) return;
        initialized = true;
        $('#btnRefreshAcceptedPatients').on('click.transferredPatients', load);
        bindArrival();
        bindDeparture();
    }

    IRDSS.patients.transferred = Object.freeze({ configure, init, load, getDepartureOutcomeLabel });
})(window, window.jQuery);
