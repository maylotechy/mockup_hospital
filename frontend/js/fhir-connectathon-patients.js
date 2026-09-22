// ========================================================
// HL7 FHIR Connectathon -- Patients
// Browse Patients already on the sandbox, or look one up by id. Kept out of
// app.js, same pattern as the other fhir-connectathon-*.js modules -- see
// hackathon_tracker/TRACKER.md and SANDBOX_SAFETY_RULES.md.
//
// Read-only and purely informational -- see the tab's own banner in
// index.html for why this does NOT prevent duplicates (our own sends already
// dedupe via our own identifier; a different team's same-named patient is
// still a separate record on a shared sandbox).
// ========================================================

const FhirConnectathonPatients = (function () {
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');

    let initialized = false;

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function showError(message) {
        const banner = el('fhirPatientsErrorBanner');
        banner.textContent = message;
        banner.classList.remove('hidden');
    }
    function clearError() {
        const banner = el('fhirPatientsErrorBanner');
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    function renderPatientsTable(patients) {
        if ($.fn.DataTable.isDataTable('#fhirPatientsTable')) {
            $('#fhirPatientsTable').DataTable().destroy();
        }

        const $tableBody = $('#fhirPatientsTableBody');
        $tableBody.empty();

        if (!patients.length) {
            $tableBody.html(`
                <tr>
                    <td colspan="5" class="text-center py-8 text-slate-400 font-normal">
                        No patients found on the sandbox.
                    </td>
                </tr>
            `);
            return;
        }

        patients.forEach((p) => {
            $tableBody.append(`
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-sm font-semibold text-slate-900 border-b border-slate-200/70">${escapeHtml(p.name)}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(p.dob || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(p.gender || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-500 border-b border-slate-200/70">${escapeHtml(p.identifiers.join(', ') || 'No identifiers')}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-400 border-b border-slate-200/70">Patient/${escapeHtml(p.id)}</td>
                </tr>
            `);
        });

        $('#fhirPatientsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [10, 25, 50],
            language: {
                lengthMenu: 'Show _MENU_ records',
                info: 'Showing _START_ to _END_ of _TOTAL_ patients',
                search: 'Search:',
            },
        });
    }

    async function loadPatients(forceRefresh) {
        if (window.TableSkeleton) window.TableSkeleton.renderRows('#fhirPatientsTableBody', 5);
        try {
            const res = await fetch(`${API_BASE}/fhir_search_patients.php`, { credentials: 'same-origin' });
            const body = await res.json();
            if (res.status === 401) {
                showError('You are not logged in. Please log in again.');
                return;
            }
            if (!body.success) {
                showError(body.message || 'Could not load patients from the sandbox.');
                renderPatientsTable([]);
                return;
            }
            clearError();
            renderPatientsTable(body.patients || []);
        } catch (e) {
            showError('Could not reach the backend to load patients.');
            renderPatientsTable([]);
        }
    }

    function renderLookupResult(patient) {
        const container = el('fhirPatientLookupResult');
        container.innerHTML = `
            <div class="bg-slate-50 rounded-xl border border-slate-200/80 p-5">
                <p class="text-sm font-bold text-slate-900">${escapeHtml(patient.name)}</p>
                <p class="text-xs text-slate-500 mt-1">DOB ${escapeHtml(patient.dob || '--')} -- ${escapeHtml(patient.gender || '--')}</p>
                <p class="text-xs text-slate-500 mt-1">${escapeHtml(patient.identifiers.join(', ') || 'No identifiers')}</p>
                <p class="text-xs font-mono text-slate-400 mt-1">Patient/${escapeHtml(patient.id)}</p>
            </div>
        `;
        container.classList.remove('hidden');
    }

    async function handleLookup() {
        const input = el('fhirPatientLookupInput');
        const id = input.value.trim();
        const container = el('fhirPatientLookupResult');
        if (!id) {
            container.innerHTML = `<p class="text-sm text-red-600">Enter a Patient id to look up.</p>`;
            container.classList.remove('hidden');
            return;
        }
        const btn = el('fhirPatientLookupBtn');
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = 'Looking up...';
        try {
            const res = await fetch(`${API_BASE}/fhir_get_patient.php?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
            const body = await res.json();
            if (!body.success) {
                container.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(body.message || 'Could not look up that patient.')}</p>`;
                container.classList.remove('hidden');
                return;
            }
            renderLookupResult(body.patient);
        } catch (e) {
            container.innerHTML = `<p class="text-sm text-red-600">Could not reach the backend to look up that patient.</p>`;
            container.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    }

    function init() {
        if (!initialized) {
            el('btnRefreshFhirPatients').addEventListener('click', () => loadPatients(true));
            el('fhirPatientLookupBtn').addEventListener('click', handleLookup);
            el('fhirPatientLookupInput').addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); handleLookup(); }
            });
            initialized = true;
        }
        loadPatients();
    }

    return { init };
})();

window.FhirConnectathonPatients = FhirConnectathonPatients;
