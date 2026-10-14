(function initializeIrdssPatientList(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.patients = IRDSS.patients || {};

    const { API_BASE } = IRDSS.config;
    const { escapeHtml, formatPatientName } = IRDSS.formatters;
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function departureLabel(outcome) {
        const transferred = IRDSS.patients.transferred;
        return transferred && typeof transferred.getDepartureOutcomeLabel === 'function'
            ? transferred.getDepartureOutcomeLabel(outcome)
            : (outcome || 'Out');
    }

    function load() {
        const $tableBody = $('#patientsTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="7" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading hospital patient records...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/get_patients.php`,
            type: 'GET',
            dataType: 'json',
            success(response) {
                if (response.success && Array.isArray(response.data)) {
                    render(response.data);
                    $('#patientsLastUpdated').text(
                        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    );
                    return;
                }
                $tableBody.html(`
                    <tr><td colspan="7" class="text-center py-4 text-danger">
                        <i class="bi bi-exclamation-triangle-fill me-1"></i>
                        ${escapeHtml(response.message || 'Failed to load patients.')}
                    </td></tr>
                `);
            },
            error(xhr, status, error) {
                $tableBody.html(`
                    <tr><td colspan="7" class="text-center py-4 text-danger">
                        <i class="bi bi-wifi-off me-1"></i>
                        Error connecting to backend API (${escapeHtml(String(xhr.status))} ${escapeHtml(error)}).
                    </td></tr>
                `);
            }
        });
    }

    function render(patients) {
        if ($.fn.DataTable.isDataTable('#patientsTable')) {
            $('#patientsTable').DataTable().destroy();
        }

        const $tableBody = $('#patientsTableBody');
        $tableBody.empty();
        if (patients.length === 0) {
            $tableBody.html('<tr><td colspan="7" class="text-center py-4 text-muted">No patient records registered for this hospital.</td></tr>');
            return;
        }

        patients.forEach(function (patient) {
            let genderBadgeClass = 'bg-slate-100 text-slate-700 border border-slate-200';
            if (patient.gender === 'Female') genderBadgeClass = 'bg-pink-50 text-pink-700 border border-pink-200';
            if (patient.gender === 'Male') genderBadgeClass = 'bg-blue-50 text-blue-700 border border-blue-200';

            let statusBadge = '';
            let markOutButton = '';
            if (patient.is_transferred_in) {
                if (patient.departed_at) {
                    statusBadge = `
                        <span class="whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                            ${escapeHtml(departureLabel(patient.departure_outcome))}
                        </span>`;
                } else if (patient.already_referred_onward) {
                    statusBadge = `
                        <span class="whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1">
                            Referred Onward
                        </span>`;
                } else {
                    markOutButton = `
                        <button class="whitespace-nowrap px-3.5 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm hover:shadow-lg hover:border-slate-700/60 hover:text-slate-700 active:scale-[0.98] transition-all btn-mark-departed" data-referral-id="${escapeHtml(patient.source_referral_id)}">
                            Mark as Out
                        </button>`;
                }
            }

            $tableBody.append(`
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500 border-b border-slate-300/60">#${String(patient.id).padStart(5, '0')}</td>
                    <td class="py-3.5 px-6 font-semibold text-slate-900 border-b border-slate-300/60">${escapeHtml(formatPatientName(patient))}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(patient.dob)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${genderBadgeClass}">${escapeHtml(patient.gender)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${escapeHtml(patient.phone)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60 whitespace-nowrap">${statusBadge}</td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60 whitespace-nowrap">
                        <div class="flex items-center justify-end gap-1.5">
                            ${markOutButton}
                            <button class="patient-refer-button whitespace-nowrap px-3.5 py-1.5 text-xs rounded-lg shadow-sm active:scale-[0.98] transition-all btn-refer-patient inline-flex items-center gap-1.5" data-id="${patient.id}">
                                <i class="bi bi-send-plus"></i> Refer
                            </button>
                        </div>
                    </td>
                </tr>
            `);
        });

        $('#patientsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [5, 10, 25, 50],
            language: {
                search: '_INPUT_',
                searchPlaceholder: 'Search patient records...',
                lengthMenu: 'Show _MENU_ records',
                info: 'Showing _START_ to _END_ of _TOTAL_ patients',
                paginate: {
                    next: '<i class="bi bi-chevron-right"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>'
                }
            },
            columnDefs: [{ targets: [4, 6], orderable: false }]
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;
        $('#btnRefreshPatients').on('click.patientList', load);
        $(document).on('click.patientList', '.btn-refer-patient', function () {
            if (typeof actions.openReferralForm === 'function') {
                actions.openReferralForm($(this).data('id'), $(this));
            }
        });
    }

    IRDSS.patients.list = Object.freeze({ configure, init, load, render });
})(window, window.jQuery);
