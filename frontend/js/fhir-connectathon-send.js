// ========================================================
// HL7 FHIR Connectathon -- Send Test Referral
// Deliberately kept out of app.js -- see hackathon_tracker/TRACKER.md and
// SANDBOX_SAFETY_RULES.md. app.js only calls FhirConnectathonSend.init()
// when the "FHIR: Send Test" sidebar tab is first opened, the same pattern
// service_assessment.js uses for window.DOHAssessment.
//
// Two-step flow: "Preview Bundle" builds and displays the exact FHIR
// payload without contacting the sandbox (dry_run=true). Only "Confirm &
// Send" actually POSTs it, and only after a native confirm() dialog.
// Editing the form after a preview disables Confirm & Send until the
// bundle is previewed again, so what gets sent always matches what was
// reviewed.
// ========================================================

const FhirConnectathonSend = (function () {
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');

    let initialized = false;
    let lastPreviewedPayload = null;
    let patientsById = {};

    // In-memory cache for the "Previously Sent Referrals" table -- avoids
    // re-hitting the backend every time this tab is re-opened. Local-DB-only
    // data (fhir_get_sent_referrals.php never touches the sandbox), so a short
    // TTL is just about avoiding redundant round-trips, not stale sandbox data.
    // Manual Refresh and a just-completed send both force-bypass it.
    let sentHistoryCache = null; // { referrals, fetchedAt }
    const SENT_HISTORY_CACHE_TTL_MS = 60000;

    // "Latest call wins" guard for loadReceivingOrgs() -- the Organizations tab's
    // "Use as Receiving Organization" button (fhir-connectathon-organizations.js)
    // triggers a tab switch into this one, which independently fires its own
    // loadReceivingOrgs() via init(), then immediately calls selectReceivingOrg()
    // below to force a specific selection. Both calls are async and can resolve
    // out of order; without this guard, whichever one happens to finish LAST wins
    // regardless of which was issued last, and could silently drop the intended
    // selection. Each call captures its own sequence number and only touches the
    // DOM if it's still the most recent one issued.
    let receivingOrgsLoadSeq = 0;

    // Matches the REQUIRED_FIELD_ERROR_CLASSES convention used by the Refer
    // Patient form in app.js, for the same visual treatment.
    const REQUIRED_FIELD_ERROR_CLASSES = ['border-red-600', 'ring-2', 'ring-red-600/20', 'bg-red-50/40'];

    function el(id) {
        return document.getElementById(id);
    }

    function markFieldInvalid(field, invalid) {
        if (invalid) {
            field.classList.add(...REQUIRED_FIELD_ERROR_CLASSES);
        } else {
            field.classList.remove(...REQUIRED_FIELD_ERROR_CLASSES);
        }
        const errorEl = field.id ? el(`${field.id}Error`) : null;
        if (errorEl) errorEl.classList.toggle('hidden', !invalid);
    }

    /**
     * Highlights every empty required field in red and returns whether the
     * form is valid overall -- #fhirSendForm has no `novalidate`-defeating
     * concerns since it's plain fields, but we still want our own highlight
     * instead of (or alongside) the browser's default validation bubble.
     */
    function validateForm() {
        let isValid = true;
        let firstInvalid = null;
        el('fhirSendForm').querySelectorAll('[required]').forEach((field) => {
            const invalid = !String(field.value || '').trim();
            markFieldInvalid(field, invalid);
            if (invalid && !firstInvalid) firstInvalid = field;
        });
        if (firstInvalid) {
            isValid = false;
            firstInvalid.focus();
        }
        return isValid;
    }

    function clearFieldHighlightOnInput(ev) {
        const field = ev.target;
        if (field.hasAttribute && field.hasAttribute('required') && String(field.value || '').trim()) {
            markFieldInvalid(field, false);
        }
    }

    function formatAge(dobStr) {
        if (!dobStr) return null;
        const dob = new Date(dobStr);
        if (isNaN(dob.getTime())) return null;
        const now = new Date();

        let years = now.getFullYear() - dob.getFullYear();
        let months = now.getMonth() - dob.getMonth();
        if (now.getDate() < dob.getDate()) months--;
        if (months < 0) { years--; months += 12; }

        if (years >= 1) return `${years} y/o`;
        if (months >= 1) return `${months} mo`;

        const days = Math.max(0, Math.floor((now - dob) / (1000 * 60 * 60 * 24)));
        return `${days} day${days === 1 ? '' : 's'}`;
    }

    function renderPatientDetails(patientId) {
        const card = el('fhirPatientDetailsCard');
        const p = patientsById[patientId];
        if (!p) {
            card.classList.add('hidden');
            return;
        }

        el('fhirPatientDetailName').textContent = `${p.first_name} ${p.last_name}`;
        el('fhirPatientDetailDob').textContent = p.dob || '--';
        const age = formatAge(p.dob);
        el('fhirPatientDetailAge').textContent = age !== null ? age : '--';
        el('fhirPatientDetailGender').textContent = p.gender || '--';
        el('fhirPatientDetailCivilStatus').textContent = p.civil_status || '--';
        el('fhirPatientDetailPhone').textContent = p.phone || '--';

        if (p.philhealth_member === 'Yes') {
            el('fhirPatientDetailPhilhealth').textContent = `${p.philhealth_number || 'No number on file'} (${p.philhealth_status_type || 'Member'})`;
        } else {
            el('fhirPatientDetailPhilhealth').textContent = 'Not a member';
        }

        const addressParts = [p.barangay, p.city_municipality, p.province, p.region, p.zip_code].filter(Boolean);
        el('fhirPatientDetailAddress').textContent = addressParts.length ? addressParts.join(', ') : '--';

        el('fhirPatientDetailPhilsys').textContent = p.philsys_id || '--';

        el('fhirPatientDetailNok').textContent = p.next_of_kin_name
            ? `${p.next_of_kin_name}${p.next_of_kin_relationship ? ' (' + p.next_of_kin_relationship + ')' : ''}${p.next_of_kin_phone ? ' -- ' + p.next_of_kin_phone : ''}`
            : '--';

        card.classList.remove('hidden');
    }

    function showError(message) {
        const banner = el('fhirSendErrorBanner');
        banner.textContent = message;
        banner.classList.remove('hidden');
    }
    function clearError() {
        const banner = el('fhirSendErrorBanner');
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    function collectFormPayload() {
        const fd = new FormData(el('fhirSendForm'));
        return {
            patient_id: fd.get('patient_id'),
            practitioner_id: fd.get('practitioner_id') || '',
            chief_complaint: (fd.get('chief_complaint') || '').trim(),
            working_impression: (fd.get('working_impression') || '').trim(),
            clinical_history: (fd.get('clinical_history') || '').trim(),
            referral_category: fd.get('referral_category') || '',
            service_type: fd.get('service_type') || '',
            reason_text: (fd.get('reason_text') || '').trim(),
            vital_bp_systolic: fd.get('vital_bp_systolic') || '',
            vital_bp_diastolic: fd.get('vital_bp_diastolic') || '',
            vital_hr: fd.get('vital_hr') || '',
            vital_rr: fd.get('vital_rr') || '',
            vital_temp_c: fd.get('vital_temp_c') || '',
            vital_o2sat: fd.get('vital_o2sat') || '',
            vital_weight_kg: fd.get('vital_weight_kg') || '',
            treatment_given: (fd.get('treatment_given') || '').trim(),
            lab_results: (fd.get('lab_results') || '').trim(),
            receiving_org_ref: fd.get('receiving_org_ref') || '',
            receiving_org_display_name: el('fhirReceivingOrgSelect').selectedOptions[0]?.dataset.name || '',
        };
    }

    /**
     * @param {{ref: string, name: string}|null} pendingSelection When given, this
     *   exact Organization/{id} ref is selected after the reload (injected as an
     *   extra option first if the sandbox's org list didn't happen to include it),
     *   overriding the usual "keep whatever was already selected" behavior.
     */
    async function loadReceivingOrgs(pendingSelection = null) {
        const seq = ++receivingOrgsLoadSeq;
        const select = el('fhirReceivingOrgSelect');
        try {
            // Shares the Organizations tab's cache (fhir-connectathon-organizations.js)
            // instead of hitting fhir_list_organizations.php separately -- this is a
            // shared 200+-org sandbox list, no reason to fetch it twice per tab-switch.
            // Falls back to a direct fetch only if that module somehow isn't loaded.
            const organizations = window.FhirConnectathonOrgs
                ? await window.FhirConnectathonOrgs.getOrganizations()
                : await (async () => {
                    const res = await fetch(`${API_BASE}/fhir_list_organizations.php`, { credentials: 'same-origin' });
                    const body = await res.json();
                    return body.success ? body.organizations : [];
                })();
            if (seq !== receivingOrgsLoadSeq) return; // a newer call already took over
            const previousValue = pendingSelection ? pendingSelection.ref : select.value;
            select.innerHTML = '<option value="">-- Use placeholder receiving facility --</option>';
            organizations.forEach((org) => {
                if (!org.id) return;
                const opt = document.createElement('option');
                opt.value = `Organization/${org.id}`;
                opt.textContent = `${org.name} (${org.identifiers[0] || 'Organization/' + org.id})`;
                opt.dataset.name = org.name;
                select.appendChild(opt);
            });
            if (pendingSelection && !Array.from(select.options).some((o) => o.value === pendingSelection.ref)) {
                const opt = document.createElement('option');
                opt.value = pendingSelection.ref;
                opt.textContent = pendingSelection.name;
                opt.dataset.name = pendingSelection.name;
                select.appendChild(opt);
            }
            select.value = previousValue;
            if (pendingSelection) select.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (e) {
            // Non-fatal -- the send form still works with the placeholder receiving org.
        }
    }

    async function loadPractitioners() {
        const select = el('fhirPractitionerSelect');
        try {
            const res = await fetch(`${API_BASE}/fhir_list_practitioners.php`, { credentials: 'same-origin' });
            const body = await res.json();
            if (res.status === 401) {
                showError('You are not logged in. Please log in again.');
                return;
            }
            if (!body.success) {
                showError(body.message || 'Could not load practitioners.');
                return;
            }
            select.innerHTML = '';
            let selfId = null;
            (body.practitioners || []).forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                const roleLabel = p.role === 'doctor' ? 'Dr.' : 'Nurse';
                opt.textContent = p.full_name.startsWith('Dr') ? p.full_name : `${roleLabel} ${p.full_name}`;
                select.appendChild(opt);
                if (p.is_self) selfId = p.id;
            });
            // Defaults to yourself -- nothing changes for the common case of a
            // doctor/nurse sending their own referral, but it can be overridden
            // to submit on a colleague's behalf.
            if (selfId !== null) select.value = selfId;
        } catch (e) {
            showError('Could not reach the backend to load practitioners.');
        }
    }

    async function loadPatients() {
        const select = el('fhirPatientSelect');
        try {
            const res = await fetch(`${API_BASE}/get_patients.php`, { credentials: 'same-origin' });
            const body = await res.json();
            if (res.status === 401) {
                showError('You are not logged in. Please log in again.');
                return;
            }
            if (!body.success) {
                showError(body.message || 'Could not load patients.');
                return;
            }
            select.innerHTML = '<option value="">Select a patient...</option>';
            patientsById = {};
            body.data.forEach((p) => {
                patientsById[p.id] = p;
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = `${p.first_name} ${p.last_name} (ID ${p.id})`;
                select.appendChild(opt);
            });
        } catch (e) {
            showError('Could not reach the backend to load patients.');
        }
    }

    function invalidatePreview() {
        lastPreviewedPayload = null;
        el('fhirConfirmBtn').disabled = true;
        el('fhirPreviewPanel').classList.add('hidden');
        el('fhirResultPanel').classList.add('hidden');
    }

    async function handlePreview(ev) {
        if (ev) ev.preventDefault();
        clearError();
        if (!validateForm()) {
            return;
        }
        const payload = collectFormPayload();
        const previewBtn = el('fhirPreviewBtn');
        previewBtn.disabled = true;
        const originalLabel = previewBtn.textContent;
        previewBtn.textContent = 'Building preview...';
        try {
            const res = await fetch(`${API_BASE}/fhir_send_referral.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ ...payload, dry_run: true }),
            });
            const body = await res.json();
            if (!body.success) {
                showError(body.message || 'Could not build the preview bundle.');
                return;
            }
            el('fhirPreviewJson').textContent = JSON.stringify(body.bundle_sent, null, 2);
            el('fhirPreviewPanel').classList.remove('hidden');
            lastPreviewedPayload = JSON.stringify(payload);
            el('fhirConfirmBtn').disabled = false;
        } catch (e) {
            showError('Could not reach the backend to build the preview.');
        } finally {
            previewBtn.disabled = false;
            previewBtn.textContent = originalLabel;
        }
    }

    async function handleConfirmSend() {
        clearError();
        const payload = collectFormPayload();
        if (JSON.stringify(payload) !== lastPreviewedPayload) {
            showError('The form changed since you last previewed. Please preview again before sending.');
            invalidatePreview();
            return;
        }
        const result = await Swal.fire({
            icon: 'warning',
            title: 'Send to the FHIR sandbox?',
            text: 'This sends a real HTTP request to the public FHIRLab sandbox (cdr.pheref.fhirlab.net). Only synthetic/test data should ever be sent here.',
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-send me-1"></i> Yes, Send It',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' },
        });
        if (!result.isConfirmed) return;

        const confirmBtn = el('fhirConfirmBtn');
        confirmBtn.disabled = true;
        const originalHtml = confirmBtn.innerHTML;
        confirmBtn.textContent = 'Sending...';
        try {
            const res = await fetch(`${API_BASE}/fhir_send_referral.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ ...payload, dry_run: false }),
            });
            const body = await res.json();
            const resultPanel = el('fhirResultPanel');
            const resultStatus = el('fhirResultStatus');
            resultPanel.classList.remove('hidden');
            resultStatus.textContent = body.success
                ? `Success -- HTTP ${body.http_status}`
                : `Failed -- HTTP ${body.http_status || 'n/a'}${body.curl_error ? ' (' + body.curl_error + ')' : ''}`;
            resultStatus.className = body.success ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700';
            el('fhirResultJson').textContent = JSON.stringify(body.sandbox_response, null, 2);

            if (window.showToast) {
                window.showToast(
                    body.success ? 'success' : 'error',
                    body.success
                        ? `Referral bundle accepted by the FHIR sandbox (HTTP ${body.http_status}).`
                        : `Sandbox rejected the bundle (HTTP ${body.http_status || 'n/a'}). See the response panel below.`,
                    4000
                );
            }
            if (body.success) loadSentHistory(true);
        } catch (e) {
            showError('Could not reach the backend to send the request.');
            if (window.showToast) window.showToast('error', 'Could not reach the backend to send the request.', 4000);
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalHtml;
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function renderSentHistoryTable(referrals) {
        if ($.fn.DataTable.isDataTable('#fhirSentHistoryTable')) {
            $('#fhirSentHistoryTable').DataTable().destroy();
        }
        const $tableBody = $('#fhirSentHistoryTableBody');
        $tableBody.empty();

        if (!referrals.length) {
            $tableBody.html(`
                <tr>
                    <td colspan="6" class="text-center py-8 text-slate-400 font-normal">
                        No referrals sent yet.
                    </td>
                </tr>
            `);
            return;
        }

        referrals.forEach((ref) => {
            $tableBody.append(`
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-sm font-semibold text-slate-900 border-b border-slate-200/70">${escapeHtml(ref.patient_name)}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.receiving_org_name || 'Placeholder Receiving Facility')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.referral_category || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.service_type || '--')}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-500 border-b border-slate-200/70">${escapeHtml(ref.service_request_ref || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-500 border-b border-slate-200/70">${escapeHtml(ref.created_at)}</td>
                </tr>
            `);
        });

        $('#fhirSentHistoryTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            order: [],
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [10, 25, 50],
            language: {
                lengthMenu: 'Show _MENU_ records',
                info: 'Showing _START_ to _END_ of _TOTAL_ referrals',
                search: 'Search:',
            },
        });
    }

    async function loadSentHistory(forceRefresh = false) {
        const now = Date.now();
        if (!forceRefresh && sentHistoryCache && (now - sentHistoryCache.fetchedAt) < SENT_HISTORY_CACHE_TTL_MS) {
            renderSentHistoryTable(sentHistoryCache.referrals);
            return;
        }
        if (window.TableSkeleton) window.TableSkeleton.renderRows('#fhirSentHistoryTableBody', 6);
        try {
            const res = await fetch(`${API_BASE}/fhir_get_sent_referrals.php`, { credentials: 'same-origin' });
            const body = await res.json();
            if (!body.success) return;
            sentHistoryCache = { referrals: body.referrals || [], fetchedAt: now };
            renderSentHistoryTable(sentHistoryCache.referrals);
        } catch (e) {
            // Non-fatal -- the send form still works without the history table loading.
        }
    }

    function init() {
        if (!initialized) {
            el('fhirSendForm').addEventListener('input', invalidatePreview);
            el('fhirSendForm').addEventListener('input', clearFieldHighlightOnInput);
            el('fhirSendForm').addEventListener('change', clearFieldHighlightOnInput);
            el('fhirSendForm').addEventListener('submit', handlePreview);
            el('fhirPreviewBtn').addEventListener('click', handlePreview);
            el('fhirConfirmBtn').addEventListener('click', handleConfirmSend);
            el('fhirPatientSelect').addEventListener('change', (ev) => renderPatientDetails(ev.target.value));
            el('btnRefreshFhirSentHistory').addEventListener('click', () => loadSentHistory(true));
            initialized = true;
        }
        loadPatients();
        loadPractitioners();
        loadReceivingOrgs();
        loadSentHistory();
    }

    /**
     * Called by fhir-connectathon-organizations.js's "Use as Receiving Organization"
     * button, right after switching into this tab. Forces that exact org selected,
     * regardless of whatever the tab-switch's own concurrent loadReceivingOrgs()
     * call was about to restore (see the load-seq guard above).
     */
    function selectReceivingOrg(orgRef, displayName) {
        loadReceivingOrgs({ ref: orgRef, name: displayName });
    }

    return { init, selectReceivingOrg };
})();

window.FhirConnectathonSend = FhirConnectathonSend;
