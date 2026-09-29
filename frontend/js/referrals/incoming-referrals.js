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

    const notifiedReferralIds = new Set();
    const incomingNotifications = new Map(); // referral_id -> alert payload, backs the bell dropdown
    let isPollingInProgress = false;

    /**
     * Poll Incoming Referrals for active hospital session
     */
    function pollIncomingReferrals() {
        const isClinicalUser = state.currentUser && (state.currentUser.role === 'doctor' || state.currentUser.role === 'nurse');
        if (!state.currentHospital || !isClinicalUser || isPollingInProgress) return;

        isPollingInProgress = true;

        $.ajax({
            url: `${API_BASE}/get_incoming_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (res) {
                isPollingInProgress = false;
                let items = [];
                if (Array.isArray(res)) {
                    items = res;
                } else if (res && Array.isArray(res.referrals)) {
                    items = res.referrals;
                } else if (res && Array.isArray(res.data)) {
                    items = res.data;
                } else if (res && Array.isArray(res.incoming)) {
                    items = res.incoming;
                } else if (res && (res.referral_id || res.id)) {
                    items = [res];
                }

                let hasNewNotification = false;
                const stillPendingIds = new Set();

                items.forEach(item => {
                    const id = item.referral_id || item.id;
                    const respStatus = (item.response_status || item.status || '').toUpperCase();
                    if (!id || respStatus === 'ACCEPTED' || respStatus === 'REDIRECTED') return;

                    stillPendingIds.add(id);
                    // Always refresh with the latest server data (not just on first sight) so a
                    // stale/deleted-then-recreated referral never shows outdated info
                    incomingNotifications.set(id, item);

                    if (!notifiedReferralIds.has(id)) {
                        notifiedReferralIds.add(id);
                        hasNewNotification = true;
                    }
                });

                // Drop anything that's no longer PENDING server-side (accepted/redirected/
                // cancelled/deleted) so the bell and Pending Referrals page never show a
                // referral that's already been resolved out from under the doctor
                Array.from(incomingNotifications.keys()).forEach(id => {
                    if (!stillPendingIds.has(id)) {
                        incomingNotifications.delete(id);
                        notifiedReferralIds.delete(id);
                    }
                });

                renderNotificationBell();
                if (typeof renderPendingReferralsList === 'function') renderPendingReferralsList();

                if (hasNewNotification) {
                    showNewReferralToast();
                    playAlarmSound();
                }
            },
            error: function () {
                isPollingInProgress = false;
            }
        });
    }

    /**
     * Render the bell badge count and the dropdown list of pending referral notifications (sorted newest first)
     */
    function renderNotificationBell() {
        const $badge = $('#notificationBadge');
        const $list = $('#notificationList');
        const count = incomingNotifications.size;

        if (count > 0) {
            $badge.text(count > 9 ? '9+' : count).removeClass('hidden');
        } else {
            $badge.addClass('hidden');
        }

        if (count === 0) {
            $list.html('<div class="px-4 py-6 text-center text-xs text-slate-400">No new referrals</div>');
            return;
        }

        // Sort notifications by created_at (newest first)
        const sorted = Array.from(incomingNotifications.entries()).sort((a, b) => {
            const dateA = new Date(a[1].created_at || 0);
            const dateB = new Date(b[1].created_at || 0);
            return dateB - dateA;
        });

        let html = '';
        sorted.forEach(([referralId, alert]) => {
            const referringFacility = alert.referring_facility || alert.referring_hospital || (alert.serviceProvider && alert.serviceProvider.display) || 'Unknown Hospital';
            html += `
                <div class="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                    <div class="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                        <i class="bi bi-hospital"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-semibold text-slate-800">New referral from <span class="text-red-700">${escapeHtml(referringFacility)}</span></p>
                        <p class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(String(referralId))}</p>
                        <button type="button" class="btn-view-referral-form mt-2 px-3 py-1 bg-yellow-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition-all" data-ref-id="${escapeHtml(String(referralId))}">
                            <i class="bi bi-file-earmark-text-fill me-1"></i> View Form
                        </button>
                    </div>
                </div>
            `;
        });
        $list.html(html);
    }

    const PENDING_SEVERITY_LABEL = { 1: 'Mild', 2: 'Moderate', 3: 'Severe', 4: 'Critical', 5: 'Extreme' };

    /**
     * Waiting time, color-escalated to match the 15-30 minute ER turnaround window this
     * system already tracks elsewhere -- green while fresh, amber approaching it, red
     * once it's actually overdue. Plain text color, not a badge -- just a signal, not decor.
     */
    function formatWaitLabel(createdAt) {
        if (!createdAt) return { text: 'Unknown', cls: 'text-slate-500' };
        const mins = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
        const text = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const cls = mins < 5 ? 'text-emerald-700' : mins < 15 ? 'text-amber-700' : 'text-red-700 font-bold';
        return { text, cls };
    }

    /**
     * Renders the full-page Pending Referrals queue (triage view) from the same
     * `incomingNotifications` map the bell uses, sorted most-severe-first so a doctor
     * can see everything stacked up at once instead of only the last one that popped in.
     */
    function renderPendingReferralsList() {
        const $list = $('#pendingReferralsList');
        if ($list.length === 0) return;

        const items = Array.from(incomingNotifications.values());
        const count = items.length;
        const criticalCount = items.filter(i => (parseInt(i.disease_severity, 10) || 0) >= 4).length;

        $('#statPendingCount').text(count);
        $('#statCriticalPendingCount').text(criticalCount);
        $('#navPendingBadge').text(count > 9 ? '9+' : count).toggleClass('hidden', count === 0);

        if (count === 0) {
            $list.html('<div class="px-6 py-10 text-center text-xs text-slate-400"><i class="bi bi-check2-circle text-2xl text-slate-300 block mb-2"></i>No pending referrals right now.</div>');
            return;
        }

        const sorted = items.slice().sort(function (a, b) {
            const sevDiff = (parseInt(b.disease_severity, 10) || 0) - (parseInt(a.disease_severity, 10) || 0);
            if (sevDiff !== 0) return sevDiff;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0); // newest first within same severity
        });

        $list.html(sorted.map(function (item) {
            const referralId = item.referral_id || item.id;
            const severity = parseInt(item.disease_severity, 10) || 0;
            const severityLabel = PENDING_SEVERITY_LABEL[severity] || String(item.disease_severity);
            const wait = formatWaitLabel(item.created_at);

            return `
                <div class="bg-white rounded-xl border border-slate-200/70 p-4">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm text-slate-800"><span class="font-semibold">Referral from:</span> ${escapeHtml(item.referring_facility || 'Unknown Facility')}</p>
                            <p class="text-sm text-slate-800"><span class="font-semibold">Severity:</span> ${severity} &middot; ${escapeHtml(severityLabel)}</p>
                            <p class="text-sm"><span class="font-semibold text-slate-800">Waiting time:</span> <span class="${wait.cls}">${escapeHtml(wait.text)}</span></p>
                        </div>
                        <button type="button" data-ref-id="${escapeHtml(String(referralId))}"
                            class="btn-review-pending-referral flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-all">
                            <i class="bi bi-file-earmark-text-fill"></i> Review &amp; Decide
                        </button>
                    </div>
                </div>
            `;
        }).join(''));
    }

    $(document).on('click.incomingReferrals', '.btn-review-pending-referral', function () {
        const referralId = $(this).data('ref-id');
        const incomingAlert = incomingNotifications.get(referralId);
        if (!incomingAlert) return;

        // Don't delete from the map just for opening it -- it should only disappear once
        // it's actually resolved (accepted/redirected), which the next poll picks up
        // naturally. Deleting here made it vanish for up to 12s if the doctor closed the
        // popup without deciding, which looked like a bug (and was reported as one).
        stopAlarmSound();
        markReferralSeen(referralId);
        showIncomingReferralDetail(incomingAlert);
    });

    let newReferralToastTimeout = null;

    /**
     * Briefly show a "New Referral" callout beside the bell and give it a shake
     */
    function showNewReferralToast() {
        const $toast = $('#newReferralToast');
        const $bell = $('#btnNotificationBell');

        $toast.removeClass('hidden');
        clearTimeout(newReferralToastTimeout);
        newReferralToastTimeout = setTimeout(() => {
            $toast.addClass('hidden');
        }, 4000);

        $bell.removeClass('animate-bell-shake');
        // Force reflow so the animation can restart if it's already mid-run
        void $bell[0].offsetWidth;
        $bell.addClass('animate-bell-shake');
    }

    /**
     * Play a short two-tone notification ring via the Web Audio API (no audio file needed)
     */
    function playNotificationSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!window._notificationAudioCtx) {
                window._notificationAudioCtx = new AudioCtx();
            }
            const ctx = window._notificationAudioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            [880, 1108].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;

                const start = now + i * 0.15;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.4);
            });
        } catch (e) {
            // Autoplay restrictions or unsupported browser — fail silently
        }
    }

    let alarmIntervalId = null;
    let alarmStopTimeoutId = null;

    function playAlarmBeep() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!window._notificationAudioCtx) {
                window._notificationAudioCtx = new AudioCtx();
            }
            const ctx = window._notificationAudioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            [1046, 784].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = freq;

                const start = now + i * 0.18;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.35);
            });
        } catch (e) {
            // Autoplay restrictions or unsupported browser — fail silently
        }
    }

    /**
     * Urgent, repeating alarm for a brand-new incoming referral -- a single short chime
     * is too easy to miss in a busy ER. Repeats every ~0.9s for up to 20s as a safety cap,
     * but stops immediately the moment the doctor acknowledges it (opens the bell, opens
     * the referral from the Pending Referrals page, or switches to that page).
     */
    function playAlarmSound() {
        stopAlarmSound();
        playAlarmBeep();
        alarmIntervalId = setInterval(playAlarmBeep, 900);
        alarmStopTimeoutId = setTimeout(stopAlarmSound, 20000);
    }

    function stopAlarmSound() {
        if (alarmIntervalId) {
            clearInterval(alarmIntervalId);
            alarmIntervalId = null;
        }
        if (alarmStopTimeoutId) {
            clearTimeout(alarmStopTimeoutId);
            alarmStopTimeoutId = null;
        }
    }

    // Toggle the notification dropdown open/closed
    $(document).on('click.incomingReferrals', '#btnNotificationBell', function (e) {
        e.stopPropagation();
        $('#notificationDropdown').toggleClass('hidden');
        stopAlarmSound();
    });
    $(document).on('click.incomingReferrals', '#notificationDropdown', function (e) {
        e.stopPropagation();
    });
    $(document).on('click.incomingReferrals', function () {
        $('#notificationDropdown').addClass('hidden');
    });

    // "View Form" click inside the notification dropdown: mark seen, open the full detail modal
    $(document).on('click.incomingReferrals', '.btn-view-referral-form', function () {
        const referralId = $(this).data('ref-id');
        const incomingAlert = incomingNotifications.get(referralId);
        if (!incomingAlert) return;

        // Same fix as the Pending Referrals page: don't delete on open, only once resolved
        $('#notificationDropdown').addClass('hidden');
        stopAlarmSound();

        markReferralSeen(referralId);
        showIncomingReferralDetail(incomingAlert);
    });

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
                        incomingNotifications.set(referralId, incomingAlert);
                        renderNotificationBell();
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


    function clearNotifications() {
        stopAlarmSound();
        notifiedReferralIds.clear();
        incomingNotifications.clear();
        renderNotificationBell();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        $(document).on('click.incomingReferrals', '#btnRefreshPending', pollIncomingReferrals);
        $(document).on('click.incomingReferrals', '#btnTestAlarm', playAlarmSound);
    }

    IRDSS.referrals.incoming = Object.freeze({
        init,
        poll: pollIncomingReferrals,
        showDetail: showIncomingReferralDetail,
        submitDecision: submitReferralDecision,
        renderNotificationBell,
        playNotificationSound,
        playAlarm: playAlarmSound,
        stopAlarm: stopAlarmSound,
        clearNotifications
    });
})(window, window.jQuery);
