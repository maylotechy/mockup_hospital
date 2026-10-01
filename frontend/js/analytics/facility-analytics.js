(function initializeIrdssFacilityAnalytics(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.analytics = IRDSS.analytics || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { showToast } = IRDSS.ui;
    let initialized = false;

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

    function init() {
        if (initialized) return;
        initialized = true;
        $(document).on('click.facilityAnalytics', '#btnApplyAnalyticsDates', loadFacilityAnalytics);
        $(document).on('click.facilityAnalytics', '#btnClearAnalyticsDates', function () {
            $('#analyticsStartDate, #analyticsEndDate').val('');
            loadFacilityAnalytics();
        });
        $(document).on('click.facilityAnalytics', '#btnExportAnalyticsCsv', exportFacilityAnalyticsCsv);
    }

    IRDSS.analytics.facility = Object.freeze({
        init,
        load: loadFacilityAnalytics,
        exportCsv: exportFacilityAnalyticsCsv,
        renderCharts: renderAnalyticsCharts
    });
})(window, window.jQuery);
