(function initializeIrdssIncomingReferrals(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, formatAgeDisplay, consentRecordedText } = IRDSS.formatters;
    const { showToast, cleanErrorMessage } = IRDSS.ui;
    const referralReasonsText = IRDSS.referrals.form.reasonsText;
    const resolveLocationAddressHtml = (...args) => IRDSS.referrals.recommendations.resolveLocationAddressHtml(...args);
    let initialized = false;

    let isPollingInProgress = false;

    function normalizeIncomingResponse(response) {
        if (Array.isArray(response)) return response;
        if (response && Array.isArray(response.referrals)) return response.referrals;
        if (response && Array.isArray(response.data)) return response.data;
        if (response && Array.isArray(response.incoming)) return response.incoming;
        if (response && (response.referral_id || response.id)) return [response];
        return [];
    }

    /**
     * Poll incoming referrals for the active clinical user. Notification state and
     * rendering are owned by referrals/notifications.js.
     */
    function pollIncomingReferrals() {
        const isClinicalUser = state.currentUser && (state.currentUser.role === 'doctor' || state.currentUser.role === 'nurse');
        if (!state.currentHospital || !isClinicalUser || isPollingInProgress) return;

        isPollingInProgress = true;
        $.ajax({
            url: `${API_BASE}/get_incoming_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                IRDSS.referrals.notifications.sync(normalizeIncomingResponse(response));
            },
            complete: function () {
                isPollingInProgress = false;
            }
        });
    }

    /**
     * PATCH /api/v1/referral/{referral_id}/seen — stamps when the facility opened the form
     */
    function markReferralSeen(referralId) {
        if (!state.currentHospital || !referralId) return;

        $.ajax({
            url: `${API_BASE}/mark_referral_seen.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ referral_id: referralId }),
            dataType: 'json',
            error: function (xhr) {
                // Silently fail - this is a non-blocking operation
                console.log('Failed to mark referral as seen: ' + (xhr.status || 'unknown error'));
            }
        });
    }

    /**
     * Show the full patient detail modal with Accept / Redirect decision buttons
     */
    function showIncomingReferralDetail(incomingAlert) {
        const referralId = incomingAlert.referral_id || incomingAlert.id || 'N/A';
        state.currentActiveReferralId = referralId;

        const referringFacility = incomingAlert.referring_facility || incomingAlert.referring_hospital || (incomingAlert.serviceProvider && incomingAlert.serviceProvider.display) || 'Unknown Hospital';
        const patientId = incomingAlert.patient_id || (incomingAlert.subject && incomingAlert.subject.reference) || 'N/A';
        const age = incomingAlert.patient_age !== undefined ? incomingAlert.patient_age : incomingAlert.age;
        const ageMonths = incomingAlert.patient_age_months !== undefined ? incomingAlert.patient_age_months : null;
        const ageDays = incomingAlert.patient_age_days !== undefined ? incomingAlert.patient_age_days : null;
        const ageDisplay = formatAgeDisplay(age, ageMonths, ageDays, true);
        const gender = incomingAlert.patient_gender || incomingAlert.gender || 'N/A';
        const patientInfo = `${ageDisplay} (${gender})`;
        const severity = incomingAlert.disease_severity !== undefined ? incomingAlert.disease_severity : (incomingAlert.severity !== undefined ? incomingAlert.severity : '3');
        const clinicalReason = referralReasonsText(incomingAlert);
        const diagnosis = incomingAlert.diagnosis || 'Not specified';
        const chiefComplaint = incomingAlert.chief_complaint || 'Not specified';

        // Patient status flags -- only ever shown if at least one applies, to avoid clutter
        const statusTags = [];
        if (incomingAlert.is_pwd) statusTags.push('PWD');
        if (incomingAlert.is_pregnant) statusTags.push('Pregnant');
        if (incomingAlert.is_senior_citizen) statusTags.push('Senior Citizen');
        const patientStatusText = statusTags.length > 0 ? statusTags.join(', ') : null;
        const allergyText = incomingAlert.has_allergy
            ? (incomingAlert.allergy_details ? incomingAlert.allergy_details : 'Yes (unspecified)')
            : null;

        // Extract patient coordinates (origin)
        const patientLat = incomingAlert.patient_latitude !== undefined && incomingAlert.patient_latitude !== null ? parseFloat(incomingAlert.patient_latitude) : (incomingAlert.patient_lat !== undefined && incomingAlert.patient_lat !== null ? parseFloat(incomingAlert.patient_lat) : (incomingAlert.patient && incomingAlert.patient.latitude !== undefined && incomingAlert.patient.latitude !== null ? parseFloat(incomingAlert.patient.latitude) : null));
        const patientLng = incomingAlert.patient_longitude !== undefined && incomingAlert.patient_longitude !== null ? parseFloat(incomingAlert.patient_longitude) : (incomingAlert.patient_lng !== undefined && incomingAlert.patient_lng !== null ? parseFloat(incomingAlert.patient_lng) : (incomingAlert.patient && incomingAlert.patient.longitude !== undefined && incomingAlert.patient.longitude !== null ? parseFloat(incomingAlert.patient.longitude) : null));

        // Extract hospital coordinates (destination) — this is OUR OWN hospital's location,
        // used only for the transfer-distance calc below, never for display as "referring
        // facility" (that's a different hospital entirely — see referring facility coords).
        const hospitalLat = incomingAlert.hospital_latitude !== undefined && incomingAlert.hospital_latitude !== null ? parseFloat(incomingAlert.hospital_latitude) : (incomingAlert.hospital_lat !== undefined && incomingAlert.hospital_lat !== null ? parseFloat(incomingAlert.hospital_lat) : (state.currentHospital && state.currentHospital.latitude !== undefined && state.currentHospital.latitude !== null ? parseFloat(state.currentHospital.latitude) : null));
        const hospitalLng = incomingAlert.hospital_longitude !== undefined && incomingAlert.hospital_longitude !== null ? parseFloat(incomingAlert.hospital_longitude) : (incomingAlert.hospital_lng !== undefined && incomingAlert.hospital_lng !== null ? parseFloat(incomingAlert.hospital_lng) : (state.currentHospital && state.currentHospital.longitude !== undefined && state.currentHospital.longitude !== null ? parseFloat(state.currentHospital.longitude) : null));

        // Extract the actual referring (sending) hospital's own coordinates, for display.
        const referringLat = incomingAlert.referring_facility_latitude !== undefined && incomingAlert.referring_facility_latitude !== null ? parseFloat(incomingAlert.referring_facility_latitude) : null;
        const referringLng = incomingAlert.referring_facility_longitude !== undefined && incomingAlert.referring_facility_longitude !== null ? parseFloat(incomingAlert.referring_facility_longitude) : null;

        // Calculate Haversine distance and transfer ETA
        let etaText = 'N/A';
        const hospLocationHtml = resolveLocationAddressHtml(referringLat, referringLng, 'modal-hospital-location');
        const patientLocationHtml = resolveLocationAddressHtml(patientLat, patientLng, 'modal-patient-location');

        // Transfer distance is referring hospital -> receiving hospital: that's the actual
        // ambulance route for an inter-facility transfer, not the patient's registered
        // origin barangay (which is a separate triage/routing field, unrelated to this trip).
        if (referringLat != null && referringLng != null && !isNaN(referringLat) && !isNaN(referringLng)) {
            if (hospitalLat != null && hospitalLng != null && !isNaN(hospitalLat) && !isNaN(hospitalLng)) {
                const R = 6371; // Earth radius in km
                const dLat = (hospitalLat - referringLat) * Math.PI / 180;
                const dLon = (hospitalLng - referringLng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos(referringLat * Math.PI / 180) * Math.cos(hospitalLat * Math.PI / 180) *
                          Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceKm = R * c;

                // 40 km/h avg ambulance speed + 5 min prep time
                const estMinutes = Math.max(5, Math.round((distanceKm / 40) * 60));
                etaText = `${distanceKm.toFixed(1)} km (~${estMinutes} mins transfer ETA)`;
            }
        }

        // Update placeholder elements if present in DOM
        $('#modal-referring-hospital').text(referringFacility);
        $('#modal-patient-id').text(patientId);
        $('#modal-patient-age').text(ageDisplay);
        $('#modal-severity').text("Triage Category: " + severity);
        $('#modal-diagnosis').text(diagnosis);
        $('#modal-chief-complaint').text(chiefComplaint);
        $('#modal-reason').text(clinicalReason);

        // Builds one label/value row inside a grouped info card; `last` drops the divider.
        const infoRow = (label, valueHtml, opts = {}) => `
            <div class="flex flex-col sm:flex-row sm:justify-between ${opts.last ? '' : 'border-b border-slate-200/60'} pb-1.5 gap-0.5 sm:gap-2">
                <span class="text-slate-700 font-bold shrink-0">${label}:</span>
                <span class="${opts.valueClass || 'font-bold text-slate-800'} sm:text-right${opts.leading ? ' leading-relaxed' : ''}" ${opts.id ? `id="${opts.id}"` : ''}>${valueHtml}</span>
            </div>`;
        const infoCard = (title, rowsHtml, extraClass = '') => `
            <div class="${extraClass}">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">${title}</p>
                <div class="bg-slate-50 rounded-xl border border-slate-200/70 p-3.5 space-y-1.5 text-xs">${rowsHtml}</div>
            </div>`;

        Swal.fire({
            title: '<div class="flex items-center justify-center gap-2 text-red-600"><i class="bi bi-hospital text-2xl"></i> <span>Incoming Patient Referral</span></div>',
            width: '60rem',
            html: `
                <div class="text-start space-y-3 p-2 text-sm text-slate-700">
                    <p class="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Hospital Referral Notification</p>

                    <div class="p-3 bg-red-50 rounded-xl border border-red-100 space-y-1">
                        <div class="flex justify-between items-center">
                            <span class="text-xs font-bold text-red-900 font-mono">Referral ID: ${escapeHtml(referralId)}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Pending Decision</span>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        ${infoCard('Referring Hospital', `
                            ${infoRow('Referring Facility', escapeHtml(referringFacility), { id: 'modal-referring-hospital' })}
                            ${infoRow('Location', hospLocationHtml, { valueClass: 'font-normal text-slate-800', leading: true })}
                            ${infoRow('Transfer Distance & ETA', escapeHtml(etaText), { valueClass: 'font-bold text-red-700', id: 'modal-transfer-eta', last: true })}
                        `)}
                        ${infoCard('Patient Info', `
                            ${infoRow('Patient ID', escapeHtml(String(patientId)), { valueClass: 'font-bold text-slate-800 font-mono', id: 'modal-patient-id' })}
                            ${infoRow('Age', escapeHtml(ageDisplay), { valueClass: 'font-normal text-slate-800', id: 'modal-patient-age' })}
                            ${infoRow('Gender', escapeHtml(String(gender)), { valueClass: 'font-normal text-slate-800', id: 'modal-patient-gender' })}
                            ${infoRow('Location', patientLocationHtml, { valueClass: 'font-normal text-slate-800', leading: true, last: true })}
                        `)}
                    </div>

                    ${infoCard('Clinical Info', `
                        ${infoRow('Severity', 'Triage Category: ' + escapeHtml(String(severity)), { valueClass: 'font-bold text-amber-700', id: 'modal-severity' })}
                        ${infoRow('Diagnosis', escapeHtml(diagnosis), { id: 'modal-diagnosis' })}
                        ${infoRow('Chief Complaint', escapeHtml(chiefComplaint), { id: 'modal-chief-complaint' })}
                        ${patientStatusText ? infoRow('Patient Status', escapeHtml(patientStatusText)) : ''}
                        ${allergyText ? infoRow('Allergy', escapeHtml(allergyText), { valueClass: 'font-bold text-red-700' }) : ''}
                        ${infoRow('Consent', consentRecordedText(incomingAlert.consent_status, incomingAlert.consent_method), { valueClass: String(incomingAlert.consent_status || '').toUpperCase() === 'GRANTED' ? 'font-bold text-emerald-700' : 'font-bold text-red-700' })}
                        ${infoRow('Reason for Referral', escapeHtml(clinicalReason), { id: 'modal-reason', last: true })}
                    `, 'mt-3')}

                    <p class="text-xs text-slate-500 text-center mt-3">Please choose your decision for this incoming referral:</p>
                </div>
            `,
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="bi bi-check-circle-fill me-1"></i> ACCEPT',
            confirmButtonColor: '#16a34a',
            denyButtonText: '<i class="bi bi-arrow-right-circle-fill me-1"></i> REDIRECTED',
            denyButtonColor: '#dc2626',
            cancelButtonText: '<i class="bi bi-x-lg me-1"></i> Close',
            cancelButtonColor: '#64748b',
            allowOutsideClick: false,
            allowEscapeKey: false,
            customClass: { popup: 'rounded-3xl shadow-2xl border' },
            didOpen: (popup) => {
                const confirmBtn = Swal.getConfirmButton();
                const denyBtn = Swal.getDenyButton();
                const cancelBtn = Swal.getCancelButton();

                if (confirmBtn) {
                    confirmBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        if (cancelBtn) cancelBtn.disabled = true;
                        const refId = state.currentActiveReferralId;
                        Swal.close();
                        submitReferralDecision(refId, 'ACCEPTED');
                    }, { capture: true });
                }

                if (denyBtn) {
                    denyBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        if (cancelBtn) cancelBtn.disabled = true;
                        const refId = state.currentActiveReferralId;
                        Swal.close();
                        promptRedirectReason(refId);
                    }, { capture: true });
                }

                if (cancelBtn) {
                    cancelBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        cancelBtn.disabled = true;
                        Swal.close();

                        // Keep this referral available in the notification bell so the
                        // hospital can reopen the form and decide later instead of losing it.
                        IRDSS.referrals.notifications.upsert(incomingAlert);
                    }, { capture: true });
                }

                // Referring Facility Location and Patient Location are already resolved
                // via resolveLocationAddressHtml() above, through the backend's reverse_geo.php
                // proxy (which has provider fallbacks) instead of calling Nominatim directly
                // from the browser — direct calls can't set the User-Agent header Nominatim's
                // usage policy requires, so they'd silently fail and leave raw coordinates shown.
            }
        });
    }

    let isSubmittingDecision = false;

    const REDIRECT_REASONS = {
        NO_AVAILABLE_BED: 'No available bed',
        SPECIALIST_UNAVAILABLE: 'Required specialist unavailable',
        SERVICE_UNAVAILABLE: 'Required service unavailable',
        EQUIPMENT_UNAVAILABLE: 'Required equipment unavailable',
        OUTSIDE_CAPABILITY: 'Case is outside facility capability',
        TEMPORARY_CLOSURE: 'Temporary closure or service interruption',
        OTHER: 'Other'
    };

    function promptRedirectReason(referralId) {
        const options = Object.entries(REDIRECT_REASONS).map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`).join('');
        Swal.fire({
            icon: 'warning',
            title: 'Reason for Redirecting',
            html: `<div class="text-start"><label class="block text-xs font-semibold text-slate-600 mb-1">Redirect reason <span class="text-red-600">*</span></label><select id="redirectReasonCode" class="w-full h-11 px-3 border border-slate-200 rounded-lg mb-3"><option value="">-- Select a reason --</option>${options}</select><div id="redirectReasonTextWrap" class="hidden"><label class="block text-xs font-semibold text-slate-600 mb-1">Please specify <span class="text-red-600">*</span></label><textarea id="redirectReasonText" maxlength="500" rows="3" class="w-full px-3 py-2 border border-slate-200 rounded-lg" placeholder="Explain why the referral is being redirected"></textarea></div></div>`,
            showCancelButton: true,
            confirmButtonText: 'Redirect Referral',
            confirmButtonColor: '#dc2626',
            didOpen: () => $('#redirectReasonCode').on('change.incomingReferrals', function () { $('#redirectReasonTextWrap').toggleClass('hidden', this.value !== 'OTHER'); }),
            preConfirm: () => {
                const code = $('#redirectReasonCode').val();
                const text = String($('#redirectReasonText').val() || '').trim();
                if (!code) return Swal.showValidationMessage('Choose a redirect reason.');
                if (code === 'OTHER' && !text) return Swal.showValidationMessage('Describe the other redirect reason.');
                return { redirect_reason_code: code, redirect_reason_text: text };
            }
        }).then(result => {
            if (result.isConfirmed) submitReferralDecision(referralId, 'REDIRECTED', result.value);
        });
    }

    /**
     * Submit Accept / Redirect decision to PATCH /api/v1/referral/{referral_id}/respond
     */
    function submitReferralDecision(referralId, decision, redirectReason) {
        if (!state.currentHospital || isSubmittingDecision) return;
        isSubmittingDecision = true;

        Swal.fire({
            title: 'Submitting Decision...',
            text: `Transmitting ${decision} decision to central IOL...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const payload = JSON.stringify(Object.assign({ referral_id: referralId, decision: decision }, redirectReason || {}));

        $.ajax({
            url: `${API_BASE}/respond_to_referral.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: payload,
            dataType: 'json',
            success: function (res) {
                isSubmittingDecision = false;
                Swal.fire({
                    icon: 'success',
                    title: `Referral ${decision}!`,
                    text: (res && res.message) || `Decision '${decision}' successfully submitted to central IOL.`,
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            },
            error: function (xhr) {
                isSubmittingDecision = false;
                const errData = xhr.responseJSON || {};
                const rawMsg = errData.message || errData.detail || `Failed to submit referral decision (${xhr.status}).`;

                Swal.fire({
                    icon: 'error',
                    title: 'Decision Submission Failed',
                    text: cleanErrorMessage(rawMsg, xhr.status),
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            }
        });
    }
    function init() {
        if (initialized) return;
        initialized = true;
        $(document).on('click.incomingReferrals', '#btnRefreshPending', pollIncomingReferrals);
    }

    IRDSS.referrals.incoming = Object.freeze({
        init,
        poll: pollIncomingReferrals,
        markSeen: markReferralSeen,
        showDetail: showIncomingReferralDetail,
        submitDecision: submitReferralDecision
    });
})(window, window.jQuery);
