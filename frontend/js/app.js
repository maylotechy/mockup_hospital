/**
 * Mock Hospital HIS - Multi-Hospital System JS
 * Powered by jQuery & Bootstrap 5
 */

$(document).ready(function () {
    // Enable cross-origin credentials for PHP session cookie persistence
    $.ajaxSetup({
        xhrFields: {
            withCredentials: true
        }
    });

    const IRDSS = window.IRDSS;
    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml } = IRDSS.formatters;
    const { showToast, cleanErrorMessage, buildErrorNoteHtml } = IRDSS.ui;

    const { switchTab } = IRDSS.navigation;
    const formatReferralTimestamp = IRDSS.referrals.list.formatTimestamp;

    $(document).on('click', '#btnApplyAnalyticsDates', function () {
        loadFacilityAnalytics();
    });

    $(document).on('click', '#btnClearAnalyticsDates', function () {
        $('#analyticsStartDate, #analyticsEndDate').val('');
        loadFacilityAnalytics();
    });

    $(document).on('click', '#btnExportAnalyticsCsv', function () {
        exportFacilityAnalyticsCsv();
    });

    $(document).on('click', '#btnRefreshLogs', function () {
        loadSystemLogs();
    });

    /**
     * Live System Clock Ticker — renders into the header, left of the notification bell.
     */
    function updateSystemClock() {
        const now = new Date();
        const timeText = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        const dateText = now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        $('#headerTimeText').text(timeText);
        $('#headerDateText').text(dateText);
    }
    setInterval(updateSystemClock, 30000);
    updateSystemClock();

    /**
     * Copy API Key to Clipboard
     */
    $('#btnCopyApiKey').on('click', function () {
        const apiKeyText = $('#displayApiKey').text();
        navigator.clipboard.writeText(apiKeyText).then(function () {
            showToast('success', 'API Key copied to clipboard!', 2000);
        });
    });

    /**
     * Facility Admin Analytics tab -- reuses the same two endpoints Incoming Patients
     * uses for its outcome counters (so the numbers can never drift apart between the
     * doctor/nurse view and the admin view), plus a dedicated aggregation endpoint for
     * top reasons/senders/receivers and monthly referral volume.
     */
    let analyticsCharts = {};
    let latestAnalyticsExport = null;

    function loadFacilityAnalytics() {
        if (!state.currentUser || state.currentUser.role !== 'facility_admin') return;

        const startDate = $('#analyticsStartDate').val();
        const endDate = $('#analyticsEndDate').val();
        if (startDate && endDate && startDate > endDate) {
            showToast('error', 'Start date must be on or before end date.', 3500);
            return;
        }

        const analyticsQuery = {};
        if (startDate) analyticsQuery.start_date = startDate;
        if (endDate) analyticsQuery.end_date = endDate;

        $('#btnApplyAnalyticsDates, #btnClearAnalyticsDates').prop('disabled', true);
        $('#btnExportAnalyticsCsv').prop('disabled', true);

        $.when(
            $.ajax({ url: `${API_BASE}/get_referral_outcomes.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_onward_referred_referral_ids.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_facility_analytics.php`, type: 'GET', data: analyticsQuery, dataType: 'json' })
        ).done(function (outcomesRes, onwardRes, analyticsRes) {
            const allOutcomes = Array.isArray(outcomesRes[0]) ? outcomesRes[0] : [];
            const outcomes = allOutcomes.filter(outcome => {
                if (!startDate && !endDate) return true;
                const createdDate = String(outcome.created_at || '').slice(0, 10);
                if (!createdDate) return false;
                return (!startDate || createdDate >= startDate) && (!endDate || createdDate <= endDate);
            });
            const onwardData = onwardRes[0];
            const onwardReferredIds = new Set(
                (onwardData && onwardData.success && Array.isArray(onwardData.data)) ? onwardData.data : []
            );

            const chosen = outcomes.filter(o => o.outcome === 'CHOSEN');
            const bypassed = outcomes.filter(o => o.outcome === 'BYPASSED');
            const dischargedCount = chosen.filter(o => o.departure_outcome === 'DISCHARGED').length;
            const referredOnwardCount = chosen.filter(o => onwardReferredIds.has(o.referral_id)).length;

            $('#analyticsStatTransferredToUs').text(chosen.length);
            $('#analyticsStatRedirectedElsewhere').text(bypassed.length);
            $('#analyticsStatDischarged').text(dischargedCount);
            $('#analyticsStatReferredOnward').text(referredOnwardCount);

            const analytics = (analyticsRes[0] && typeof analyticsRes[0] === 'object') ? analyticsRes[0] : {};
            renderAnalyticsCharts(analytics);
            updateAnalyticsPeriodLabel(startDate, endDate);
            latestAnalyticsExport = {
                analytics,
                period: { startDate, endDate },
                counters: {
                    transferredToUs: chosen.length,
                    redirectedElsewhere: bypassed.length,
                    discharged: dischargedCount,
                    referredOnward: referredOnwardCount
                }
            };
            $('#btnExportAnalyticsCsv').prop('disabled', false);
        }).fail(function () {
            showToast('error', 'Could not load facility analytics.', 3500);
            latestAnalyticsExport = null;
        }).always(function () {
            $('#btnApplyAnalyticsDates, #btnClearAnalyticsDates').prop('disabled', false);
        });
    }

    function updateAnalyticsPeriodLabel(startDate, endDate) {
        const formatDate = value => new Intl.DateTimeFormat('en-PH', {
            year: 'numeric', month: 'short', day: 'numeric'
        }).format(new Date(`${value}T00:00:00`));

        let label = 'Showing all available referral history';
        let shortLabel = 'all-time';
        if (startDate && endDate) {
            label = `Showing ${formatDate(startDate)} to ${formatDate(endDate)}`;
            shortLabel = `${formatDate(startDate)} to ${formatDate(endDate)}`;
        } else if (startDate) {
            label = `Showing referrals from ${formatDate(startDate)} onward`;
            shortLabel = `from ${formatDate(startDate)}`;
        } else if (endDate) {
            label = `Showing referrals through ${formatDate(endDate)}`;
            shortLabel = `through ${formatDate(endDate)}`;
        }

        $('#analyticsPeriodLabel').text(label);
        $('#analyticsVolumeSubtitle').text(`Referrals sent by your facility vs. referrals received, by month, ${shortLabel}`);
    }

    function exportFacilityAnalyticsCsv() {
        if (!latestAnalyticsExport) return;

        const { analytics, period, counters } = latestAnalyticsExport;
        const monthly = Array.isArray(analytics.monthly_volume) ? analytics.monthly_volume : [];
        const reasons = Array.isArray(analytics.top_reasons) ? analytics.top_reasons : [];
        const incomingReasons = Array.isArray(analytics.top_incoming_reasons) ? analytics.top_incoming_reasons : [];
        const senders = Array.isArray(analytics.top_senders) ? analytics.top_senders : [];
        const receivers = Array.isArray(analytics.top_receivers) ? analytics.top_receivers : [];
        const rows = [
            ['Facility Analytics Report'],
            ['Start date', period.startDate || 'All time'],
            ['End date', period.endDate || 'All time'],
            [],
            ['Outcome', 'Count'],
            ['Transferred To Us', counters.transferredToUs],
            ['Accepted But Sent Elsewhere', counters.redirectedElsewhere],
            ['Discharged', counters.discharged],
            ['Referred Onward', counters.referredOnward],
            [],
            ['Monthly Referral Volume'],
            ['Month', 'Sent', 'Received'],
            ...monthly.map(row => [row.month, row.sent, row.received]),
            [],
            ['Top Reasons You Refer Out'],
            ['Rank', 'Reason', 'Count'],
            ...reasons.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Reasons Patients Are Referred to You'],
            ['Rank', 'Reason', 'Count'],
            ...incomingReasons.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Facilities Sending To You'],
            ['Rank', 'Facility', 'Count'],
            ...senders.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Facilities You Refer To'],
            ['Rank', 'Facility', 'Count'],
            ...receivers.map((row, index) => [index + 1, row.label, row.count])
        ];

        const csvCell = value => {
            let text = String(value ?? '');
            // Prevent spreadsheet applications from treating labels as formulas.
            if (/^[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        };
        const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const suffix = period.startDate || period.endDate
            ? `${period.startDate || 'beginning'}_to_${period.endDate || 'present'}`
            : 'all_time';
        link.href = url;
        link.download = `facility_analytics_${suffix}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function renderAnalyticsCharts(analytics) {
        const monthly = Array.isArray(analytics.monthly_volume) ? analytics.monthly_volume : [];
        const reasons = Array.isArray(analytics.top_reasons) ? analytics.top_reasons : [];
        const incomingReasons = Array.isArray(analytics.top_incoming_reasons) ? analytics.top_incoming_reasons : [];
        const senders = Array.isArray(analytics.top_senders) ? analytics.top_senders : [];
        const receivers = Array.isArray(analytics.top_receivers) ? analytics.top_receivers : [];

        $('#analyticsVolumeEmpty').toggle(monthly.length === 0);
        $('#analyticsReasonsEmpty').toggle(reasons.length === 0);
        $('#analyticsIncomingReasonsEmpty').toggle(incomingReasons.length === 0);
        $('#analyticsSendersEmpty').toggle(senders.length === 0);
        $('#analyticsReceiversEmpty').toggle(receivers.length === 0);
        $('#analyticsReasonsChartWrap').toggle(reasons.length > 0);
        $('#analyticsIncomingReasonsChartWrap').toggle(incomingReasons.length > 0);
        $('#analyticsSendersChartWrap').toggle(senders.length > 0);
        $('#analyticsReceiversChartWrap').toggle(receivers.length > 0);

        Object.values(analyticsCharts).forEach(chart => chart && chart.destroy());
        analyticsCharts = {};

        if (monthly.length && typeof Chart !== 'undefined') {
            analyticsCharts.volume = new Chart($('#analyticsVolumeChart')[0], {
                type: 'line',
                data: {
                    labels: monthly.map(m => m.month),
                    datasets: [
                        { label: 'Sent', data: monthly.map(m => m.sent), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.3, fill: true },
                        { label: 'Received', data: monthly.map(m => m.received), borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.1)', tension: 0.3, fill: true }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
                }
            });
        }

        renderAnalyticsDoughnut('reasons', '#analyticsReasonsChart', reasons, ['#9333ea', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff']);
        renderAnalyticsDoughnut('incomingReasons', '#analyticsIncomingReasonsChart', incomingReasons, ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']);
        renderAnalyticsDoughnut('senders', '#analyticsSendersChart', senders, ['#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0']);
        renderAnalyticsDoughnut('receivers', '#analyticsReceiversChart', receivers, ['#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a']);
    }

    function renderAnalyticsDoughnut(chartKey, canvasSelector, rows, colors) {
        if (!rows.length || typeof Chart === 'undefined') return;

        const visibleRows = rows.slice(0, 5);
        analyticsCharts[chartKey] = new Chart($(canvasSelector)[0], {
            type: 'doughnut',
            data: {
                labels: visibleRows.map(row => row.label),
                datasets: [{
                    data: visibleRows.map(row => row.count),
                    backgroundColor: colors,
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '58%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            boxHeight: 12,
                            padding: 14,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.label}: ${context.parsed}`
                        }
                    }
                }
            }
        });
    }

    /**
     * Facility Admin System Logs tab -- reads the local audit_logs table (never
     * proxied through IOL, since IOL only authenticates at the facility level and
     * has no concept of individual staff users).
     */
    const AUDIT_ACTION_LABEL = {
        REFERRAL_SENT: { text: 'Sent Referral', badge: 'bg-red-50 text-red-700' },
        REFERRAL_ACCEPTED: { text: 'Accepted Referral', badge: 'bg-emerald-50 text-emerald-700' },
        REFERRAL_REJECTED: { text: 'Rejected Referral', badge: 'bg-slate-100 text-slate-700' },
        REFERRAL_FINALIZED: { text: 'Finalized Referral', badge: 'bg-indigo-50 text-indigo-700' },
        REFERRAL_CANCELLED: { text: 'Cancelled Referral', badge: 'bg-rose-50 text-rose-700' },
        PATIENT_ARRIVED: { text: 'Marked Arrived', badge: 'bg-amber-50 text-amber-700' },
        PATIENT_ARRIVED_LINKED: { text: 'Linked Arrival to Existing Patient', badge: 'bg-teal-50 text-teal-700' },
        PATIENT_DEPARTED: { text: 'Marked Departed', badge: 'bg-purple-50 text-purple-700' },
        PATIENT_ADDED: { text: 'Added Patient', badge: 'bg-sky-50 text-sky-700' }
    };

    function loadSystemLogs() {
        const $tableBody = $('#logsTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400 font-normal">
                    <div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-red-600 border-t-transparent mr-2"></div>
                    Loading activity log...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/get_audit_logs.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.success && Array.isArray(response.data)) {
                    renderLogsTable(response.data);
                } else {
                    $tableBody.html(`
                        <tr>
                            <td colspan="7" class="text-center py-8 text-red-500 font-normal">
                                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                                ${response.message || 'Failed to load activity log.'}
                            </td>
                        </tr>
                    `);
                }
            },
            error: function () {
                $tableBody.html(`
                    <tr>
                        <td colspan="7" class="text-center py-8 text-red-500 font-normal">
                            <i class="bi bi-wifi-off me-1"></i>
                            Error connecting to backend API.
                        </td>
                    </tr>
                `);
            }
        });
    }

    function renderLogsTable(logs) {
        if ($.fn.DataTable.isDataTable('#logsTable')) {
            $('#logsTable').DataTable().destroy();
        }

        const $tableBody = $('#logsTableBody');
        $tableBody.empty();

        if (logs.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="7" class="text-center py-8 text-slate-400 font-normal">
                        No activity recorded yet.
                    </td>
                </tr>
            `);
            return;
        }

        logs.forEach(function (log) {
            const meta = AUDIT_ACTION_LABEL[log.action] || { text: log.action, badge: 'bg-slate-100 text-slate-700' };
            const row = `
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${formatReferralTimestamp(log.created_at)}</td>
                    <td class="py-3.5 px-6 text-xs font-medium text-slate-800 border-b border-slate-200/70">${escapeHtml(log.user_full_name)}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-500 capitalize border-b border-slate-200/70">${escapeHtml(log.user_role)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-200/70"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${meta.badge}">${escapeHtml(meta.text)}</span></td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${log.patient_name ? escapeHtml(log.patient_name) : '—'}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-500 border-b border-slate-200/70">${log.referral_id ? escapeHtml(log.referral_id) : '—'}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${log.details ? escapeHtml(log.details) : '—'}</td>
                </tr>
            `;
            $tableBody.append(row);
        });

        $('#logsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            // order: [] -- logs already arrive newest-first from the backend; without
            // this DataTables would silently re-sort by column 0 on render (same
            // gotcha as the referrals table).
            order: [],
            info: true,
            responsive: true,
            pageLength: 15,
            lengthMenu: [15, 25, 50, 100],
            language: {
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ activity entries",
                search: "Search:"
            }
        });
    }

    /**
     * Load facility staff accounts (Facility Admin only)
     */
    function loadUsers() {
        const $tableBody = $('#usersTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="7" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading staff accounts...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.success && Array.isArray(response.data)) {
                    renderUsersTable(response.data);
                } else {
                    $tableBody.html(`
                        <tr>
                            <td colspan="7" class="text-center py-4 text-danger">
                                ${response.message || 'Failed to load staff accounts.'}
                            </td>
                        </tr>
                    `);
                }
            },
            error: function (xhr, status, error) {
                $tableBody.html(`
                    <tr>
                        <td colspan="7" class="text-center py-4 text-danger">
                            Error connecting to backend API (${xhr.status} ${error}).
                        </td>
                    </tr>
                `);
            }
        });
    }

    const ROLE_LABELS = { facility_admin: 'Facility Admin', doctor: 'Doctor', nurse: 'Nurse' };

    function renderUsersTable(users) {
        const $tableBody = $('#usersTableBody');
        $tableBody.empty();

        if (users.length === 0) {
            $tableBody.html(`<tr><td colspan="7" class="text-center py-4 text-muted">No staff accounts yet.</td></tr>`);
            return;
        }

        users.forEach(function (user) {
            const statusBadge = user.is_active
                ? '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'
                : '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>';
            const isSelf = state.currentUser && state.currentUser.id === user.id;

            const row = `
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-semibold text-slate-900 border-b border-slate-300/60">${escapeHtml(user.full_name)}${isSelf ? ' <span class="text-[10px] text-slate-400 font-normal">(you)</span>' : ''}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${escapeHtml(user.username)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${user.license_number ? escapeHtml(user.license_number) : '<span class="text-slate-300">—</span>'}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60 max-w-[220px] truncate" title="${escapeHtml(user.trainings || '')}">${user.trainings ? escapeHtml(user.trainings) : '<span class="text-slate-300">—</span>'}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60">${statusBadge}</td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60">
                        <div class="flex items-center justify-end gap-2">
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-blue-600 border border-blue-300 text-xs font-medium rounded-lg shadow-sm transition-all btn-edit-user"
                                data-id="${user.id}" data-full-name="${escapeHtml(user.full_name)}" data-role="${escapeHtml(user.role)}"
                                data-license-number="${escapeHtml(user.license_number || '')}" data-trainings="${escapeHtml(user.trainings || '')}">
                                Edit
                            </button>
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm transition-all btn-toggle-user" data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                                ${user.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-red-600 border border-red-300 text-xs font-medium rounded-lg shadow-sm transition-all btn-delete-user" data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            $tableBody.append(row);
        });
    }

    $('#btnRefreshUsers').on('click', function () { loadUsers(); });

    // Clinical credentials (license number / trainings) only make sense for Doctor/Nurse
    function toggleUserClinicalFields() {
        const isClinical = $('#inputUserRole').val() !== 'facility_admin';
        $('#userClinicalFields').toggle(isClinical);
        if (!isClinical) {
            $('#inputUserLicenseNumber, #inputUserTrainings').val('');
        }
    }
    $('#inputUserRole').on('change', toggleUserClinicalFields);
    toggleUserClinicalFields();

    $('#btnGenerateUserPassword').on('click', function () {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let pwd = '';
        for (let i = 0; i < 8; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        $('#inputUserPassword').val(pwd).attr('type', 'text');
    });

    $('#addUserForm').on('submit', function (e) {
        e.preventDefault();

        const $submitBtn = $('#btnSubmitAddUser');
        const originalBtnHtml = $submitBtn.html();
        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Creating...').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'POST',
            data: {
                full_name: $('#inputUserFullName').val(),
                role: $('#inputUserRole').val(),
                username: $('#inputUserUsername').val(),
                password: $('#inputUserPassword').val(),
                license_number: $('#inputUserLicenseNumber').val(),
                trainings: $('#inputUserTrainings').val()
            },
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                if (response.success) {
                    $('#addUserForm')[0].reset();
                    toggleUserClinicalFields();
                    loadUsers();
                    showToast('success', 'Staff account created.', 2500);
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Create Account',
                        text: response.message || 'Please check the form and try again.',
                        confirmButtonColor: '#dc3545'
                    });
                }
            },
            error: function (xhr) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                const serverMsg = xhr.responseJSON && xhr.responseJSON.message;
                Swal.fire({
                    icon: 'error',
                    title: 'Could Not Create Account',
                    text: serverMsg || `Failed to create account (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    });

    /**
     * Lets a facility_admin edit one of their own facility's staff accounts --
     * full name, role, clinical credentials, and optionally a new password (left
     * blank to keep the current one). Scoped server-side to the admin's own
     * facility_id, same as every other manage_users.php action.
     */
    $(document).on('click', '.btn-edit-user', function () {
        const $btn = $(this);
        const userId = $btn.data('id');
        const currentFullName = $btn.data('full-name');
        const currentRole = $btn.data('role');
        const currentLicenseNumber = $btn.data('license-number');
        const currentTrainings = $btn.data('trainings');

        Swal.fire({
            title: 'Edit Staff Account',
            html: `
                <div class="text-start">
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                    <input type="text" id="editUserFullName" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentFullName)}">

                    <label class="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                    <select id="editUserRole" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3">
                        <option value="facility_admin" ${currentRole === 'facility_admin' ? 'selected' : ''}>Facility Admin</option>
                        <option value="doctor" ${currentRole === 'doctor' ? 'selected' : ''}>Doctor</option>
                        <option value="nurse" ${currentRole === 'nurse' ? 'selected' : ''}>Nurse</option>
                    </select>

                    <div id="editUserClinicalFields">
                        <label class="block text-xs font-semibold text-slate-500 mb-1">License Number</label>
                        <input type="text" id="editUserLicenseNumber" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentLicenseNumber)}">

                        <label class="block text-xs font-semibold text-slate-500 mb-1">Trainings</label>
                        <input type="text" id="editUserTrainings" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentTrainings)}">
                    </div>

                    <label class="block text-xs font-semibold text-slate-500 mb-1">New Password</label>
                    <input type="password" id="editUserNewPassword" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500" placeholder="Leave blank to keep current password">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            reverseButtons: true,
            focusConfirm: false,
            didOpen: function () {
                const toggleClinicalFields = function () {
                    $('#editUserClinicalFields').toggle($('#editUserRole').val() !== 'facility_admin');
                };
                $('#editUserRole').on('change', toggleClinicalFields);
                toggleClinicalFields();
            },
            preConfirm: function () {
                const fullName = $('#editUserFullName').val().trim();
                const role = $('#editUserRole').val();
                if (!fullName) {
                    Swal.showValidationMessage('Full name is required.');
                    return false;
                }
                const newPassword = $('#editUserNewPassword').val();
                if (newPassword && newPassword.length < 6) {
                    Swal.showValidationMessage('Password must be at least 6 characters.');
                    return false;
                }
                return {
                    full_name: fullName,
                    role: role,
                    license_number: $('#editUserLicenseNumber').val(),
                    trainings: $('#editUserTrainings').val(),
                    new_password: newPassword
                };
            }
        }).then(function (result) {
            if (!result.isConfirmed) return;

            $.ajax({
                url: `${API_BASE}/manage_users.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify(Object.assign({ id: userId, action: 'edit' }, result.value)),
                dataType: 'json',
                success: function (response) {
                    if (response.success) {
                        showToast('success', response.message || 'Staff account updated.', 2500);
                        loadUsers();
                    } else {
                        Swal.fire({ icon: 'error', title: 'Could Not Update Account', text: response.message, confirmButtonColor: '#dc3545' });
                    }
                },
                error: function (xhr) {
                    const errData = xhr.responseJSON || {};
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Update Account',
                        text: errData.message || `Request failed (${xhr.status}).`,
                        confirmButtonColor: '#dc3545'
                    });
                }
            });
        });
    });

    $(document).on('click', '.btn-toggle-user', function () {
        const userId = $(this).data('id');
        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ id: userId, action: 'toggle_active' }),
            dataType: 'json',
            success: function (response) {
                if (response.success) {
                    loadUsers();
                } else {
                    Swal.fire({ icon: 'error', title: 'Error', text: response.message || 'Could not update account.', confirmButtonColor: '#dc3545' });
                }
            }
        });
    });

    $(document).on('click', '.btn-delete-user', function () {
        const userId = $(this).data('id');
        Swal.fire({
            title: 'Remove this account?',
            text: 'This staff member will no longer be able to log in.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            confirmButtonText: 'Yes, Remove'
        }).then((result) => {
            if (result.isConfirmed) {
                $.ajax({
                    url: `${API_BASE}/manage_users.php?id=${encodeURIComponent(userId)}`,
                    type: 'DELETE',
                    dataType: 'json',
                    success: function (response) {
                        if (response.success) {
                            loadUsers();
                        } else {
                            Swal.fire({ icon: 'error', title: 'Error', text: response.message || 'Could not remove account.', confirmButtonColor: '#dc3545' });
                        }
                    }
                });
            }
        });
    });

    /**
     * Load / populate the facility's Service Assessment (full DOH Assessment Instrument,
     * rendered dynamically by service_assessment.js against IOL's live form + submit API)
     */
    function loadServiceAssessment() {
        const doh = window.DOHAssessment || (typeof DOHAssessment !== 'undefined' ? DOHAssessment : null);
        if (doh && typeof doh.loadForm === 'function') {
            doh.loadForm();
        } else {
            console.error('DOHAssessment module not found on window object!');
        }
    }

    /**
     * PSGC API (https://psgc.cloud/api) Cascading Location Selector.
     * Shared cache + fetch logic, instantiated per set of region/province/city/barangay
     * selects (referral modal has geocoding, patient modal is just the four dropdowns).
     */
    let psgcCache = {
        regions: null,
        provinces: {},
        cities: {},
        barangays: {}
    };

    // psgc.cloud occasionally returns unrelated entries appended to a province/region's
    // city list (observed: Sarangani's cities-municipalities response also includes every
    // Metro Manila city/sub-municipality -- codes starting "13" (NCR) under a "12"
    // (SOCCSKSARGEN) province). Filter by the outer 2-digit REGION prefix only, not the
    // deeper province-level block: a Highly Urbanized City like City of Davao is coded
    // outside any province's own numbering block (1130700000 vs Davao del Sur's
    // 1102400000) even though it's correctly still part of that region and legitimately
    // belongs in the dropdown -- filtering on the full province prefix wrongly excluded it.
    function filterCitiesToExpectedArea(cities, regionCode) {
        const regionPrefix = regionCode ? regionCode.substring(0, 2) : null;
        if (!regionPrefix) return cities;
        const filtered = cities.filter(c => c.code && c.code.substring(0, 2) === regionPrefix);
        return filtered.length > 0 ? filtered : cities;
    }

    /**
     * @param {{region:string, province:string, city:string, barangay:string}} sel jQuery selectors
     * @param {function(string,string,string,string):void} [onResolved] called with (region, province, city, barangay) after every cascade step
     */
    function createLocationCascade(sel, onResolved) {
        let eventsBound = false;
        // When set (via init(preferredTarget)), each dropdown prefers selecting this exact
        // value over the hardcoded Davao-area defaults below -- used to prefill a patient's
        // own registered address instead of always defaulting to Davao City.
        let preferredTarget = null;
        const hasPreferred = function (fieldName) {
            return !!(preferredTarget && preferredTarget[fieldName]);
        };
        const prefers = function (fieldName, optionName) {
            return hasPreferred(fieldName) &&
                optionName.trim().toLowerCase() === preferredTarget[fieldName].trim().toLowerCase();
        };

        function resolve() {
            if (onResolved) {
                onResolved($(sel.region).val(), $(sel.province).val(), $(sel.city).val(), $(sel.barangay).val());
            }
        }

        function loadRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append('<option value="">Loading regions...</option>');

            if (psgcCache.regions && psgcCache.regions.length > 0) {
                populateRegionDropdown(psgcCache.regions);
                return;
            }

            $.ajax({
                url: 'https://psgc.cloud/api/regions',
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data) && data.length > 0) {
                        psgcCache.regions = data;
                        populateRegionDropdown(data);
                    } else {
                        fallbackRegions();
                    }
                },
                error: function() {
                    fallbackRegions();
                }
            });
        }

        function populateRegionDropdown(regions) {
            const $regionSelect = $(sel.region);
            $regionSelect.empty();

            regions.forEach(region => {
                const option = $('<option>')
                    .attr('value', region.name)
                    .attr('data-code', region.code)
                    .text(region.name);

                // Prefer the patient's own registered region if we have one; otherwise
                // default to Region XI (Davao Region)
                if (hasPreferred('region') ? prefers('region', region.name) : (region.code === '1100000000' || region.name.includes('Davao'))) {
                    option.prop('selected', true);
                }

                $regionSelect.append(option);
            });

            if (!$regionSelect.val() && regions.length > 0) {
                $regionSelect.val(regions[0].name);
            }

            loadProvincesForSelectedRegion();
        }

        function fallbackRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append(`
                <option value="Region XI (Davao Region)" data-code="1100000000" selected>Region XI (Davao Region)</option>
                <option value="Region X (Northern Mindanao)" data-code="1000000000">Region X (Northern Mindanao)</option>
                <option value="Region IX (Zamboanga Peninsula)" data-code="0900000000">Region IX (Zamboanga Peninsula)</option>
                <option value="Region XII (SOCCSKSARGEN)" data-code="1200000000">Region XII (SOCCSKSARGEN)</option>
                <option value="Region XIII (Caraga)" data-code="1600000000">Region XIII (Caraga)</option>
                <option value="BARMM" data-code="1900000000">BARMM</option>
                <option value="NCR (Metro Manila)" data-code="1300000000">NCR (Metro Manila)</option>
            `);
            loadProvincesForSelectedRegion();
        }

        function loadProvincesForSelectedRegion() {
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append('<option value="">Loading provinces...</option>');

            if (!regionCode) {
                loadCitiesForSelectedProvince();
                return;
            }

            if (psgcCache.provinces[regionCode]) {
                populateProvinceDropdown(psgcCache.provinces[regionCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/regions/${regionCode}/provinces`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.provinces[regionCode] = data;
                        populateProvinceDropdown(data);
                    } else {
                        fallbackProvinces();
                    }
                },
                error: function() {
                    fallbackProvinces();
                }
            });
        }

        function populateProvinceDropdown(provinces) {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty();

            if (provinces.length === 0) {
                const regionName = $(sel.region).val();
                $provinceSelect.append(`<option value="${regionName}" data-code="N/A">${regionName}</option>`);
            } else {
                provinces.forEach(prov => {
                    const option = $('<option>')
                        .attr('value', prov.name)
                        .attr('data-code', prov.code)
                        .text(prov.name);

                    if (hasPreferred('province') ? prefers('province', prov.name) : prov.name.includes('Davao del Sur')) {
                        option.prop('selected', true);
                    }
                    $provinceSelect.append(option);
                });

                if (!$provinceSelect.val() && provinces.length > 0) {
                    $provinceSelect.val(provinces[0].name);
                }
            }

            loadCitiesForSelectedProvince();
        }

        function fallbackProvinces() {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append(`
                <option value="Davao del Sur" data-code="1102400000" selected>Davao del Sur</option>
                <option value="Davao del Norte" data-code="1102300000">Davao del Norte</option>
                <option value="Misamis Oriental" data-code="1004300000">Misamis Oriental</option>
                <option value="South Cotabato" data-code="1206300000">South Cotabato</option>
            `);
            loadCitiesForSelectedProvince();
        }

        function loadCitiesForSelectedProvince() {
            const provinceCode = $(sel.province).find('option:selected').attr('data-code');
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $citySelect = $(sel.city);
            $citySelect.empty().append('<option value="">Loading cities...</option>');

            const fetchUrl = (provinceCode && provinceCode !== 'N/A')
                ? `https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`
                : `https://psgc.cloud/api/regions/${regionCode}/cities-municipalities`;

            const cacheKey = (provinceCode && provinceCode !== 'N/A') ? provinceCode : `region_${regionCode}`;

            if (psgcCache.cities[cacheKey]) {
                populateCityDropdown(psgcCache.cities[cacheKey]);
                return;
            }

            $.ajax({
                url: fetchUrl,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        const cleanData = filterCitiesToExpectedArea(data, regionCode);
                        psgcCache.cities[cacheKey] = cleanData;
                        populateCityDropdown(cleanData);
                    } else {
                        fallbackCities();
                    }
                },
                error: function() {
                    fallbackCities();
                }
            });
        }

        function populateCityDropdown(cities) {
            const $citySelect = $(sel.city);
            $citySelect.empty();

            cities.forEach(city => {
                const option = $('<option>')
                    .attr('value', city.name)
                    .attr('data-code', city.code)
                    .text(city.name);

                if (hasPreferred('city') ? prefers('city', city.name) : city.name.includes('Davao')) {
                    option.prop('selected', true);
                }
                $citySelect.append(option);
            });

            if (!$citySelect.val() && cities.length > 0) {
                $citySelect.val(cities[0].name);
            }

            loadBarangaysForSelectedCity();
        }

        function fallbackCities() {
            const $citySelect = $(sel.city);
            $citySelect.empty().append(`
                <option value="City of Davao" data-code="1130700000" selected>City of Davao</option>
                <option value="City of Digos" data-code="1102403000">City of Digos</option>
                <option value="Santa Cruz" data-code="1102412000">Santa Cruz</option>
            `);
            loadBarangaysForSelectedCity();
        }

        function loadBarangaysForSelectedCity() {
            const cityCode = $(sel.city).find('option:selected').attr('data-code');
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append('<option value="">Loading barangays...</option>');

            if (!cityCode) {
                resolve();
                return;
            }

            if (psgcCache.barangays[cityCode]) {
                populateBarangayDropdown(psgcCache.barangays[cityCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/cities-municipalities/${cityCode}/barangays`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.barangays[cityCode] = data;
                        populateBarangayDropdown(data);
                    } else {
                        fallbackBarangays();
                    }
                },
                error: function() {
                    fallbackBarangays();
                }
            });
        }

        function populateBarangayDropdown(barangays) {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty();

            if (barangays.length === 0) {
                $barangaySelect.append('<option value="Poblacion" data-code="N/A">Poblacion</option>');
            } else {
                barangays.forEach(brgy => {
                    const option = $('<option>')
                        .attr('value', brgy.name)
                        .attr('data-code', brgy.code)
                        .text(brgy.name);

                    if (hasPreferred('barangay') ? prefers('barangay', brgy.name) : (brgy.name.toLowerCase().includes('buhangin') || brgy.name.toLowerCase().includes('poblacion'))) {
                        option.prop('selected', true);
                    }
                    $barangaySelect.append(option);
                });

                if (!$barangaySelect.val() && barangays.length > 0) {
                    $barangaySelect.val(barangays[0].name);
                }
            }

            resolve();
        }

        function fallbackBarangays() {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append(`
                <option value="Buhangin" data-code="1130700100" selected>Buhangin</option>
                <option value="Poblacion" data-code="1130700200">Poblacion</option>
                <option value="Agdao" data-code="1130700300">Agdao</option>
            `);
            resolve();
        }

        return {
            /**
             * @param {{region:string, province:string, city:string, barangay:string}} [target]
             *   When given, each dropdown selects this exact address instead of the
             *   hardcoded Davao-area defaults -- e.g. a patient's own registered address.
             */
            init: function(target) {
                preferredTarget = target || null;
                if (!eventsBound) {
                    eventsBound = true;
                    $(sel.region).on('change', loadProvincesForSelectedRegion);
                    $(sel.province).on('change', loadCitiesForSelectedProvince);
                    $(sel.city).on('change', loadBarangaysForSelectedCity);
                    $(sel.barangay).on('change', resolve);
                }
                loadRegions();
            }
        };
    }

    let geocodeDebounceTimer = null;

    function applyCoordinates(lat, lng) {
        const latFormatted = parseFloat(lat).toFixed(6);
        const lngFormatted = parseFloat(lng).toFixed(6);

        $('#modalLatitude').val(latFormatted);
        $('#modalLongitude').val(lngFormatted);
        $('#displayLatLongText').text(`${latFormatted}, ${lngFormatted}`);
    }

    const referralLocationCascade = createLocationCascade({
        region: '#selectRegion', province: '#selectProvince', city: '#selectCity', barangay: '#selectBarangay'
    }, function(region, province, city, barangay) {
        const resolvedAddress = [barangay, city, province, region].filter(Boolean).join(', ');
        $('#displayResolvedAddress').text(resolvedAddress);

        let defaultLat = 7.1907;
        let defaultLng = 125.4553;

        if (city) {
            const cLower = city.toLowerCase();
            if (cLower.includes('cagayan de oro')) { defaultLat = 8.4542; defaultLng = 124.6319; }
            else if (cLower.includes('general santos')) { defaultLat = 6.1164; defaultLng = 125.1716; }
            else if (cLower.includes('zamboanga')) { defaultLat = 6.9214; defaultLng = 122.0790; }
            else if (cLower.includes('butuan')) { defaultLat = 8.9475; defaultLng = 125.5406; }
            else if (cLower.includes('digos')) { defaultLat = 6.7583; defaultLng = 125.3572; }
            else if (cLower.includes('cebu')) { defaultLat = 10.3157; defaultLng = 123.8854; }
            else if (cLower.includes('manila') || cLower.includes('quezon')) { defaultLat = 14.5995; defaultLng = 120.9842; }
        }

        applyCoordinates(defaultLat, defaultLng);

        if (geocodeDebounceTimer) clearTimeout(geocodeDebounceTimer);

        geocodeDebounceTimer = setTimeout(() => {
            const query = `${barangay ? barangay + ', ' : ''}${city}, ${province}, Philippines`;

            $.ajax({
                url: 'https://nominatim.openstreetmap.org/search',
                data: { format: 'json', q: query, limit: 1 },
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 4000,
                success: function(results) {
                    if (results && results.length > 0) {
                        const lat = parseFloat(results[0].lat);
                        const lng = parseFloat(results[0].lon);
                        applyCoordinates(lat, lng);
                    }
                }
            });
        }, 400);
    });

    const patientLocationCascade = createLocationCascade({
        region: '#patRegion', province: '#patProvince', city: '#patCity', barangay: '#patBarangay'
    });

    IRDSS.referrals.form.configure({
        initializeReferralLocation: function (location) { referralLocationCascade.init(location); },
        formatReferralTimestamp
    });
    IRDSS.referrals.submit.configure({
        checkRecommendations: IRDSS.referrals.recommendations.check
    });
    IRDSS.referrals.recommendations.configure({
        playNotificationSound: IRDSS.referrals.notifications.playSound
    });
    IRDSS.referrals.notifications.configure({
        markSeen: IRDSS.referrals.incoming.markSeen,
        showDetail: IRDSS.referrals.incoming.showDetail
    });
    IRDSS.referrals.websocket.configure({
        pollIncomingReferrals: IRDSS.referrals.incoming.poll,
        checkRecommendations: IRDSS.referrals.recommendations.check,
        loadMyReferrals: IRDSS.referrals.list.load,
        loadAcceptedPatients: IRDSS.patients.transferred.load,
        playNotificationSound: IRDSS.referrals.notifications.playSound
    });
    IRDSS.patients.list.configure({
        openReferralForm: IRDSS.referrals.form.openForPatient
    });
    IRDSS.patients.transferred.configure({
        openReferralForm: IRDSS.referrals.form.openForPatient,
        formatReferralTimestamp,
        referralReasonsText: IRDSS.referrals.form.reasonsText,
        attachmentLinksHtml: IRDSS.referrals.form.attachmentLinksHtml
    });
    IRDSS.referrals.form.init();
    IRDSS.consent.print.init();
    IRDSS.referrals.submit.init();
    IRDSS.referrals.list.init();
    IRDSS.referrals.recommendations.init();
    IRDSS.referrals.incoming.init();
    IRDSS.referrals.notifications.init();
    IRDSS.referrals.websocket.init();
    IRDSS.patients.list.init();
    IRDSS.patients.form.init();
    IRDSS.patients.transferred.init();

    IRDSS.navigation.configure({
        loadPatients: IRDSS.patients.list.load,
        loadMyReferrals: IRDSS.referrals.list.load,
        checkRecommendations: IRDSS.referrals.recommendations.check,
        stopAlarm: IRDSS.referrals.notifications.stopAlarm,
        pollIncomingReferrals: IRDSS.referrals.incoming.poll,
        loadAcceptedPatients: IRDSS.patients.transferred.load,
        loadUsers,
        loadServiceAssessment,
        loadFacilityAnalytics,
        loadSystemLogs,
        initializePatientLocation: function () { patientLocationCascade.init(); },
        connectReferralWebSocket: IRDSS.referrals.websocket.start,
        disconnectReferralWebSocket: IRDSS.referrals.websocket.stop
    });
    IRDSS.navigation.init();

    IRDSS.auth.session.configure({
        clearReferralNotifications: IRDSS.referrals.notifications.clear
    });

    // Compatibility bridge for standalone scripts that still call these globals.
    window.switchTab = switchTab;
    window.showToast = showToast;

    IRDSS.auth.session.init();
});
