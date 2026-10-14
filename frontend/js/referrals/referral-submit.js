(function initializeIrdssReferralSubmit(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml, calculateAgeYears } = IRDSS.formatters;
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

    /**
     * Collects the exact field values that will be POSTed to send_referral.php.
     * The review preview reads from this same object so what the sender checks is
     * what actually gets transmitted.
     */
    function buildReferralFields() {
        // BP is entered as two separate systolic/diastolic fields but sent to the
        // backend merged as a single "120/80" string, matching how it's stored and
        // displayed everywhere else (vital_bp).
        const bpSystolic = $('#modalVitalBpSystolic').val();
        const bpDiastolic = $('#modalVitalBpDiastolic').val();
        const vitalBp = (bpSystolic && bpDiastolic) ? `${bpSystolic}/${bpDiastolic}` : '';

        const primaryReason = String($('#modalReasonText').val() || '').trim();
        const additionalReasons = IRDSS.referrals.form.getAdditionalReasons().map(label => ({
            code: IRDSS.referrals.form.reasonCode(label),
            label: label
        }));
        const consentMethod = String($('#consentMethod').val() || 'PAPER').toUpperCase();
        const fields = {
            patient_id: String($('#modalPatientId').val() || '').trim(),
            latitude: String($('#modalLatitude').val() || '').trim(),
            longitude: String($('#modalLongitude').val() || '').trim(),
            severity: String($('#modalSeverity').val() || '').trim(),
            reason_text: primaryReason,
            reason_code: IRDSS.referrals.form.reasonCode(primaryReason),
            additional_reasons: JSON.stringify(additionalReasons),
            diagnosis: String($('#modalDiagnosis').val() || '').trim(),
            ...IRDSS.diagnosis.fields(),
            ...IRDSS.symptom.fields(),
            ...IRDSS.urgency.fields(),
            ...IRDSS.vitals.fields(),
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
            is_senior_citizen: (calculateAgeYears(state.currentReferralPatient?.dob) ?? -1) >= 60 ? 1 : 0,
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
        return fields;
    }

    function previewRow(label, value) {
        const text = String(value ?? '').trim();
        return `
            <div class="min-w-0">
                <dt class="text-xs font-semibold text-slate-800">${escapeHtml(label)}</dt>
                <dd class="mt-0.5 text-sm font-normal text-slate-600 break-words">${text ? escapeHtml(text) : '<span class="text-slate-400">Not provided</span>'}</dd>
            </div>`;
    }

    function previewSection(title, bodyHtml) {
        return `
            <section class="border-t border-slate-200 py-4 first:border-t-0 first:pt-0">
                <h4 class="mb-3 text-sm font-bold text-slate-900">${escapeHtml(title)}</h4>
                ${bodyHtml}
            </section>`;
    }

    function buildReferralPreviewHtml(fields) {
        const snapshot = window.getReferralConsentSnapshot();
        const additionalReasons = JSON.parse(fields.additional_reasons || '[]').map(reason => reason.label);
        const category = $('#modalReasonCategory option:selected').text().trim();
        const grid = rows => `<dl class="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">${rows.join('')}</dl>`;
        const fullWidth = html => `<div class="col-span-2 sm:col-span-3">${html}</div>`;

        const priorityGroups = [
            fields.is_pwd ? 'PWD' : '',
            fields.is_pregnant ? 'Pregnant' : '',
            fields.is_senior_citizen ? 'Senior Citizen' : ''
        ].filter(Boolean);

        // Only list vitals that were actually entered, instead of a wall of "--"
        const vitals = [
            ['Blood Pressure', fields.vital_bp, 'mmHg'],
            ['Heart Rate', fields.vital_hr, 'bpm'],
            ['Respiratory Rate', fields.vital_rr, 'br/min'],
            ['Temperature', fields.vital_temp_c, '°C'],
            ['O₂ Saturation', fields.vital_o2sat, '%'],
            ['Height', fields.vital_height_cm, 'cm'],
            ['Weight', fields.vital_weight_kg, 'kg']
        ].filter(([, value]) => String(value || '').trim());

        const clinicalFiles = Array.from($('#referralAttachments')[0]?.files || []).map(file => file.name);
        const consentFile = $('#signedConsentForm')[0]?.files?.[0]?.name || '';
        const isElectronic = fields.consent_method === 'ELECTRONIC';

        const patientRows = [
            previewRow('Full Name', snapshot.patientName),
            previewRow('Date of Birth', snapshot.dateOfBirth),
            previewRow('Age', snapshot.age),
            previewRow('Gender', snapshot.gender)
        ];
        if (state.currentReferralPatient?.phone) patientRows.push(previewRow('Phone', snapshot.phone));

        const clinicalRows = [
            previewRow('Chief Complaint', fields.chief_complaint),
            previewRow('Coded symptom', fields.chief_complaint_code ? `${fields.chief_complaint_display} — SNOMED CT ${fields.chief_complaint_code}` : 'Text only'),
            previewRow('Diagnosis', fields.diagnosis),
            previewRow('Diagnosis coding', fields.diagnosis_code ? `${fields.diagnosis_display} — SNOMED CT ${fields.diagnosis_code}` : 'Text only'),
            previewRow('Triage Acuity', snapshot.severity),
            previewRow('Referral Priority', fields.referral_priority.toUpperCase()),
            previewRow('Condition Severity', $('#modalConditionSeverity option:selected').text()),
            previewRow('Priority Override Reason', fields.priority_override_reason || 'No override'),
            previewRow('Referral Category', category),
            fullWidth(previewRow('Referral Reason', fields.reason_text))
        ];
        if (additionalReasons.length) clinicalRows.push(fullWidth(previewRow('Additional Reasons', additionalReasons.join(', '))));
        clinicalRows.push(previewRow('Priority Group', priorityGroups.join(', ') || 'None'));
        if (fields.has_allergy) clinicalRows.push(previewRow('Allergies', fields.allergy_details || 'Not specified'));

        const consentRows = [
            previewRow('Method', isElectronic ? 'Electronic Signature' : 'Paper Consent Form'),
            previewRow('Witnessed By', fields.consent_witnessed_by)
        ];
        if (isElectronic) {
            consentRows.push(previewRow('Signed By', fields.consent_signer_name));
            if (fields.consent_representative_relationship) consentRows.push(previewRow('Relationship', fields.consent_representative_relationship));
        }
        consentRows.push(previewRow('Attached Consent', consentFile || 'None'));

        const location = `<p class="text-sm text-slate-600">${escapeHtml(snapshot.patientLocation)} <span class="font-mono text-xs text-slate-400">(${Number(fields.latitude).toFixed(6)}, ${Number(fields.longitude).toFixed(6)})</span></p>`;
        const vitalsHtml = vitals.length
            ? grid(vitals.map(([label, value, unit]) => previewRow(label, `${value} ${unit}`)))
            : '<p class="text-sm text-slate-400">No vital signs entered.</p>';
        const filesHtml = clinicalFiles.length
            ? `<ul class="space-y-1 text-sm text-slate-600">${clinicalFiles.map(name => `<li><i class="bi bi-paperclip text-slate-400 me-1"></i>${escapeHtml(name)}</li>`).join('')}</ul>`
            : '<p class="text-sm text-slate-400">No documents attached.</p>';

        return `
            <div class="text-start max-h-[65vh] overflow-y-auto pe-1">
                <p class="mb-4 text-xs text-slate-500">Check the details below. Nothing has been sent yet.</p>
                ${previewSection('Patient', grid(patientRows))}
                ${previewSection('Location', location)}
                ${previewSection('Clinical Information', grid(clinicalRows))}
                ${previewSection('Vital Signs', vitalsHtml)}
                ${previewSection('Clinical Documents', filesHtml)}
                ${previewSection('Consent', grid(consentRows))}
            </div>`;
    }

    function handleSubmit(e) {
        e.preventDefault();

        if (!IRDSS.referrals.form.validate()) {
            showToast('error', 'Please fill in all required fields highlighted in red.', 3500);
            return;
        }

        const fields = buildReferralFields();

        // IRDSS ranks receiving hospitals by distance, so never send a referral
        // without the origin coordinates resolved from the Location section.
        if (!Number.isFinite(parseFloat(fields.latitude)) || !Number.isFinite(parseFloat(fields.longitude))) {
            showToast('error', 'The referral location has not been resolved yet. Re-select the barangay and try again.', 4000);
            return;
        }

        Swal.fire({
            title: 'Review Referral',
            html: buildReferralPreviewHtml(fields),
            width: 760,
            showCancelButton: true,
            reverseButtons: true,
            focusCancel: true,
            confirmButtonText: '<i class="bi bi-send me-1"></i> Confirm & Send',
            cancelButtonText: 'Back to Edit',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' }
        }).then(result => {
            if (result.isConfirmed) transmitReferral(fields);
        });
    }

    function transmitReferral(fields) {
        const $submitBtn = $('#btnSubmitReferral');
        const originalBtnHtml = $submitBtn.html();

        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Transmitting...').prop('disabled', true);

        const formData = new FormData();
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
                        // System IDs only; readable REF-YYYYMM-NNNNN numbers are read from referral_number above.
                        const match = str.match(/ref_[a-zA-Z0-9_\-]+/);
                        if (match) refId = match[0];
                    }

                    const patientName = $('#modalPatientName').text() || 'Patient';
                    const iolResponse = typeof response.iol_response === 'object' && response.iol_response ? response.iol_response : {};
                    const referralNumber = response.referral_number || iolResponse.referral_number || null;

                    if (refId) {
                        const activeRefData = { id: refId, number: referralNumber, patientName: patientName, status: 'AWAITING' };
                        state.activeInitiatedReferralId = refId;
                        state.activeInitiatedReferralNumber = referralNumber;
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
                            ${referralNumber || refId ? `<p class="mb-3 text-sm text-slate-600">Referral number: <span class="font-mono font-semibold text-slate-900">${escapeHtml(referralNumber || refId)}</span></p>` : ''}
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
