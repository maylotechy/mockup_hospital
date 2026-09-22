// ========================================================
// HL7 FHIR Connectathon -- Organizations
// Browse Organizations already on the sandbox and register the logged-in
// staff member's own facility. Kept out of app.js, same pattern as
// fhir-connectathon-send.js -- see hackathon_tracker/TRACKER.md and
// SANDBOX_SAFETY_RULES.md.
// ========================================================

const FhirConnectathonOrgs = (function () {
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');

    let initialized = false;
    let previewed = false;
    let myFacility = null;

    // In-memory cache for the sandbox's Organization list, shared with the Send
    // tab's receiving-org dropdown (fhir-connectathon-send.js calls
    // getOrganizations() below instead of fetching fhir_list_organizations.php
    // itself) -- this is a shared public sandbox with 200+ orgs from every
    // Connectathon participant, so it's the most expensive of the three
    // DataTable loads and was previously fetched twice per tab-switch cycle
    // (once here, once from the Send tab). TTL is short precisely because it's
    // shared/public: another team registering a new org shouldn't stay hidden
    // for long. Manual Refresh and a just-completed registration both
    // force-bypass it.
    let orgsCache = null; // { organizations, fetchedAt }
    const ORGS_CACHE_TTL_MS = 60000;

    function el(id) {
        return document.getElementById(id);
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str == null ? '' : String(str);
        return div.innerHTML;
    }

    function showError(message) {
        const banner = el('fhirOrgsErrorBanner');
        banner.textContent = message;
        banner.classList.remove('hidden');
    }
    function clearError() {
        const banner = el('fhirOrgsErrorBanner');
        banner.classList.add('hidden');
        banner.textContent = '';
    }

    function invalidatePreview() {
        previewed = false;
        el('fhirOrgConfirmBtn').disabled = true;
        el('fhirOrgPreviewPanel').classList.add('hidden');
        el('fhirOrgResultPanel').classList.add('hidden');
    }

    async function loadMyFacility() {
        try {
            const res = await fetch(`${API_BASE}/fhir_register_organization.php`, { credentials: 'same-origin' });
            const body = await res.json();
            if (body.success && body.facility) {
                myFacility = body.facility;
                el('fhirOrgMyFacilityName').textContent = myFacility.name || '--';
                el('fhirOrgAddress').value = myFacility.address || '';
                el('fhirOrgPhone').value = myFacility.phone || '';
                el('fhirOrgRegisteredBadge').classList.toggle('hidden', !myFacility.fhir_organization_id);
            }
        } catch (e) {
            // Non-fatal -- registration still works, it just resolves the facility server-side.
        }
    }

    function renderOrganizationsTable(organizations) {
        if ($.fn.DataTable.isDataTable('#fhirOrgsTable')) {
            $('#fhirOrgsTable').DataTable().destroy();
        }

        const $tableBody = $('#fhirOrgsTableBody');
        $tableBody.empty();

        if (!organizations.length) {
            $tableBody.html(`
                <tr>
                    <td colspan="3" class="text-center py-8 text-slate-400 font-normal">
                        No organizations found on the sandbox.
                    </td>
                </tr>
            `);
            return;
        }

        organizations.forEach((org) => {
            const aliasBadge = (org.alias || []).length
                ? ` <span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700">${escapeHtml(org.alias.join(', '))}</span>`
                : '';
            $tableBody.append(`
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-sm font-semibold text-slate-900 border-b border-slate-200/70">${escapeHtml(org.name)}${aliasBadge}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-500 border-b border-slate-200/70">${escapeHtml(org.identifiers.join(', ') || 'No identifiers')}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-400 border-b border-slate-200/70">Organization/${escapeHtml(org.id)}</td>
                </tr>
            `);
        });

        $('#fhirOrgsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [10, 25, 50],
            language: {
                lengthMenu: 'Show _MENU_ records',
                info: 'Showing _START_ to _END_ of _TOTAL_ organizations',
                search: 'Search:',
            },
        });
    }

    /**
     * Returns the sandbox's Organization list, from cache when fresh enough.
     * Shared entry point -- fhir-connectathon-send.js's receiving-org dropdown
     * calls this too, so both views always agree on what's cached.
     * @param {boolean} forceRefresh
     * @returns {Promise<Array>}
     */
    async function getOrganizations(forceRefresh) {
        const now = Date.now();
        if (!forceRefresh && orgsCache && (now - orgsCache.fetchedAt) < ORGS_CACHE_TTL_MS) {
            return orgsCache.organizations;
        }
        const res = await fetch(`${API_BASE}/fhir_list_organizations.php`, { credentials: 'same-origin' });
        const body = await res.json();
        if (res.status === 401) {
            throw new Error('You are not logged in. Please log in again.');
        }
        if (!body.success) {
            throw new Error(body.message || 'Could not load organizations.');
        }
        orgsCache = { organizations: body.organizations, fetchedAt: now };
        return orgsCache.organizations;
    }

    async function loadOrganizations(forceRefresh) {
        if (window.TableSkeleton) window.TableSkeleton.renderRows('#fhirOrgsTableBody', 3);
        try {
            const organizations = await getOrganizations(forceRefresh);
            clearError();
            renderOrganizationsTable(organizations);
        } catch (e) {
            showError(e.message || 'Could not reach the backend to load organizations.');
            renderOrganizationsTable([]);
        }
    }

    async function handlePreview() {
        clearError();
        const btn = el('fhirOrgPreviewBtn');
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = 'Building preview...';
        try {
            const res = await fetch(`${API_BASE}/fhir_register_organization.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    dry_run: true,
                    address: el('fhirOrgAddress').value.trim(),
                    phone: el('fhirOrgPhone').value.trim(),
                }),
            });
            const body = await res.json();
            if (!body.success) {
                showError(body.message || 'Could not build the preview.');
                return;
            }
            el('fhirOrgPreviewJson').textContent = JSON.stringify(
                { resource: body.resource_sent, conditional_put_url: body.conditional_url },
                null,
                2
            );
            el('fhirOrgPreviewPanel').classList.remove('hidden');
            previewed = true;
            el('fhirOrgConfirmBtn').disabled = false;
        } catch (e) {
            showError('Could not reach the backend to build the preview.');
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    async function handleConfirm() {
        clearError();
        if (!previewed) {
            showError('Please preview first.');
            return;
        }
        const result = await Swal.fire({
            icon: 'warning',
            title: 'Register on the FHIR sandbox?',
            text: 'This sends a real HTTP request to the public FHIRLab sandbox (cdr.pheref.fhirlab.net) and registers your facility as a test Organization there.',
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-send me-1"></i> Yes, Register It',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' },
        });
        if (!result.isConfirmed) return;

        const btn = el('fhirOrgConfirmBtn');
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.textContent = 'Sending...';
        try {
            const res = await fetch(`${API_BASE}/fhir_register_organization.php`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    dry_run: false,
                    address: el('fhirOrgAddress').value.trim(),
                    phone: el('fhirOrgPhone').value.trim(),
                }),
            });
            const body = await res.json();
            const resultPanel = el('fhirOrgResultPanel');
            const resultStatus = el('fhirOrgResultStatus');
            resultPanel.classList.remove('hidden');
            resultStatus.textContent = body.success
                ? `Success -- HTTP ${body.http_status}`
                : `Failed -- HTTP ${body.http_status || 'n/a'}${body.curl_error ? ' (' + body.curl_error + ')' : ''}`;
            resultStatus.className = body.success ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700';
            el('fhirOrgResultJson').textContent = JSON.stringify(body.sandbox_response, null, 2);

            if (window.showToast) {
                window.showToast(
                    body.success ? 'success' : 'error',
                    body.success
                        ? `Facility registered on the FHIR sandbox (HTTP ${body.http_status}).`
                        : `Sandbox rejected the registration (HTTP ${body.http_status || 'n/a'}). See the response panel below.`,
                    4000
                );
            }

            if (body.success) {
                if (myFacility) myFacility.fhir_organization_id = body.cached_organization_ref;
                el('fhirOrgRegisteredBadge').classList.toggle('hidden', !body.cached_organization_ref);
                // Awaited deliberately: loadReceivingOrgs() below reads the shared cache
                // synchronously-fresh, not whatever stale copy was there before this
                // registration -- without the await, both would race the same in-flight
                // fetch and the dropdown could still get the pre-registration list.
                await loadOrganizations(true);
                // Refresh the Send tab's receiving-org dropdown too, if it's been opened this session.
                // Safe to leave un-forced -- the cache the line above just wrote is fresh, so this reads it, not the sandbox again.
                if (window.FhirConnectathonSend) window.FhirConnectathonSend.init();
            }
        } catch (e) {
            showError('Could not reach the backend to send the request.');
            if (window.showToast) window.showToast('error', 'Could not reach the backend to send the request.', 4000);
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    /**
     * Renders the NHFR search result: nothing found, or a small card per match
     * with a "Use as Receiving Organization" hand-off into the Send Test tab.
     * Expected to be 0-or-1 results in practice (identifier search), but
     * doesn't assume it -- shows every match the sandbox returns.
     */
    function renderNhfrSearchResult(organizations, nhfrCode) {
        const container = el('fhirNhfrSearchResult');
        if (!organizations.length) {
            container.innerHTML = `<p class="text-sm text-slate-500">No Organization found on the sandbox with NHFR code <strong>${escapeHtml(nhfrCode)}</strong>.</p>`;
            container.classList.remove('hidden');
            return;
        }
        container.innerHTML = organizations.map((org) => `
            <div class="flex items-center justify-between gap-4 bg-slate-50 rounded-xl border border-slate-200/80 px-5 py-4">
                <div class="min-w-0">
                    <p class="text-sm font-bold text-slate-900 truncate">${escapeHtml(org.name)}</p>
                    <p class="text-xs text-slate-500 truncate">${escapeHtml(org.identifiers.join(', ') || 'Organization/' + org.id)}</p>
                </div>
                <button type="button" class="btn-use-as-receiving-org whitespace-nowrap px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors flex-shrink-0" data-org-id="${escapeHtml(org.id)}" data-org-name="${escapeHtml(org.name)}">
                    Use as Receiving Organization
                </button>
            </div>
        `).join('');
        container.classList.remove('hidden');
    }

    async function handleNhfrSearch() {
        const input = el('fhirNhfrSearchInput');
        const code = input.value.trim();
        const container = el('fhirNhfrSearchResult');
        if (!code) {
            container.innerHTML = `<p class="text-sm text-red-600">Enter an NHFR code to search for.</p>`;
            container.classList.remove('hidden');
            return;
        }
        const btn = el('fhirNhfrSearchBtn');
        btn.disabled = true;
        const originalLabel = btn.textContent;
        btn.textContent = 'Searching...';
        try {
            const res = await fetch(`${API_BASE}/fhir_search_organization_by_nhfr.php?code=${encodeURIComponent(code)}`, { credentials: 'same-origin' });
            const body = await res.json();
            if (!body.success) {
                container.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(body.message || 'Could not search the sandbox.')}</p>`;
                container.classList.remove('hidden');
                return;
            }
            renderNhfrSearchResult(body.organizations || [], body.nhfr_code || code);
        } catch (e) {
            container.innerHTML = `<p class="text-sm text-red-600">Could not reach the backend to search the sandbox.</p>`;
            container.classList.remove('hidden');
        } finally {
            btn.disabled = false;
            btn.textContent = originalLabel;
        }
    }

    /** Switches into the Send Test tab and hands off the chosen Organization as its receiving-org selection. */
    function useAsReceivingOrg(orgId, orgName) {
        $('#navTabFhirSend').trigger('click');
        if (window.FhirConnectathonSend) {
            window.FhirConnectathonSend.selectReceivingOrg(`Organization/${orgId}`, orgName);
        }
    }

    function init() {
        if (!initialized) {
            el('fhirOrgPreviewBtn').addEventListener('click', handlePreview);
            el('fhirOrgConfirmBtn').addEventListener('click', handleConfirm);
            el('btnRefreshFhirOrgs').addEventListener('click', () => loadOrganizations(true));
            el('fhirOrgAddress').addEventListener('input', invalidatePreview);
            el('fhirOrgPhone').addEventListener('input', invalidatePreview);
            el('fhirNhfrSearchBtn').addEventListener('click', handleNhfrSearch);
            el('fhirNhfrSearchInput').addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); handleNhfrSearch(); }
            });
            $(document).on('click', '.btn-use-as-receiving-org', function () {
                useAsReceivingOrg($(this).data('org-id').toString(), $(this).data('org-name').toString());
            });
            initialized = true;
        }
        invalidatePreview();
        loadMyFacility().then(() => loadOrganizations());
    }

    return { init, getOrganizations };
})();

window.FhirConnectathonOrgs = FhirConnectathonOrgs;
