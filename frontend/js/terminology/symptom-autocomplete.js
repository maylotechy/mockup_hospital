(function (window, document) {
    'use strict';
    const IRDSS = window.IRDSS;
    const input = document.getElementById('modalComplaintFinding');
    const list = document.getElementById('symptomSuggestions');
    const status = document.getElementById('symptomSearchStatus');
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
        input.value = data.chief_complaint_display || '';
        selected = data.chief_complaint_code && data.chief_complaint_system ? {
            system: data.chief_complaint_system, code: data.chief_complaint_code,
            display: data.chief_complaint_display || input.value, text: input.value
        } : null;
        status.textContent = selected ? `SNOMED CT: ${selected.code} — ${selected.display}`
            : 'Optional: select a symptom. Your chief complaint narrative stays unchanged.';
    }
    function fields() {
        // Programmatic edits must not silently reuse a previously selected code.
        if (selected && input.value.trim() !== selected.text.trim()) selected = null;
        return {chief_complaint_system: selected?.system || '', chief_complaint_code: selected?.code || '',
            chief_complaint_display: selected?.display || '', chief_complaint_text: document.getElementById('modalChiefComplaint').value.trim()};
    }
    function choose(index) {
        const result = results[index];
        if (!result) return;
        set({chief_complaint_system: result.system, chief_complaint_code: result.code,
            chief_complaint_display: result.display, chief_complaint_text: result.display});
        input.focus();
    }
    async function search(ticket, query) {
        controller = new AbortController();
        status.textContent = 'Searching symptoms…';
        try {
            const response = await IRDSS.terminology.search('chief-complaint', query.slice(0, 100),
                {count: 15, signal: controller.signal});
            if (ticket !== sequence || input.value.trim() !== query) return;
            results = response.concepts || [];
            list.replaceChildren();
            results.forEach((result, index) => {
                const option = document.createElement('div');
                option.id = `symptom-option-${index}`;
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
                ? `${results.length} matching symptoms${response.degraded ? ' (controlled local list)' : ''}. Select one or keep text only.`
                : 'No matching symptom. Your wording will be saved as text only.';
        } catch (error) {
            if (error.name !== 'AbortError' && ticket === sequence)
                status.textContent = 'Search is unavailable. Keep the chief complaint narrative without a symptom code.';
        }
    }
    input.addEventListener('input', () => {
        selected = null;
        cancelSearch();
        const query = input.value.trim();
        status.textContent = 'No symptom code selected. Type at least two characters to search.';
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
    IRDSS.symptom = Object.freeze({set, fields});
})(window, document);
