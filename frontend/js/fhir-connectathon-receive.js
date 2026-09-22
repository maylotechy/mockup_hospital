// ========================================================
// HL7 FHIR Connectathon -- Receive
// Polls the sandbox for referrals sent to our own registered Organization
// (backend/fhir_poll_incoming_referrals.php), filtered server-side so we
// never pull the whole shared sandbox. Kept out of app.js, same pattern as
// the other fhir-connectathon-*.js modules -- see hackathon_tracker/TRACKER.md
// and SANDBOX_SAFETY_RULES.md.
//
// Polling only starts once the facility has a registered Organization (see
// FHIR: Organizations tab) -- nothing to filter by otherwise. Interval is a
// deliberately gentle 60s once started, since this is a shared public sandbox,
// not our own infrastructure (rule 6: no hammering it).
// ========================================================

const FhirConnectathonReceive = (function () {
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');
    const POLL_INTERVAL_MS = 60000;

    let initialized = false;
    let pollTimer = null;
    let seenServiceRequestIds = new Set();
    let firstLoad = true;
    let currentDetailServiceRequestId = null;
    let ourOrganizationRef = null;
    let onwardServiceRequestId = null;
    let onwardPreviewed = false;
    let lastPolledAt = 0;
    // Below this gap, re-opening the tab just re-renders the last poll result
    // instead of firing another GET -- the 60s background poll (startPolling())
    // already keeps that result fresh regardless of which tab is active, so a
    // quick tab-switch back and forth shouldn't double up on sandbox requests.
    // Deliberately NOT a real cache: seenServiceRequestIds/firstLoad below still
    // drive new-referral detection exactly as before, untouched by this.
    const MIN_REFETCH_GAP_MS = 10000;

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function showError(message) {
        const banner = el('fhirReceiveErrorBanner');
        banner.textContent = message;
        banner.classList.remove('hidden');
    }
    function clearError() {
        const banner = el('fhirReceiveErrorBanner');
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    function renderTable(referrals) {
        if ($.fn.DataTable.isDataTable('#fhirReceiveTable')) {
            $('#fhirReceiveTable').DataTable().destroy();
        }

        const $tableBody = $('#fhirReceiveTableBody');
        $tableBody.empty();

        if (!referrals.length) {
            $tableBody.html(`
                <tr>
                    <td colspan="6" class="text-center py-8 text-slate-400 font-normal">
                        No referrals sent to our Organization yet.
                    </td>
                </tr>
            `);
            return;
        }

        referrals.forEach((ref) => {
            const isNew = !seenServiceRequestIds.has(ref.service_request_id) && !firstLoad;
            const newBadge = isNew
                ? ' <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700">NEW</span>'
                : '';
            $tableBody.append(`
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-sm font-semibold text-slate-900 border-b border-slate-200/70">${escapeHtml(ref.patient_name || '(unknown)')}${newBadge}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.category || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.reason || '--')}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${escapeHtml(ref.status || '--')}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-500 border-b border-slate-200/70">${escapeHtml(ref.authored_on || '--')}</td>
                    <td class="py-3.5 px-6 text-xs border-b border-slate-200/70 whitespace-nowrap">
                        <div class="flex items-center gap-2">
                            <button type="button" class="btn-view-fhir-referral inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 transition-all" data-service-request-id="${escapeHtml(ref.service_request_id)}">
                                <i class="bi bi-eye"></i>
                                <span>View</span>
                            </button>
                            <button type="button" class="btn-refer-onward-fhir-referral inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 font-medium hover:bg-blue-100 transition-all" data-service-request-id="${escapeHtml(ref.service_request_id)}" aria-label="Refer ${escapeHtml(ref.patient_name || 'patient')} onward">
                                <i class="bi bi-send"></i>
                                <span>Refer Onward</span>
                            </button>
                        </div>
                    </td>
                </tr>
            `);
        });

        $('#fhirReceiveTable').DataTable({
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

    function updateBadge(count) {
        const badge = el('navFhirReceiveBadge');
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    async function poll() {
        lastPolledAt = Date.now();
        // Only on the very first load -- a background 60s re-poll already has
        // good rows on screen and shouldn't blank them out from under the user.
        if (firstLoad && window.TableSkeleton) window.TableSkeleton.renderRows('#fhirReceiveTableBody', 6);
        try {
            const res = await fetch(`${API_BASE}/fhir_poll_incoming_referrals.php`, { credentials: 'same-origin' });
            const body = await res.json();

            if (res.status === 401) {
                showError('You are not logged in. Please log in again.');
                return;
            }
            if (!body.success) {
                showError(body.message || 'Could not poll the FHIR sandbox.');
                return;
            }
            clearError();

            if (!body.registered) {
                el('fhirReceiveNotRegisteredBanner').classList.remove('hidden');
                renderTable([]);
                return;
            }
            el('fhirReceiveNotRegisteredBanner').classList.add('hidden');
            el('fhirReceiveOurOrgRef').textContent = `(${body.our_organization_ref})`;
            ourOrganizationRef = body.our_organization_ref || null;

            const referrals = body.referrals || [];
            const newOnes = firstLoad ? [] : referrals.filter((r) => !seenServiceRequestIds.has(r.service_request_id));

            renderTable(referrals);

            if (newOnes.length && window.showToast) {
                const first = newOnes[0];
                window.showToast(
                    'info',
                    newOnes.length === 1
                        ? `New referral received: ${first.patient_name || '(unknown patient)'} -- ${first.reason || 'no reason given'}.`
                        : `${newOnes.length} new referrals received on the FHIR sandbox.`,
                    5000
                );
            }

            seenServiceRequestIds = new Set(referrals.map((r) => r.service_request_id));
            updateBadge(newOnes.length);
            firstLoad = false;
        } catch (e) {
            showError('Could not reach the backend to poll incoming referrals.');
        }
    }

    function startPolling() {
        if (pollTimer) return;
        pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }

    function formatIdentifiers(identifiers) {
        if (!identifiers || !identifiers.length) return '--';
        return identifiers.map((i) => `${(i.system || '').split('/').pop()}: ${i.value}`).join(', ');
    }

    /** Best-effort display text from a FHIR CodeableConcept: .text, else first .coding[].display, else '--'. */
    function codeableConceptText(cc) {
        if (!cc) return '--';
        if (cc.text) return cc.text;
        if (cc.coding && cc.coding[0] && cc.coding[0].display) return cc.coding[0].display;
        return '--';
    }

    function codeableConceptListText(list) {
        if (!list || !list.length) return '--';
        return list.map(codeableConceptText).join(', ');
    }

    /** Renders each Condition as one compact line: diagnosis, plus its note if present. */
    function renderConditions(conditions) {
        if (!conditions || !conditions.length) return '--';
        return conditions.map((c) => {
            const note = (c.note || []).map((n) => n.text).filter(Boolean).join(' ');
            const dx = escapeHtml(codeableConceptText(c.code));
            return `<p>${dx}${note ? ` <span class="text-slate-500">-- ${escapeHtml(note)}</span>` : ''}</p>`;
        }).join('');
    }

    function renderProcedures(procedures) {
        if (!procedures || !procedures.length) return '--';
        return procedures.map((p) => {
            const text = (p.note || []).map((n) => n.text).filter(Boolean).join(' ') || codeableConceptText(p.code);
            return `<p>${escapeHtml(text)}</p>`;
        }).join('');
    }

    function renderDiagnosticReports(reports) {
        if (!reports || !reports.length) return '--';
        return reports.map((r) => {
            const label = escapeHtml(codeableConceptText(r.code));
            return `<p>${label}${r.conclusion ? ` <span class="text-slate-500">-- ${escapeHtml(r.conclusion)}</span>` : ''}</p>`;
        }).join('');
    }

    // Fixed set of standard vitals, always shown (LOINC-matched, "--" when the
    // sender didn't include one) -- so it's obvious at a glance what's actually
    // missing rather than the panel just silently having fewer tiles.
    const VITAL_DEFS = [
        { label: 'Blood Pressure', codes: ['8480-6', '8462-4'], isBp: true },
        { label: 'Heart Rate', codes: ['8867-4'] },
        { label: 'Respiratory Rate', codes: ['9279-1'] },
        { label: 'Temperature', codes: ['8310-5'] },
        { label: 'Oxygen Saturation', codes: ['2708-6'] },
        { label: 'Weight', codes: ['29463-7'] },
    ];

    /** Finds a valueQuantity by LOINC code, checking both top-level Observations and BP-style .component entries. */
    function findQuantityByLoinc(observations, code) {
        for (const obs of (observations || [])) {
            if (obs.component) {
                for (const comp of obs.component) {
                    const c = comp.code && comp.code.coding && comp.code.coding[0];
                    if (c && c.code === code && comp.valueQuantity) return comp.valueQuantity;
                }
            }
            const c = obs.code && obs.code.coding && obs.code.coding[0];
            if (c && c.code === code && obs.valueQuantity) return obs.valueQuantity;
        }
        return null;
    }

    function renderObservations(observations) {
        return VITAL_DEFS.map((def) => {
            let value = '--';
            if (def.isBp) {
                const sys = findQuantityByLoinc(observations, def.codes[0]);
                const dia = findQuantityByLoinc(observations, def.codes[1]);
                if (sys && dia) value = `${sys.value}/${dia.value} ${sys.unit || ''}`.trim();
            } else {
                const q = findQuantityByLoinc(observations, def.codes[0]);
                if (q) value = `${q.value} ${q.unit || ''}`.trim();
            }
            return `
                <div>
                    <p class="text-xs font-medium text-slate-500 mb-1">${escapeHtml(def.label)}</p>
                    <p class="text-sm font-semibold text-slate-900">${escapeHtml(value)}</p>
                </div>
            `;
        }).join('');
    }

    async function viewDetail(serviceRequestId) {
        clearError();
        currentDetailServiceRequestId = serviceRequestId;
        const panel = el('fhirReceiveDetailPanel');
        el('fhirReceiveSaveResult').classList.add('hidden');
        panel.classList.remove('hidden');
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        el('fhirReceiveDetailContent').classList.add('hidden');
        el('fhirReceiveDetailSkeleton').classList.remove('hidden');

        try {
            const res = await fetch(`${API_BASE}/fhir_get_referral_detail.php?service_request_id=${encodeURIComponent(serviceRequestId)}`, { credentials: 'same-origin' });
            const body = await res.json();
            if (!body.success) {
                showError(body.message || 'Could not load referral detail.');
                panel.classList.add('hidden');
                return;
            }

            const patient = body.patient || {};
            const name = patient.name && patient.name[0]
                ? (patient.name[0].text || `${(patient.name[0].given || []).join(' ')} ${patient.name[0].family || ''}`.trim())
                : '(unknown)';
            el('fhirReceiveDetailName').textContent = name;
            el('fhirReceiveDetailGenderDob').textContent = `${patient.gender || '--'} / ${patient.birthDate || '--'}`;
            const phone = (patient.telecom || []).find((t) => t.system === 'phone');
            el('fhirReceiveDetailPhone').textContent = phone ? phone.value : '--';
            const addr = (patient.address || [])[0];
            el('fhirReceiveDetailAddress').textContent = addr ? (addr.text || [addr.line, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')) : '--';
            el('fhirReceiveDetailIdentifiers').textContent = formatIdentifiers(patient.identifier);
            el('fhirReceiveDetailSourceOrg').textContent = body.source_organization_name || '(unknown)';

            const sr = body.service_request || {};
            el('fhirReceiveDetailCategory').textContent = codeableConceptListText(sr.category);
            el('fhirReceiveDetailPriority').textContent = sr.priority || '--';
            el('fhirReceiveDetailStatus').textContent = sr.status || '--';
            el('fhirReceiveDetailAuthoredOn').textContent = sr.authoredOn || '--';
            el('fhirReceiveDetailReason').textContent = codeableConceptListText(sr.reasonCode);
            el('fhirReceiveDetailNote').textContent = (sr.note || []).map((n) => n.text).filter(Boolean).join(' ') || '--';

            el('fhirReceiveDetailConditions').innerHTML = renderConditions(body.conditions);
            el('fhirReceiveDetailObservations').innerHTML = renderObservations(body.observations);
            el('fhirReceiveDetailProcedures').innerHTML = renderProcedures(body.procedures);
            el('fhirReceiveDetailDiagnosticReports').innerHTML = renderDiagnosticReports(body.diagnostic_reports);

            const task = body.task;
            el('fhirReceiveDetailTask').textContent = task
                ? `${task.status || '--'}${(task.note || []).map((n) => n.text).filter(Boolean).join(' ') ? ' -- ' + (task.note || []).map((n) => n.text).filter(Boolean).join(' ') : ''}`
                : 'No Task resource found.';

            el('fhirReceiveDetailJson').textContent = JSON.stringify(body, null, 2);

            el('fhirReceiveDetailSkeleton').classList.add('hidden');
            el('fhirReceiveDetailContent').classList.remove('hidden');
            return body;
        } catch (e) {
            showError('Could not reach the backend to load referral detail.');
            panel.classList.add('hidden');
            return null;
        }
    }

    function patientDisplayName(patient) {
        if (!patient || !patient.name || !patient.name[0]) return '(unknown)';
        const name = patient.name[0];
        return name.text || `${(name.given || []).join(' ')} ${name.family || ''}`.trim() || '(unknown)';
    }

    function showOnwardError(message) {
        const error = el('fhirOnwardError');
        error.textContent = message;
        error.classList.remove('hidden');
    }

    function clearOnwardError() {
        const error = el('fhirOnwardError');
        error.textContent = '';
        error.classList.add('hidden');
    }

    function invalidateOnwardPreview() {
        onwardPreviewed = false;
        el('btnConfirmFhirOnward').disabled = true;
        el('fhirOnwardPreviewPanel').classList.add('hidden');
        el('fhirOnwardResultPanel').classList.add('hidden');
    }

    function closeOnwardModal() {
        el('fhirOnwardModal').classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
        onwardServiceRequestId = null;
        invalidateOnwardPreview();
        clearOnwardError();
    }

    async function loadOnwardOrganizations(sourceOrgRef) {
        const select = el('fhirOnwardReceivingOrg');
        select.innerHTML = '<option value="">Loading hospitals...</option>';
        select.disabled = true;
        try {
            if (!window.FhirConnectathonOrgs) throw new Error('Organization list is not available.');
            const organizations = await window.FhirConnectathonOrgs.getOrganizations(false);
            const available = (organizations || [])
                .filter((org) => `Organization/${org.id}` !== ourOrganizationRef)
                .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            select.innerHTML = '<option value="">-- Select a receiving hospital --</option>';
            available.forEach((org) => {
                const option = document.createElement('option');
                option.value = `Organization/${org.id}`;
                option.textContent = `${org.name || '(unnamed organization)'} (Organization/${org.id})`;
                option.dataset.name = org.name || '';
                if (option.value === sourceOrgRef) option.textContent += ' — original sender';
                select.appendChild(option);
            });
            select.disabled = false;
        } catch (e) {
            select.innerHTML = '<option value="">Could not load hospitals</option>';
            showOnwardError(e.message || 'Could not load receiving hospitals.');
        }
    }

    async function openOnwardModal(serviceRequestId) {
        onwardServiceRequestId = serviceRequestId;
        invalidateOnwardPreview();
        clearOnwardError();
        el('fhirOnwardPatientName').textContent = 'Loading...';
        el('fhirOnwardSourceOrg').textContent = 'Loading...';
        el('fhirOnwardSourceRef').textContent = `ServiceRequest/${serviceRequestId}`;
        el('fhirOnwardModal').classList.remove('hidden');
        document.body.classList.add('overflow-hidden');

        const detail = await viewDetail(serviceRequestId);
        if (!detail || onwardServiceRequestId !== serviceRequestId) {
            if (onwardServiceRequestId === serviceRequestId) showOnwardError('Could not load the received referral data.');
            return;
        }
        el('fhirOnwardPatientName').textContent = patientDisplayName(detail.patient);
        el('fhirOnwardSourceOrg').textContent = detail.source_organization_name || '(unknown)';
        await loadOnwardOrganizations(detail.source_organization_ref || null);
    }

    function onwardPayload(dryRun) {
        const select = el('fhirOnwardReceivingOrg');
        const selected = select.options[select.selectedIndex];
        return {
            dry_run: dryRun,
            source_service_request_id: onwardServiceRequestId,
            receiving_org_ref: select.value,
            receiving_org_display_name: selected ? (selected.dataset.name || '') : '',
        };
    }

    async function callOnwardEndpoint(dryRun) {
        const res = await fetch(`${API_BASE}/fhir_forward_referral.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(onwardPayload(dryRun)),
        });
        const body = await res.json();
        return { res, body };
    }

    async function handleOnwardPreview() {
        clearOnwardError();
        if (!onwardServiceRequestId || !el('fhirOnwardReceivingOrg').value) {
            showOnwardError('Please choose a new receiving hospital.');
            return;
        }
        const btn = el('btnPreviewFhirOnward');
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Building preview...';
        try {
            const { body } = await callOnwardEndpoint(true);
            if (!body.success) {
                showOnwardError(body.message || 'Could not build the onward referral preview.');
                return;
            }
            el('fhirOnwardPreviewJson').textContent = JSON.stringify(body.bundle_sent, null, 2);
            el('fhirOnwardPreviewPanel').classList.remove('hidden');
            onwardPreviewed = true;
            el('btnConfirmFhirOnward').disabled = false;
        } catch (e) {
            showOnwardError('Could not reach the backend to build the onward referral preview.');
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    async function handleOnwardConfirm() {
        clearOnwardError();
        if (!onwardPreviewed) {
            showOnwardError('Preview the Bundle before sending it.');
            return;
        }
        const payload = onwardPayload(false);
        const confirmation = await Swal.fire({
            icon: 'warning',
            title: 'Send this onward referral?',
            html: `This will create a new referral on the public FHIR sandbox for <strong>${escapeHtml(payload.receiving_org_display_name || payload.receiving_org_ref)}</strong>. The received referral will remain unchanged.`,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-send me-1"></i> Yes, Send Referral',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' },
        });
        if (!confirmation.isConfirmed) return;

        const btn = el('btnConfirmFhirOnward');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        try {
            const { body } = await callOnwardEndpoint(false);
            const panel = el('fhirOnwardResultPanel');
            const status = el('fhirOnwardResultStatus');
            panel.classList.remove('hidden');
            panel.className = body.success
                ? 'rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3'
                : 'rounded-xl border border-red-200 bg-red-50 px-4 py-3';
            status.textContent = body.success
                ? `Onward referral sent — ${body.service_request_ref || `HTTP ${body.http_status}`}`
                : `Send failed — HTTP ${body.http_status || 'n/a'}`;
            status.className = body.success ? 'text-sm font-semibold text-emerald-700' : 'text-sm font-semibold text-red-700';
            el('fhirOnwardResultJson').textContent = JSON.stringify(body.sandbox_response || body, null, 2);
            if (window.showToast) {
                window.showToast(body.success ? 'success' : 'error', body.success ? 'Patient referred onward successfully.' : (body.message || 'The onward referral was not sent.'), 5000);
            }
            if (body.success) {
                onwardPreviewed = false;
            } else {
                btn.disabled = false;
            }
        } catch (e) {
            showOnwardError('Could not reach the backend to send the onward referral.');
            btn.disabled = false;
        } finally {
            btn.innerHTML = originalHtml;
        }
    }

    async function saveIncomingPatient(duplicateChoice, linkPatientId) {
        const payload = { service_request_id: currentDetailServiceRequestId };
        if (duplicateChoice) payload.duplicate_choice = duplicateChoice;
        if (linkPatientId) payload.link_patient_id = linkPatientId;

        const res = await fetch(`${API_BASE}/fhir_save_incoming_patient.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
        });
        return res.json();
    }

    async function handleSaveClick() {
        if (!currentDetailServiceRequestId) return;
        const btn = el('btnSaveFhirIncomingPatient');
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.textContent = 'Saving...';
        try {
            const body = await saveIncomingPatient();

            if (body.possible_duplicate) {
                const existing = body.existing_patient;
                const result = await Swal.fire({
                    icon: 'question',
                    title: 'Possible duplicate patient',
                    html: `A similar patient already exists: <strong>${existing.full_name}</strong> (DOB ${existing.dob}), registered ${existing.registered_at}.<br><br>Link this referral to that patient, or save as a brand-new record?`,
                    showDenyButton: true,
                    showCancelButton: true,
                    confirmButtonText: 'Link to Existing',
                    denyButtonText: 'Save as New',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#16a34a',
                    denyButtonColor: '#dc2626',
                    cancelButtonColor: '#64748b',
                    customClass: { popup: 'rounded-4 shadow-lg' },
                });
                if (result.isConfirmed) {
                    const linked = await saveIncomingPatient('link', existing.id);
                    showSaveResult(linked);
                } else if (result.isDenied) {
                    const created = await saveIncomingPatient('new');
                    showSaveResult(created);
                }
                return;
            }

            showSaveResult(body);
        } catch (e) {
            showSaveResult({ success: false, message: 'Could not reach the backend to save the patient.' });
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    function showSaveResult(body) {
        const resultEl = el('fhirReceiveSaveResult');
        resultEl.textContent = body.message || (body.success ? 'Saved.' : 'Could not save.');
        resultEl.className = body.success
            ? 'text-xs px-4 py-3 rounded-xl mb-4 bg-emerald-50 text-emerald-700'
            : 'text-xs px-4 py-3 rounded-xl mb-4 bg-red-50 text-red-700';
        resultEl.classList.remove('hidden');
        if (window.showToast) {
            window.showToast(body.success ? 'success' : 'error', body.message || (body.success ? 'Saved.' : 'Could not save.'), 4000);
        }
    }

    function init() {
        if (!initialized) {
            el('btnRefreshFhirReceive').addEventListener('click', () => {
                updateBadge(0);
                poll();
            });
            $(document).on('click', '.btn-view-fhir-referral', function () {
                viewDetail($(this).data('service-request-id').toString());
            });
            $(document).on('click', '.btn-refer-onward-fhir-referral', function () {
                const serviceRequestId = $(this).data('service-request-id').toString();
                document.dispatchEvent(new CustomEvent('fhir:refer-onward:selected', {
                    detail: { serviceRequestId },
                }));
                openOnwardModal(serviceRequestId);
            });
            el('btnCloseFhirReceiveDetail').addEventListener('click', () => {
                el('fhirReceiveDetailPanel').classList.add('hidden');
                currentDetailServiceRequestId = null;
            });
            el('btnSaveFhirIncomingPatient').addEventListener('click', handleSaveClick);
            el('btnCloseFhirOnward').addEventListener('click', closeOnwardModal);
            el('btnCancelFhirOnward').addEventListener('click', closeOnwardModal);
            el('btnPreviewFhirOnward').addEventListener('click', handleOnwardPreview);
            el('btnConfirmFhirOnward').addEventListener('click', handleOnwardConfirm);
            el('fhirOnwardReceivingOrg').addEventListener('change', invalidateOnwardPreview);
            initialized = true;
        }
        // Clear the "new" badge/highlight once the user actually looks at the tab.
        updateBadge(0);
        // Skip re-fetching if we just polled a moment ago (e.g. the background
        // 60s poll fired right before the user switched to this tab, or they're
        // quickly switching tabs back and forth) -- the table already reflects
        // that recent result. startPolling() below keeps it fresh either way.
        if (Date.now() - lastPolledAt > MIN_REFETCH_GAP_MS) {
            poll();
        }
        startPolling();
    }

    return { init };
})();

window.FhirConnectathonReceive = FhirConnectathonReceive;
