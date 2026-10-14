(function initializeIrdssAuditLogs(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.admin = IRDSS.admin || {};

    const { API_BASE } = IRDSS.config;
    const { escapeHtml } = IRDSS.formatters;
    const formatReferralTimestamp = IRDSS.referrals.list.formatTimestamp;
    let initialized = false;

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

    function init() {
        if (initialized) return;
        initialized = true;
        $(document).on('click.auditLogs', '#btnRefreshLogs', loadSystemLogs);
    }

    IRDSS.admin.auditLogs = Object.freeze({
        init,
        load: loadSystemLogs,
        render: renderLogsTable
    });
})(window, window.jQuery);
