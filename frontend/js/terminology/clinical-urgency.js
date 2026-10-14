(function (window, $) {
    'use strict';
    const IRDSS = window.IRDSS;
    let policy, pending, generation = 0;
    async function load() {
        if (policy) return policy;
        if (!pending) pending = fetch(`${IRDSS.config.API_BASE}/clinical_urgency_options.php`, {credentials: 'include'})
            .then(async response => {const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Urgency options unavailable.'); policy = data; return data;})
            .catch(error => {pending = null; throw error;});
        return pending;
    }
    function sync() {
        if (!policy) return;
        const suggested = policy.mapping[$('#modalSeverity').val()];
        const override = $('#modalPriorityOverride').is(':checked');
        $('#modalReferralPriority').prop('disabled', !override);
        if (!override) $('#modalReferralPriority').val(suggested);
        $('#priorityOverrideReasonGroup').toggleClass('hidden', !override);
        $('#modalPriorityOverrideReason').prop('required', override && $('#modalReferralPriority').val() !== suggested);
        $('#triagePolicyNote').text(`Level 5 is highest acuity. Suggested priority: ${String(suggested || '').toUpperCase()}. A doctor assigns triage.`);
    }
    async function set(data = {}) {
        const ticket = ++generation;
        try {
            const options = await load();
            if (ticket !== generation) return;
            const triageCode = String(data.triage_code || data.disease_severity || '3');
            $('#modalSeverity').empty();
            options.triage.forEach(item => $('#modalSeverity').append(new Option(`${item.code} — ${item.display}`, item.code)));
            $('#modalSeverity').val(triageCode).prop('disabled', IRDSS.state.currentUser?.role !== 'doctor');
            $('#modalConditionSeverity').empty().append(new Option('Not specified', ''));
            options.condition_severity.forEach(item => $('#modalConditionSeverity').append(new Option(item.display, item.code)));
            $('#modalConditionSeverity').val(data.condition_severity_code || '');
            const priority = data.referral_priority || options.mapping[triageCode];
            $('#modalPriorityOverride').prop('checked', priority !== options.mapping[triageCode]);
            $('#modalReferralPriority').val(priority);
            $('#modalPriorityOverrideReason').val('');
            sync();
        } catch (error) { if (ticket === generation) $('#triagePolicyNote').text('Urgency options could not load. Reopen this referral form to retry.'); }
    }
    function fields() {
        const code = String($('#modalSeverity').val() || '');
        const condition = String($('#modalConditionSeverity').val() || '');
        const priority = $('#modalPriorityOverride').is(':checked') ? $('#modalReferralPriority').val() : policy.mapping[code];
        return {triage_code: code, triage_system: policy.triage_system,
            referral_priority: priority,
            priority_override_reason: priority !== policy.mapping[code] ? String($('#modalPriorityOverrideReason').val() || '').trim() : '',
            condition_severity_code: condition, condition_severity_system: condition ? policy.condition_severity_system : ''};
    }
    function validate() {
        if (!policy || IRDSS.state.currentUser?.role !== 'doctor') {
            IRDSS.ui.showToast('error', !policy ? 'Wait for clinical urgency options to load, or reopen the form to retry.' : 'A doctor must assign triage before submitting this referral.', 4000);
            return false;
        }
        sync(); return true;
    }
    async function reassess(id) {
        const options = await load();
        const details = await $.getJSON(`${IRDSS.config.API_BASE}/get_transferred_patient_details.php`, {referral_id: id});
        const escape = IRDSS.formatters.escapeHtml;
        const optionHtml = (items, selected) => items.map(item => `<option value="${escape(item.code)}" ${String(item.code) === String(selected) ? 'selected' : ''}>${escape(item.display)}</option>`).join('');
        const triage = details.triage_code || details.disease_severity;
        const result = await window.Swal.fire({title: 'Reassess clinical urgency', showCancelButton: true,
            confirmButtonText: 'Save reassessment', showLoaderOnConfirm: true,
            allowOutsideClick: () => !window.Swal.isLoading(),
            html: `<div class="text-left space-y-3">
                <label class="ref-label" for="reassessTriage">Triage acuity (doctor assigned)</label>
                <select id="reassessTriage" class="ref-input">${optionHtml(options.triage, triage)}</select>
                <label class="ref-label" for="reassessPriority">Referral priority</label>
                <select id="reassessPriority" class="ref-input">${optionHtml(options.priorities.map(code => ({code, display: code.toUpperCase()})), details.referral_priority || options.mapping[triage])}</select>
                <label class="ref-label" for="reassessCondition">Condition severity (optional)</label>
                <select id="reassessCondition" class="ref-input"><option value="">Not specified</option>${optionHtml(options.condition_severity, details.condition_severity_code)}</select>
                <label class="ref-label" for="reassessReason">Reason for reassessment / priority override *</label>
                <textarea id="reassessReason" class="ref-input" maxlength="500" placeholder="Explain the change"></textarea>
                <p class="ref-help">Saved changes are audited. Reassessment does not automatically redirect this referral.</p></div>`,
            didOpen() { $('#reassessTriage').on('change', () => $('#reassessPriority').val(options.mapping[$('#reassessTriage').val()])); },
            async preConfirm() {
                const code = String($('#reassessTriage').val()), priority = $('#reassessPriority').val();
                const reason = String($('#reassessReason').val() || '').trim(), condition = $('#reassessCondition').val();
                if (!reason) { window.Swal.showValidationMessage('Explain the reassessment.'); return false; }
                try {
                    return await $.ajax({url: `${IRDSS.config.API_BASE}/update_referral_urgency.php`, type: 'PATCH',
                        contentType: 'application/json', dataType: 'json', data: JSON.stringify({referral_id: id,
                            triage_code: code, triage_system: options.triage_system, referral_priority: priority,
                            priority_override_reason: priority !== options.mapping[code] ? reason : '',
                            condition_severity_code: condition, condition_severity_system: condition ? options.condition_severity_system : '', reason})});
                } catch (error) { window.Swal.showValidationMessage(error.responseJSON?.message || 'Unable to save reassessment.'); return false; }
            }});
        if (result.isConfirmed) {
            IRDSS.ui.showToast('success', 'Clinical urgency reassessed and saved.', 3000);
            IRDSS.patients.transferred.load();
            IRDSS.referrals.list.load();
        }
    }
    $(document).on('change.clinicalUrgency', '#modalSeverity, #modalPriorityOverride, #modalReferralPriority', sync);
    $(document).on('click.clinicalUrgency', '.btn-reassess-urgency', async function () {
        const button = $(this), original = button.html();
        button.prop('disabled', true).text('Loading…');
        try { await reassess(String(button.data('ref-id'))); }
        catch (error) { IRDSS.ui.showToast('error', 'Could not load the reassessment form.', 4000); }
        finally { button.prop('disabled', false).html(original); }
    });
    IRDSS.urgency = Object.freeze({load, set, fields, validate});
})(window, window.jQuery);
