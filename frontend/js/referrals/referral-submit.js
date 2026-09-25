(function initializeIrdssReferralSubmit(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml } = IRDSS.formatters;
    const { showToast, cleanErrorMessage, buildErrorNoteHtml } = IRDSS.ui;
    const { switchTab } = IRDSS.navigation;
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    function handleSubmit(e) {
        e.preventDefault();

        if (!IRDSS.referrals.form.validate()) {
            showToast('error', 'Please fill in all required fields highlighted in red.', 3500);
            return;
        }

        const $submitBtn = $('#btnSubmitReferral');
        const originalBtnHtml = $submitBtn.html();

        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Transmitting...').prop('disabled', true);

        // BP is entered as two separate systolic/diastolic fields but sent to the
        // backend merged as a single "120/80" string, matching how it's stored and
        // displayed everywhere else (vital_bp).
        const bpSystolic = $('#modalVitalBpSystolic').val();
        const bpDiastolic = $('#modalVitalBpDiastolic').val();
        const vitalBp = (bpSystolic && bpDiastolic) ? `${bpSystolic}/${bpDiastolic}` : '';

        const primaryReason = $('#modalReasonText').val() || 'Severe Pneumonia';
        const additionalReasons = IRDSS.referrals.form.getAdditionalReasons().map(label => ({
            code: IRDSS.referrals.form.reasonCode(label),
            label: label
        }));
        const formData = new FormData();
        const consentMethod = String($('#consentMethod').val() || 'PAPER').toUpperCase();
        const fields = {
            patient_id: parseInt($('#modalPatientId').val(), 10) || 1,
            latitude: parseFloat($('#modalLatitude').val()) || 7.1907,
            longitude: parseFloat($('#modalLongitude').val()) || 125.4553,
            severity: parseFloat($('#modalSeverity').val()) || 3,
            reason_text: primaryReason,
            reason_code: IRDSS.referrals.form.reasonCode(primaryReason),
            additional_reasons: JSON.stringify(additionalReasons),
            diagnosis: $('#modalDiagnosis').val() || 'Pneumonia',
            chief_complaint: $('#modalChiefComplaint').val() || '',
            vital_bp: vitalBp,
            vital_hr: $('#modalVitalHr').val() || '',
            vital_rr: $('#modalVitalRr').val() || '',
            vital_temp_c: $('#modalVitalTemp').val() || '',
            vital_o2sat: $('#modalVitalO2sat').val() || '',
            vital_height_cm: $('#modalVitalHeight').val() || '',
            vital_weight_kg: $('#modalVitalWeight').val() || '',
            is_pwd: $('#modalIsPwd').is(':checked') ? 1 : 0,
            is_pregnant: $('#modalIsPregnant').is(':checked') ? 1 : 0,
            is_senior_citizen: $('#modalIsSeniorCitizen').is(':checked') ? 1 : 0,
            has_allergy: $('#modalHasAllergy').is(':checked') ? 1 : 0,
            allergy_details: $('#modalHasAllergy').is(':checked') ? ($('#modalAllergyDetails').val() || '') : '',
            consent_status: 'GRANTED',
            consent_method: consentMethod,
            consent_text_version: 'referral-consent-2026-09-v1',
            consent_recorded_at: consentMethod === 'ELECTRONIC' ? $('#consentRecordedAt').val() : new Date().toISOString(),
            consent_witnessed_by: state.currentUser?.full_name || state.currentUser?.name || state.currentUser?.username || 'Clinical staff',
            consent_signer_type: consentMethod === 'ELECTRONIC' ? $('#consentSignerType').val() : '',
            consent_signer_name: consentMethod === 'ELECTRONIC' ? $('#consentSignerName').val() : '',
            consent_representative_relationship: consentMethod === 'ELECTRONIC' ? $('#consentRepresentativeRelationship').val() : '',
            consent_document_sha256: consentMethod === 'ELECTRONIC' ? $('#consentDocumentSha256').val() : ''
        };
        Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
        Array.from($('#referralAttachments')[0]?.files || []).forEach(file => formData.append('referral_attachments[]', file));
        const signedConsentFile = $('#signedConsentForm')[0]?.files?.[0];
        if (signedConsentFile) formData.append('signed_consent_form', signedConsentFile);

        $.ajax({
            url: `${API_BASE}/send_referral.php`,
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                if (response.success) {
                    switchTab('patients');
                    // switchTab() only handles the UI/tab-switch -- it doesn't refresh
                    // table data (unlike switchTab('referrals'), which does). Without
                    // this, a patient just re-referred onward would still show the
                    // stale pre-referral state (e.g. "Mark as Out") until a manual
                    // refresh, even though the table underneath it just changed.
                    IRDSS.patients.list.load();
                    let refId = response.referral_id || null;
                    if (!refId && response.iol_response) {
                        if (typeof response.iol_response === 'object') {
                            refId = response.iol_response.referral_id || response.iol_response.referral_tracking_id || response.iol_response.id || (response.iol_response.data && (response.iol_response.data.referral_id || response.iol_response.data.id));
                        }
                    }
                    if (!refId && response.iol_response) {
                        const str = typeof response.iol_response === 'object' ? JSON.stringify(response.iol_response) : String(response.iol_response);
                        const match = str.match(/ref_[a-zA-Z0-9_\-]+/i);
                        if (match) refId = match[0];
                    }

                    const patientName = $('#modalPatientName').text() || 'Patient';

                    if (refId) {
                        const activeRefData = { id: refId, patientName: patientName, status: 'AWAITING' };
                        state.activeInitiatedReferralId = refId;
                        try {
                            localStorage.setItem('active_initiated_referral', JSON.stringify(activeRefData));
                        } catch(e) {}
                        runAction('checkRecommendations');
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Referral Transmitted Successfully!',
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">The referral payload has been successfully compiled and transmitted to the Interoperability Layer (IOL).</p>
                            <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #dbeafe; color: #1e3a8a; border-color: #bfdbfe;">
                                <div class="flex items-start gap-2.5">
                                    <i class="bi bi-info-circle-fill text-red-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                                    <span class="text-xs font-semibold leading-relaxed">Please wait for receiving hospitals to accept your referral. Accepting facilities will appear on the "My Referrals" page.${response.attachment_warning ? '<br><span class="text-amber-700">' + escapeHtml(response.attachment_warning) + '</span>' : ''}</span>
                                </div>
                            </div>
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Got it',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                } else {
                    const status = response.http_status || 500;
                    const errorMsg = escapeHtml(cleanErrorMessage(response.message || "Referral process failed.", status));

                    Swal.fire({
                        icon: 'error',
                        title: 'Unable to submit this referral.',
                        html: `${buildErrorNoteHtml(errorMsg, status)}`,
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            },
            error: function (xhr) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                const status = xhr.status || 500;
                const errData = xhr.responseJSON || {};
                const rawMsg = errData.message || errData.detail || `HTTP ${status} Server Error`;
                const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, status));

                Swal.fire({
                    icon: 'error',
                    title: 'Unable to submit this referral.',
                    html: `${buildErrorNoteHtml(errorMsg, status)}`,
                    confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            }
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;
        $('#referralForm').on('submit.referralSubmit', handleSubmit);
    }

    IRDSS.referrals.submit = Object.freeze({ configure, init });
})(window, window.jQuery);

