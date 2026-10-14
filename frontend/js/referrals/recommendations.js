(function initializeIrdssRecommendations(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE, API_V1_REFERRAL } = IRDSS.config;
    const { escapeHtml, displayReferralNumber } = IRDSS.formatters;
    const { cleanErrorMessage, buildErrorNoteHtml } = IRDSS.ui;
    const { switchTab } = IRDSS.navigation;
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    // Statuses in which the referring doctor still has a decision to make. Anything
    // else (CANCELLED, all REDIRECTED, ARRIVED, departed, or finalized to a receiving
    // facility) means the card has nothing left to show.
    const OPEN_REFERRAL_STATUSES = ['PENDING', 'SEEN', 'ACCEPTED'];

    function isOpenReferral(referral) {
        return !!referral && !referral.receiving_facility && OPEN_REFERRAL_STATUSES.includes(referral.status);
    }

    function readStoredActiveReferral() {
        let parsed = null;
        try { parsed = JSON.parse(localStorage.getItem('active_initiated_referral') || 'null'); } catch (e) {}
        if (state.activeInitiatedReferralId) {
            const sameReferral = !!parsed && parsed.id === state.activeInitiatedReferralId;
            return {
                id: state.activeInitiatedReferralId,
                number: state.activeInitiatedReferralNumber || (sameReferral ? parsed.number : null),
                patientName: sameReferral ? parsed.patientName : null
            };
        }
        return parsed && parsed.id ? parsed : null;
    }

    function storeActiveReferral(referralId, referralNumber, patientName) {
        state.activeInitiatedReferralId = referralId;
        state.activeInitiatedReferralNumber = referralNumber || null;
        try {
            localStorage.setItem('active_initiated_referral', JSON.stringify({ id: referralId, number: referralNumber || null, patientName: patientName || 'Patient' }));
        } catch (e) {}
    }

    /**
     * Forgets the active referral (state + localStorage) and hides the card. When a
     * referralId is given, only clears if it is the one currently tracked, so
     * cancelling an older referral never hides a different, still-open one.
     */
    function clearActiveReferral(referralId) {
        const stored = readStoredActiveReferral();
        if (referralId && stored && stored.id !== referralId) return;
        state.activeInitiatedReferralId = null;
        state.activeInitiatedReferralNumber = null;
        try { localStorage.removeItem('active_initiated_referral'); } catch (e) {}
        $('#acceptedHospitalsCard').hide();
    }

    function showActiveReferral(referralId, referralNumber, patientName) {
        storeActiveReferral(referralId, referralNumber, patientName);
        $('#acceptedHospitalsCard').fadeIn(200);
        $('#activeReferralIdText').text(referralNumber || referralId);
        $('#activeReferralPatientText').text(patientName || 'Patient');
        fetchRecommendationsForReferral(referralId, state.currentHospital.api_key || '');
    }

    /**
     * Shows the "Accepted Hospitals" card for the referral this facility is still
     * deciding on. localStorage only remembers which referral that was; the server's
     * /mine list decides whether it is still open, so a referral cancelled, finalized
     * or closed elsewhere (another tab, device or user) stops showing on the next poll.
     */
    function checkAndPollRecommendations() {
        if (!state.currentHospital) {
            $('#acceptedHospitalsCard').hide();
            return;
        }

        const stored = readStoredActiveReferral();

        $.ajax({
            url: `${API_BASE}/get_my_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (data) {
                const referrals = Array.isArray(data) ? data : [];

                if (stored) {
                    const match = referrals.find(r => r.referral_id === stored.id);
                    if (isOpenReferral(match)) {
                        showActiveReferral(match.referral_id, match.referral_number || stored.number, stored.patientName);
                        return;
                    }
                    clearActiveReferral();
                }

                // Nothing open remembered locally (fresh login, different device, or it
                // just closed) -- surface the most recent referral with an acceptance
                // still awaiting finalization, if any.
                const awaitingFinalization = referrals
                    .filter(r => r.status === 'ACCEPTED' && !r.receiving_facility)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                if (awaitingFinalization.length === 0) {
                    $('#acceptedHospitalsCard').hide();
                    return;
                }

                const rehydrated = awaitingFinalization[0];
                showActiveReferral(rehydrated.referral_id, rehydrated.referral_number, 'Patient');
            },
            error: function () {
                // Can't verify against the server right now; keep showing the remembered
                // referral rather than hiding a possibly still-open one.
                if (stored) {
                    showActiveReferral(stored.id, stored.number, stored.patientName);
                } else {
                    $('#acceptedHospitalsCard').hide();
                }
            }
        });
    }

    function fetchRecommendationsForReferral(referralId, apiKey) {
        // Goes through the local api/v1/referral proxy (backend/referral_api.php),
        // which RSA-signs the request; IRDSS only returns recommendations to the
        // hospital that initiated the referral.
        $.ajax({
            url: `${API_V1_REFERRAL}/${encodeURIComponent(referralId)}/recommendations`,
            type: 'GET',
            dataType: 'json',
            xhrFields: {
                withCredentials: false
            },
            success: function (res) {
                renderAcceptedHospitalsList(referralId, res);
            },
            error: function (xhr) {
                const $list = $('#acceptedHospitalsList');
                $list.html(`
                    <div class="col-span-full text-center py-6 px-4 text-slate-400 font-normal bg-slate-50/80 rounded-2xl border border-slate-200/60">
                        <span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent me-2"></span>
                        Awaiting acceptances from receiving hospitals...
                    </div>
                `);
            }
        });
    }

    $(document).on('change.recommendations', '#selectActiveReferralId', function() {
        const selectedId = $(this).val();
        if (!selectedId || !state.currentHospital) return;
        const apiKey = state.currentHospital.api_key || '';

        const selectedRef = IRDSS.referrals.list.getCache().find(r => r.referral_id === selectedId);
        state.activeInitiatedReferralNumber = selectedRef ? (selectedRef.referral_number || null) : null;
        if (selectedRef) {
            $('#activeReferralPatientText').text(selectedRef.patient_name || 'Patient');
            $('#activeReferralIdText').text(displayReferralNumber(selectedRef));
        }

        try {
            localStorage.setItem('active_initiated_referral', JSON.stringify({ id: selectedId, number: state.activeInitiatedReferralNumber, patientName: selectedRef ? selectedRef.patient_name : '' }));
        } catch(e) {}

        fetchRecommendationsForReferral(selectedId, apiKey);
    });

    const locationGeoCache = {};

    function getClientLocationFallback(lat, lng) {
        if (Math.abs(lat - 7.0620) < 0.03 && Math.abs(lng - 125.6050) < 0.03) {
            return "Gumamela Street, Purok 60, SIR 1, 76-A Bucana, Davao City";
        }
        if (Math.abs(lat - 7.0998) < 0.03 && Math.abs(lng - 125.6195) < 0.03) {
            return "J.P. Laurel Avenue, Bajada, Davao City, Davao del Sur";
        }
        if (Math.abs(lat - 6.6402) < 0.03 && Math.abs(lng - 124.7384) < 0.03) {
            return "Tacurong City, Sultan Kudarat, Soccsksargen";
        }
        return "Davao Region, Philippines";
    }

    function resolveLocationAddressHtml(lat, lng, elementId, opts) {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
            return 'Location N/A';
        }

        // admin3: "Barangay, Municipality, Province/District" instead of the default
        // street-first address string — opt in per call site (see Facility Profile).
        const wantAdmin3 = !!(opts && opts.admin3);
        const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${wantAdmin3 ? 'admin3' : 'full'}`;
        if (locationGeoCache[cacheKey]) {
            return escapeHtml(locationGeoCache[cacheKey]);
        }

        const fallbackAddr = getClientLocationFallback(lat, lng);

        // Trigger asynchronous reverse geocode via PHP proxy backend
        setTimeout(() => {
            $.ajax({
                url: `${API_BASE}/reverse_geo.php`,
                data: wantAdmin3 ? { lat: lat, lng: lng, format: 'admin3' } : { lat: lat, lng: lng },
                dataType: 'json',
                xhrFields: { withCredentials: true },
                timeout: 6000,
                success: function(res) {
                    if (res && res.address && !res.address.includes(lat.toFixed(2))) {
                        locationGeoCache[cacheKey] = res.address;
                        $(`#${elementId}`).text(res.address);
                    } else {
                        locationGeoCache[cacheKey] = fallbackAddr;
                        $(`#${elementId}`).text(fallbackAddr);
                    }
                },
                error: function() {
                    locationGeoCache[cacheKey] = fallbackAddr;
                    $(`#${elementId}`).text(fallbackAddr);
                }
            });
        }, 30);

        return `<span id="${elementId}" class="text-slate-500 font-normal italic flex items-center gap-1.5"><i class="bi bi-geo-alt text-red-500 animate-pulse"></i> Resolving location address...</span>`;
    }

    function renderAcceptedHospitalsList(referralId, data) {
        const $list = $('#acceptedHospitalsList');
        $list.empty();

        let items = [];
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.recommendations)) {
            items = data.recommendations;
        } else if (data && Array.isArray(data.hospitals)) {
            items = data.hospitals;
        } else if (data && Array.isArray(data.data)) {
            items = data.data;
        } else if (data && typeof data === 'object' && (data.hospital_id || data.id || data.hospital_name)) {
            items = [data];
        }

        if (!items || items.length === 0) {
            $('#activeReferralStatusBadge')
                .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800')
                .text('Awaiting Acceptances');

            $list.html(`
                <div class="col-span-full text-center py-8 px-4 text-slate-400 font-normal bg-slate-100/90 rounded-b-2xl border border-slate-200/60">
                    <i class="bi bi-clock text-2xl block mb-2 text-slate-400"></i>
                    <span class="text-xs font-medium">Awaiting referrals...</span>
                </div>
            `);
            return;
        }

        $('#activeReferralStatusBadge')
            .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800')
            .text(`${items.length} Facility Accepted!`);

        // Track new accepting hospitals per referral to trigger the compact toast
        const newHospitals = [];
        items.forEach(hosp => {
            const hospId = hosp.hospital_id || hosp.id || hosp.hospital_name || 'h';
            const key = `${referralId}_${hospId}`;
            if (!knownAcceptedHospitalKeys.has(key)) {
                knownAcceptedHospitalKeys.add(key);
                newHospitals.push(hosp);
            }
        });

        // Surface a small, dismissible toast instead of a blocking full-screen popup —
        // the full details are already visible in #acceptedHospitalsCard on the page.
        if (newHospitals.length > 0) {
            showHospitalAcceptedToast(items, newHospitals);
        }

        // Hospitals arrive pre-ranked by the backend's FCM compatibility score
        // (highest matching_degree first) — do not re-sort client-side.
        items.forEach((hosp, idx) => {
            const hospName = hosp.hospital_name || hosp.name || `Hospital #${hosp.hospital_id || hosp.id || idx+1}`;
            const level = hosp.hospital_level || hosp.level || 'Level 2';
            const beds = hosp.available_beds !== undefined ? hosp.available_beds : 0;
            const matchDeg = hosp.matching_degree !== undefined ? Math.round(hosp.matching_degree * 100) : 100;
            const lat = hosp.latitude !== undefined ? parseFloat(hosp.latitude) : null;
            const lng = hosp.longitude !== undefined ? parseFloat(hosp.longitude) : null;
            const isBestMatch = idx === 0;

            const locId = `hosp-rec-loc-${idx}-${(hosp.hospital_id || 'h').toString().replace(/[^a-zA-Z0-9]/g, '')}`;
            const locContent = resolveLocationAddressHtml(lat, lng, locId);

            const card = `
                <div class="relative p-5 bg-slate-50/90 rounded-2xl border ${isBestMatch ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-slate-200'} shadow-xs space-y-4 hover:border-yellow-300 hover:shadow-md transition-all flex flex-col justify-between">
                    ${isBestMatch ? `
                        <span class="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-600 text-white shadow-sm flex items-center gap-1">
                            <i class="bi bi-star-fill"></i> BEST MATCH
                        </span>
                    ` : ''}
                    <div class="space-y-3">
                        <div class="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <h4 class="font-bold text-slate-900 text-base leading-snug">${escapeHtml(hospName)}</h4>
                                <span class="inline-block mt-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-red-100 text-red-800 border border-red-200/80">${escapeHtml(level)}</span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="px-2.5 py-1 rounded-lg font-bold text-xs bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-200">
                                    <i class="bi bi-hospital text-xs"></i> ${beds} Beds Available
                                </span>
                                <span class="px-2.5 py-1 rounded-lg font-bold text-xs bg-indigo-100 text-indigo-800 border border-indigo-200">
                                    ${hosp.ranking_method === 'DETERMINISTIC_EMERGENCY' ? 'Emergency routing · AI bypassed' : `${matchDeg}% Match`}
                                </span>
                            </div>
                        </div>

                        <div class="text-xs text-slate-600 font-medium leading-relaxed pt-2 border-t border-slate-200/70 flex items-start gap-1.5">
                            <i class="bi bi-geo-alt-fill text-red-500 text-xs shrink-0 mt-0.5"></i>
                            <span id="${locId}" class="break-words font-medium text-slate-700">${locContent}</span>
                        </div>
                    </div>

                    <button class="w-full py-2.5 px-4 bg-white/50 hover:bg-yellow-50 text-slate-700 hover:text-yellow-700 border border-slate-300 hover:border-yellow-500 rounded-xl shadow-sm hover:shadow-lg active:scale-[0.98] transition-all font-semibold flex items-center justify-center gap-2 btn-select-hospital"
                        data-hosp-name="${escapeHtml(hospName)}"
                        data-ref-id="${escapeHtml(referralId)}">
                        <i class="bi bi-check2-circle text-base"></i>
                        <span>Select This Hospital</span>
                    </button>
                </div>
            `;

            $list.append(card);
        });

        // Attach click listener for hospital selection
        $('.btn-select-hospital').off('click').on('click.recommendations', function() {
            const selectedHosp = $(this).attr('data-hosp-name');
            const targetRefId = $(this).attr('data-ref-id');
            confirmAndFinalizeReferral(targetRefId, selectedHosp, $(this));
        });
    }

    /**
     * Shared confirm + PATCH /api/v1/referral/{id}/finalize flow, used by both the
     * main "Accepted Hospitals" card and the persistent acceptance popup — this is
     * the doctor's "lock in the transfer" action, so both entry points must agree.
     */
    function confirmAndFinalizeReferral(targetRefId, selectedHosp, $btn) {
        Swal.fire({
            title: 'Confirm Hospital Selection',
            text: `Are you sure you want to select "${selectedHosp}" as the target transfer destination for referral ${targetRefId}?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Yes, Select Hospital',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' }
        }).then((result) => {
            if (!result.isConfirmed) return;
            if (!state.currentHospital) return;

            const apiKey = state.currentHospital.api_key || '';
            const originalBtnHtml = $btn ? $btn.html() : null;
            if ($btn) $btn.html('<span class="spinner-border spinner-border-sm me-2"></span> Finalizing...').prop('disabled', true);

            $.ajax({
                url: `${API_BASE}/finalize_referral.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ referral_id: targetRefId, hospital_name: selectedHosp }),
                dataType: 'json',
                success: function () {
                    $('#hospitalAcceptedToast').addClass('hidden');

                    Swal.fire({
                        icon: 'success',
                        title: 'Destination Hospital Confirmed!',
                        text: `Patient transfer to "${selectedHosp}" has been finalized for referral ${targetRefId}.`,
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });

                    $('#activeReferralStatusBadge')
                        .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white')
                        .text(`Finalized`);

                    // Close out this referral's session client-side so polling stops surfacing it
                    state.activeInitiatedReferralId = null;
                    state.activeInitiatedReferralNumber = null;
                    try { localStorage.removeItem('active_initiated_referral'); } catch (e) {}

                    // Hide the card immediately -- it's finalized, there's nothing left to
                    // decide on. checkAndPollRecommendations() would only clear this itself
                    // on its next poll, which left it sitting there stale for up to 30s.
                    $('#acceptedHospitalsCard').hide();
                },
                error: function (xhr) {
                    if ($btn) $btn.html(originalBtnHtml).prop('disabled', false);

                    const httpStatus = xhr.status || 500;
                    const errData = xhr.responseJSON || {};
                    const rawMsg = errData.message || errData.detail || `HTTP ${httpStatus} Server Error`;
                    const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, httpStatus));

                    Swal.fire({
                        icon: 'error',
                        title: `HTTP ${httpStatus} Error`,
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">Unable to finalize this referral.</p>
                            ${buildErrorNoteHtml(errorMsg, httpStatus)}
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            });
        });
    }

    // Tracks which hospital-acceptance events have already surfaced a toast, per referral
    const knownAcceptedHospitalKeys = new Set();

    let hospitalAcceptedToastTimeout = null;

    /**
     * Show a small, dismissible corner toast when a new hospital accepts, instead of
     * a blocking full-screen popup — the full ranked list already lives in
     * #acceptedHospitalsCard on the page, so the toast just points the doctor to it.
     */
    function showHospitalAcceptedToast(allAcceptedHospitals, newHospitals) {
        const newNames = newHospitals.map(h => h.hospital_name || h.name || 'Hospital').join(', ');
        const total = allAcceptedHospitals.length;

        $('#hospitalAcceptedToastText').text(
            `${newNames} accepted your referral. ${total} facilit${total === 1 ? 'y has' : 'ies have'} accepted so far.`
        );

        $('#hospitalAcceptedToast').removeClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);
        hospitalAcceptedToastTimeout = setTimeout(() => {
            $('#hospitalAcceptedToast').addClass('hidden');
        }, 8000);

        runAction('playNotificationSound');
    }

    $('#btnDismissAcceptedToast').on('click.recommendations', function () {
        $('#hospitalAcceptedToast').addClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);
    });

    $('#btnViewAcceptedHospitals').on('click.recommendations', function () {
        $('#hospitalAcceptedToast').addClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);

        switchTab('referrals');

        const $card = $('#acceptedHospitalsCard');
        if ($card.length) {
            $('html, body').animate({ scrollTop: $card.offset().top - 90 }, 300);
            $card.removeClass('animate-highlight-pulse');
            void $card[0].offsetWidth;
            $card.addClass('animate-highlight-pulse');
        }
    });

    function init() {
        if (initialized) return;
        initialized = true;
        $(document).on('click.recommendations', '#btnRefreshRecommendations', checkAndPollRecommendations);
    }

    IRDSS.referrals.recommendations = Object.freeze({
        configure,
        init,
        check: checkAndPollRecommendations,
        clearActive: clearActiveReferral,
        fetch: fetchRecommendationsForReferral,
        finalize: confirmAndFinalizeReferral,
        resolveLocationAddressHtml
    });
})(window, window.jQuery);
