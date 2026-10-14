(function (window, document) {
    'use strict';
    const IRDSS = window.IRDSS;
    const input = document.getElementById('modalDiagnosis');
    const list = document.getElementById('diagnosisSuggestions');
    const status = document.getElementById('diagnosisSearchStatus');
    if (!input || !list || !status) return;
    let selected = null, results = [], active = -1, timer, controller, sequence = 0;

    function close() {
        list.hidden = true;
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
        active = -1;
    }
    function cancelSearch() {
        clearTimeout(timer);
        controller?.abort();
        sequence++;
        close();
    }
    function set(data = {}) {
        cancelSearch();
        input.value = data.diagnosis_text || data.diagnosis || data.diagnosis_display || '';
        selected = data.diagnosis_code && data.diagnosis_system ? {
            system: data.diagnosis_system, code: data.diagnosis_code,
            display: data.diagnosis_display || input.value, text: input.value
        } : null;
        status.textContent = selected ? `SNOMED CT: ${selected.code} — ${selected.display}`
            : 'Select a SNOMED CT result, or keep your own wording as text only.';
    }
    function fields() {
        // Programmatic edits must not silently reuse a previously selected code.
        if (selected && input.value.trim() !== selected.text.trim()) selected = null;
        return {diagnosis_system: selected?.system || '', diagnosis_code: selected?.code || '',
            diagnosis_display: selected?.display || '', diagnosis_text: input.value.trim()};
    }
    function choose(index) {
        const result = results[index];
        if (!result) return;
        set({diagnosis_system: result.system, diagnosis_code: result.code,
            diagnosis_display: result.display, diagnosis_text: result.display});
        input.focus();
    }
    async function search(ticket, query) {
        controller = new AbortController();
        status.textContent = 'Searching diagnoses…';
        try {
            const response = await IRDSS.terminology.search('diagnosis', query.slice(0, 100),
                {count: 15, signal: controller.signal});
            if (ticket !== sequence || input.value.trim() !== query) return;
            results = response.concepts || [];
            list.replaceChildren();
            results.forEach((result, index) => {
                const option = document.createElement('div');
                option.id = `diagnosis-option-${index}`;
                option.setAttribute('role', 'option');
                option.setAttribute('aria-selected', 'false');
                option.className = 'diagnosis-option';
                option.textContent = `${result.display} — ${result.code}`;
                option.addEventListener('mousedown', event => {event.preventDefault(); choose(index);});
                list.append(option);
            });
            list.hidden = !results.length;
            input.setAttribute('aria-expanded', String(!!results.length));
            status.textContent = results.length
                ? `${results.length} matching diagnoses${response.degraded ? ' (controlled local list)' : ''}. Select one or keep text only.`
                : 'No matching diagnosis. Your wording will be saved as text only.';
        } catch (error) {
            if (error.name !== 'AbortError' && ticket === sequence)
                status.textContent = 'Search is unavailable. You can still enter a text-only diagnosis.';
        }
    }
    input.addEventListener('input', () => {
        selected = null;
        cancelSearch();
        const query = input.value.trim();
        status.textContent = 'Text-only diagnosis. Type at least two characters to search.';
        if (query.length >= 2) {
            const ticket = sequence;
            timer = setTimeout(() => search(ticket, query), 300);
        }
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {cancelSearch(); return;}
        if (list.hidden) return;
        if (event.key === 'Enter' && active >= 0) {event.preventDefault(); choose(active); return;}
        if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
        event.preventDefault();
        active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
        Array.from(list.children).forEach((option, index) => option.setAttribute('aria-selected', String(index === active)));
        input.setAttribute('aria-activedescendant', list.children[active].id);
        list.children[active].scrollIntoView({block: 'nearest'});
    });
    input.addEventListener('blur', cancelSearch);
    input.form?.addEventListener('reset', () => set());
    IRDSS.diagnosis = Object.freeze({set, fields});
})(window, document);
