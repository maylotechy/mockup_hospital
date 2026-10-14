(function initializeIrdssClinicalTerminology(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    const API_BASE = IRDSS.config?.API_BASE || '../backend';

    async function parseResponse(response) {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const detail = payload.detail;
            const message = typeof detail === 'string'
                ? detail
                : detail?.message || payload.message || 'Terminology request failed.';
            const error = new Error(message);
            error.status = response.status;
            error.payload = payload;
            throw error;
        }
        return payload;
    }

    async function search(valueSet, query, options = {}) {
        const params = new URLSearchParams({
            action: 'search',
            value_set: valueSet,
            q: String(query || '').trim(),
            count: String(Math.max(1, Math.min(options.count || 20, 50)))
        });
        const response = await fetch(`${API_BASE}/terminology_proxy.php?${params}`, {
            credentials: 'include',
            signal: options.signal
        });
        return parseResponse(response);
    }

    async function validate(valueSet, coding, options = {}) {
        const params = new URLSearchParams({
            action: 'validate',
            value_set: valueSet
        });
        const response = await fetch(`${API_BASE}/terminology_proxy.php?${params}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system: coding?.system || '',
                code: coding?.code || ''
            }),
            signal: options.signal
        });
        return parseResponse(response);
    }

    IRDSS.terminology = Object.freeze({
        VALUE_SETS: Object.freeze({
            diagnosis: 'diagnosis',
            chiefComplaint: 'chief-complaint'
        }),
        search,
        validate
    });
})(window);
