(function initializeIrdssReferralList(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, displayReferralNumber } = IRDSS.formatters;
    const { showToast, cleanErrorMessage, buildErrorNoteHtml } = IRDSS.ui;
    const attachmentLinksHtml = IRDSS.referrals.form.attachmentLinksHtml;
    let initialized = false;

    // ============================================================
    // MY REFERRALS PAGE (list, filter, cancel)
    // ============================================================
    let myReferralsCache = [];

    const REFERRAL_STATUS_BADGE_CLASS = {
        PENDING: 'bg-amber-100 text-amber-800',
        SEEN: 'bg-red-100 text-red-800',
        ACCEPTED: 'bg-emerald-100 text-emerald-800',
        REDIRECTED: 'bg-indigo-100 text-indigo-800',
        NOT_SELECTED: 'bg-slate-200 text-slate-600',
        CANCELLED: 'bg-slate-200 text-slate-700',
        ARRIVED: 'bg-sky-100 text-sky-800',
        DISCHARGED: 'bg-emerald-100 text-emerald-800',
        REFERRED_ONWARD: 'bg-indigo-100 text-indigo-800',
        TRANSFERRED: 'bg-indigo-100 text-indigo-800',
        DECEASED: 'bg-slate-200 text-slate-800',
        LEFT_AMA: 'bg-orange-100 text-orange-800',
        DEPARTED: 'bg-slate-100 text-slate-700'
    };

    const REFERRAL_STATUS_LABEL = {
        REFERRED_ONWARD: 'Referred Onward',
        DISCHARGED: 'Discharged',
        TRANSFERRED: 'Transferred',
        DECEASED: 'Deceased',
        LEFT_AMA: 'Left AMA',
        DEPARTED: 'Departed'
    };

    function effectiveReferralStatus(referral) {
        if (referral?.departed_at) {
            return String(referral.departure_outcome || 'DEPARTED').trim().toUpperCase();
        }
        if (referral?.onward_referral) return 'REFERRED_ONWARD';
        return String(referral?.status || 'PENDING').trim().toUpperCase();
    }

    function formatReferralTimestamp(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }

    /**
     * Load referrals initiated by this hospital via GET /api/v1/referral/mine
     */
    function loadMyReferrals() {
        if (!state.currentHospital) return;

        const $tableBody = $('#referralsTableBody');

        $.ajax({
            url: `${API_BASE}/get_my_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (data) {
                $('#referralsConnectionAlert').slideUp(200);
                myReferralsCache = (Array.isArray(data) ? data : []).map(referral => ({
                    ...referral,
                    status: effectiveReferralStatus(referral)
                }));
                applyReferralFilters();
                $('#myReferralsLastUpdated').text(
                    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                );
            },
            error: function (xhr) {
                const errData = xhr.responseJSON || {};
                const httpStatus = xhr.status || 500;
                const isConnectionErr = httpStatus === 503 || httpStatus === 0 || (errData.detail && errData.detail.includes("reach the server"));

                if (isConnectionErr) {
                    $('#referralsConnectionAlert').slideDown(200);
                    $tableBody.html(`
                        <tr>
                            <td colspan="8" class="text-center py-8 text-slate-400 font-normal text-xs">
                                Can't reach the server — showing nothing to display.
                            </td>
                        </tr>
                    `);
                    return;
                }

                $('#referralsConnectionAlert').slideUp(200);
                $tableBody.html(`
                    <tr>
                        <td colspan="8" class="text-center py-8 text-red-500 font-normal text-xs">
                            ${escapeHtml(cleanErrorMessage(errData.detail || 'Could not load your referrals.', httpStatus))}
                        </td>
                    </tr>
                `);
            }
        });
    }

    /**
     * Filter the cached referral list by status/date range/search, then re-render
     */
    function applyReferralFilters() {
        const statusFilter = $('#referralFilterStatus').val();
        const fromVal = $('#referralFilterFrom').val();
        const toVal = $('#referralFilterTo').val();
        const search = ($('#referralFilterSearch').val() || '').trim().toLowerCase();

        const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
        const toDate = toVal ? new Date(toVal + 'T23:59:59') : null;

        const filtered = myReferralsCache.filter(function (ref) {
            if (statusFilter && ref.status !== statusFilter) return false;

            if (fromDate || toDate) {
                const created = new Date(ref.created_at);
                if (fromDate && created < fromDate) return false;
                if (toDate && created > toDate) return false;
            }

            if (search) {
                const haystack = `${ref.referral_number || ''} ${ref.referral_id} ${ref.patient_display_id || ref.patient_id} ${ref.clinical_reason}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }

            return true;
        });

        // Sort by created_at descending (newest first)
        filtered.sort(function (a, b) {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA;
        });

        renderReferralsTable(filtered);
    }

    /**
     * Render the "My Referrals" DataTable from a (pre-filtered) referral list
     */
    function renderReferralsTable(referrals) {
        if ($.fn.DataTable.isDataTable('#referralsTable')) {
            $('#referralsTable').DataTable().destroy();
        }

        const $tableBody = $('#referralsTableBody');
        $tableBody.empty();

        if (referrals.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="8" class="text-center py-8 text-slate-400 font-normal">
                        No referrals match the current filters.
                    </td>
                </tr>
            `);
            return;
        }

        referrals.forEach(function (ref) {
            const actionClass = 'px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium inline-flex items-center gap-1 transition-colors';

            const cancelBtn = ref.cancellable
                ? `<button type="button" class="${actionClass} btn-cancel-referral" data-ref-id="${escapeHtml(ref.referral_id)}">
                    Cancel
                </button>`
                : '';

            const row = `
                <tr class="!bg-white hover:!bg-slate-50 transition-colors">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500 border-b border-slate-300/60">${escapeHtml(displayReferralNumber(ref))}</td>
                    <td class="py-3.5 px-6 text-slate-700 text-xs font-mono border-b border-slate-300/60">${escapeHtml(ref.patient_display_id || (String(ref.patient_id || '').startsWith('tx_') ? 'Unavailable' : ref.patient_id))}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(ref.disease_severity)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60"><span class="text-xs font-semibold text-slate-700">${escapeHtml(String(REFERRAL_STATUS_LABEL[ref.status] || ref.status).toUpperCase())}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${formatReferralTimestamp(ref.created_at)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${formatReferralTimestamp(ref.seen_at)}</td>
                    <td class="py-3.5 px-6 text-xs border-b border-slate-300/60">
                        <button type="button" class="${actionClass} btn-view-referral-timeline" data-ref-id="${escapeHtml(ref.referral_id)}">
                            <i class="bi bi-truck me-1"></i> Track
                        </button>
                    </td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60">${cancelBtn}</td>
                </tr>
            `;
            $tableBody.append(row);
        });

        // Stash the raw filtered list for the timeline popup lookup
        $tableBody.data('referrals', referrals);

        $('#referralsTable').DataTable({
            paging: true,
            searching: false,
            ordering: true,
            // order: [] -- without this, DataTables silently re-sorts by column 0
            // (Referral ID, alphabetically) on every render, discarding the
            // newest-first sort already applied above in applyReferralFilters().
            // Column headers stay clickable for a manual re-sort either way.
            order: [],
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [5, 10, 25, 50],
            language: {
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ referrals",
                paginate: {
                    next: '<i class="bi bi-chevron-right"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>'
                }
            }
        });
    }

    $('#btnRefreshReferrals').on('click.referralList', function () {
        if (state.currentHospital) loadMyReferrals();
    });

    $('#referralFilterStatus, #referralFilterFrom, #referralFilterTo').on('change.referralList', applyReferralFilters);
    $('#referralFilterSearch').on('input.referralList', applyReferralFilters);

    $('#btnClearReferralFilters').on('click.referralList', function () {
        $('#referralFilterStatus').val('');
        $('#referralFilterFrom').val('');
        $('#referralFilterTo').val('');
        $('#referralFilterSearch').val('');
        applyReferralFilters();
    });

    /**
     * Renders one step of the Shopee-style vertical tracker: a dot on a connecting line,
     * filled/green with a step-specific icon when complete, hollow/gray when still pending.
     */
    function trackerStep(label, timestamp, completed, isLast, iconClass, extraHtml) {
        const dotClasses = completed
            ? 'bg-slate-700 text-white'
            : 'bg-white text-slate-300 border-2 border-slate-200';
        const labelClasses = completed ? 'text-slate-900' : 'text-slate-400';
        const icon = completed ? `<i class="bi ${iconClass || 'bi-check-lg'} text-xs"></i>` : '';

        return `
            <div class="relative ${isLast ? '' : 'pb-6'} pl-9">
                ${isLast ? '' : `<div class="absolute left-[11px] top-6 bottom-0 w-0.5 bg-slate-200"></div>`}
                <div class="absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${dotClasses}">${icon}</div>
                <p class="text-sm font-semibold ${labelClasses}">${label}</p>
                <p class="text-xs text-slate-500 mt-0.5">${timestamp ? formatReferralTimestamp(timestamp) : (completed ? 'Recorded' : 'Pending')}</p>
                ${extraHtml || ''}
            </div>
        `;
    }

    /**
     * Shopee-style order-tracking UI, adapted for referral lifecycle: Sent -> Seen ->
     * Accepted -> Finalized -> Arrived, each step timestamped once it happens.
     */
    $(document).on('click.referralList', '.btn-view-referral-timeline', function () {
        const referralId = $(this).data('ref-id');
        const referrals = $('#referralsTableBody').data('referrals') || [];
        const ref = referrals.find(function (r) { return r.referral_id === referralId; });
        if (!ref) return;

        const responses = Array.isArray(ref.responses) ? ref.responses : [];

        const onward = ref.onward_referral || null;
        const hasFollowUp = !!(onward || ref.departed_at);

        let stepsHtml;
        if (ref.status === 'CANCELLED') {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false, 'bi-send-fill') +
                trackerStep('Cancelled by Referring Facility', null, true, true, 'bi-x-circle-fill');
        } else {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false, 'bi-send-fill') +
                trackerStep('Seen by a Facility', ref.seen_at, !!ref.seen_at, false, 'bi-eye-fill') +
                trackerStep(ref.receiving_facility ? `Accepted by ${escapeHtml(ref.receiving_facility)}` : 'Accepted', ref.accepted_at, !!ref.accepted_at, false, 'bi-check-circle-fill') +
                trackerStep(ref.receiving_facility ? `Finalized to ${escapeHtml(ref.receiving_facility)}` : 'Finalized', ref.finalized_at, !!ref.finalized_at, false, 'bi-flag-fill') +
                trackerStep('Patient Arrived', ref.arrived_at, !!ref.arrived_at, !hasFollowUp, 'bi-person-check-fill');

            // The patient's journey continues past this hospital's own tracker: the
            // facility they arrived at referred them onward again (detected server-side
            // via the shared anonymized patient_code) -- surface it instead of going dark.
            if (onward) {
                let onwardLabel;
                if (onward.receiving_facility) {
                    onwardLabel = `Referred Onward to ${escapeHtml(onward.receiving_facility)}`;
                } else if (onward.status === 'CANCELLED') {
                    onwardLabel = 'Onward Referral Cancelled';
                } else {
                    onwardLabel = `Referred Onward by ${escapeHtml(ref.receiving_facility || 'Receiving Facility')} — Awaiting Response`;
                }
                stepsHtml += trackerStep(onwardLabel, onward.created_at, true, !ref.departed_at, 'bi-arrow-right-circle-fill');
            }

            // The receiving facility's episode of care ended -- discharged, transferred,
            // deceased, or left AMA. Distinct from "referred onward" (a new referral row).
            if (ref.departed_at) {
                const departureLabelMap = {
                    DISCHARGED: 'Patient Discharged',
                    TRANSFERRED: 'Patient Transferred to Another Facility',
                    DECEASED: 'Patient Deceased',
                    LEFT_AMA: 'Patient Left Against Medical Advice'
                };
                const departLabel = departureLabelMap[ref.departure_outcome] || 'Patient Departed';
                const remarksHtml = ref.departure_remarks
                    ? `<p class="text-xs text-slate-500 mt-1 italic">"${escapeHtml(ref.departure_remarks)}"</p>`
                    : '';
                stepsHtml += trackerStep(departLabel, ref.departed_at, true, true, 'bi-box-arrow-right', remarksHtml);
            }
        }

        const notifiedHtml = responses.length
            ? responses.map(function (r) {
                // A hospital that opened the referral but hasn't accepted/redirected yet is
                // still technically PENDING server-side -- show it as SEEN so the referring
                // doctor can tell "no one's looked at this" apart from "someone's reviewing it".
                const displayStatus = (r.response_status === 'PENDING' && r.seen_at) ? 'SEEN' : r.response_status;
                const redirectReason = r.response_status === 'REDIRECTED'
                    ? (REDIRECT_REASONS[r.redirect_reason_code] || r.redirect_reason_code || 'Reason not recorded') + (r.redirect_reason_text ? `: ${r.redirect_reason_text}` : '')
                    : '';
                return `
                    <div class="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div class="min-w-0"><p class="text-xs font-medium text-slate-700">${escapeHtml(r.hospital_name)}</p>${redirectReason ? `<p class="text-xs text-slate-500 mt-1">${escapeHtml(redirectReason)}</p>` : ''}</div>
                        <span class="text-[10px] font-semibold text-slate-600 flex-shrink-0">${escapeHtml(displayStatus)}</span>
                    </div>
                `;
            }).join('')
            : '<p class="text-xs text-slate-400 text-center py-3">No hospitals have been notified yet.</p>';

        Swal.fire({
            title: 'REFERRAL TRACKING',
            width: '50rem',
            html: `
                <div class="referral-tracker text-left">
                    <div class="tracker-summary">
                        <span class="font-mono text-xs text-slate-600">${escapeHtml(displayReferralNumber(ref))}</span>
                        <span class="text-xs font-semibold text-slate-700">${escapeHtml(String(REFERRAL_STATUS_LABEL[ref.status] || ref.status).toUpperCase())}</span>
                    </div>
                    <div class="tracker-meta">
                        <div><span>Triage acuity</span><strong>${escapeHtml(ref.triage_display || 'Legacy level ' + ref.disease_severity)}</strong></div>
                        <div><span>Referral priority</span><strong>${escapeHtml(ref.referral_priority || 'Not recorded')}</strong></div>
                    </div>
                    <div class="tracker-columns">
                        <section><h3>PROGRESS</h3>${stepsHtml}</section>
                        <section><h3>NOTIFIED HOSPITALS <span class="font-normal text-slate-500">(${responses.length})</span></h3>
                            <div class="tracker-hospitals">${notifiedHtml}</div>
                            <details class="tracker-disclosure"><summary>CLINICAL DETAILS</summary>
                                <dl class="tracker-clinical">
                                    <dt>Chief complaint</dt><dd>${escapeHtml(ref.chief_complaint_text || ref.chief_complaint || 'Not specified')}${ref.chief_complaint_code ? `<small>${escapeHtml(ref.chief_complaint_display || '')} · SNOMED CT ${escapeHtml(ref.chief_complaint_code)}</small>` : ''}</dd>
                                    <dt>Diagnosis</dt><dd>${escapeHtml(ref.diagnosis_text || ref.diagnosis || ref.diagnosis_display || 'Not specified')}${ref.diagnosis_code ? `<small>${escapeHtml(ref.diagnosis_display || '')} · SNOMED CT ${escapeHtml(ref.diagnosis_code)}</small>` : ''}</dd>
                                    <dt>Condition severity</dt><dd>${escapeHtml(ref.condition_severity_display || 'Not specified')}</dd>
                                </dl>
                            </details>
                            <details class="tracker-disclosure"><summary>ATTACHMENTS</summary>
                                <div id="trackerAttachments"><p class="text-xs text-slate-500">Loading attachments...</p></div>
                            </details>
                        </section>
                    </div>
                </div>
            `,
            confirmButtonText: 'Close',
            confirmButtonColor: '#475569',
            customClass: { popup: 'referral-tracker-popup' },
            didOpen: function () {
                $.getJSON(`${API_BASE}/get_referral_attachments.php?referral_id=${encodeURIComponent(referralId)}`)
                    .done(items => $('#trackerAttachments').html(attachmentLinksHtml(referralId, items)))
                    .fail(() => $('#trackerAttachments').html('<p class="text-xs text-slate-400">Attachments could not be loaded.</p>'));
            }
        });
    });

    /**
     * Cancel a referral via PATCH /api/v1/referral/{id}/cancel — only shown while cancellable
     */
    $(document).on('click.referralList', '.btn-cancel-referral', function () {
        const referralId = $(this).data('ref-id');

        Swal.fire({
            icon: 'warning',
            title: 'Cancel this referral?',
            text: `Referral ${referralId} will be withdrawn from every hospital it was broadcast to.`,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-x-circle me-1"></i> Yes, Cancel It',
            cancelButtonText: 'Keep Referral',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' }
        }).then(function (result) {
            if (!result.isConfirmed) return;

            $.ajax({
                url: `${API_BASE}/cancel_referral.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ referral_id: referralId }),
                dataType: 'json',
                success: function () {
                    showToast('success', 'Referral cancelled', 2000);
                    // Stop the Accepted Hospitals card from still showing it as awaiting
                    IRDSS.referrals.recommendations.clearActive(referralId);
                    loadMyReferrals();
                },
                error: function (xhr) {
                    const status = xhr.status || 500;
                    const errData = xhr.responseJSON || {};
                    const rawMsg = errData.message || errData.detail || `HTTP ${status} Server Error`;
                    const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, status));

                    Swal.fire({
                        icon: 'error',
                        title: `HTTP ${status} Error`,
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">Unable to cancel this referral.</p>
                            ${buildErrorNoteHtml(errorMsg, status)}
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            });
        });
    });

    // Track which referral IDs have already surfaced as a notification, and pending polling state
    function init() {
        if (initialized) return;
        initialized = true;
    }

    IRDSS.referrals.list = Object.freeze({
        init,
        load: loadMyReferrals,
        applyFilters: applyReferralFilters,
        render: renderReferralsTable,
        formatTimestamp: formatReferralTimestamp,
        getCache: function () { return myReferralsCache.slice(); }
    });
})(window, window.jQuery);
