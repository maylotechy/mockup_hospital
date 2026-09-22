// ========================================================
// HL7 FHIR Connectathon -- header connection status badge
// Shows whether this facility is registered on the sandbox and, if so,
// whether it's currently reachable (backend/fhir_connection_status.php).
// Kept out of app.js, same pattern as the other fhir-connectathon-*.js
// modules -- see hackathon_tracker/TRACKER.md and SANDBOX_SAFETY_RULES.md.
//
// Runs globally once the dashboard is shown (not gated behind any one tab),
// on a gentle 60s interval -- same cadence as the Receive tab's poll, since
// this is a shared public sandbox, not our own infrastructure (rule 6: no
// hammering it).
// ========================================================

const FhirConnectathonStatus = (function () {
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');
    const CHECK_INTERVAL_MS = 60000;

    let initialized = false;
    let timer = null;

    const STYLE_CLASSES = ['bg-emerald-50', 'text-emerald-700', 'bg-red-50', 'text-red-700', 'bg-slate-100', 'text-slate-400', 'animate-pulse'];
    const STYLES = {
        checking: ['bg-slate-100', 'text-slate-400', 'animate-pulse'],
        connected: ['bg-emerald-50', 'text-emerald-700'],
        unreachable: ['bg-red-50', 'text-red-700'],
        unregistered: ['bg-slate-100', 'text-slate-400'],
    };

    function render(state, label, title) {
        const badge = document.getElementById('fhirStatusBadge');
        if (!badge) return;
        badge.classList.remove(...STYLE_CLASSES);
        badge.classList.add(...(STYLES[state] || STYLES.unregistered));
        badge.classList.remove('hidden');
        badge.innerHTML = `<i class="bi bi-broadcast"></i> ${label}`;
        badge.title = title || '';
    }

    async function check() {
        try {
            const res = await fetch(`${API_BASE}/fhir_connection_status.php`, { credentials: 'same-origin' });
            if (res.status === 401) return;
            const body = await res.json();

            if (!body.success) {
                render('unreachable', 'FHIR: Error', body.message || 'Could not check the FHIR sandbox connection.');
                return;
            }
            if (!body.registered) {
                render('unregistered', 'FHIR: Not Registered', 'This facility has not registered on the FHIR Connectathon sandbox yet -- see the FHIR: Organizations tab.');
                return;
            }
            if (body.reachable) {
                render('connected', 'FHIR: Connected', `Reachable as ${body.organization_ref} on the Connectathon sandbox.`);
            } else {
                render('unreachable', 'FHIR: Unreachable', 'Registered, but the sandbox did not respond just now. It may be slow or temporarily down.');
            }
        } catch (e) {
            render('unreachable', 'FHIR: Unreachable', 'Could not reach the backend to check the FHIR sandbox connection.');
        }
    }

    function init() {
        if (initialized) return;
        initialized = true;
        render('checking', 'FHIR: Checking...', 'Checking connection to the FHIR Connectathon sandbox...');
        check();
        timer = setInterval(check, CHECK_INTERVAL_MS);
    }

    return { init };
})();

window.FhirConnectathonStatus = FhirConnectathonStatus;
