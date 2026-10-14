(function initializeIrdssConsentPrint(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.consent = IRDSS.consent || {};

    const state = IRDSS.state;
    const { showToast } = IRDSS.ui;
    const { getHospitalLogoPath } = IRDSS.navigation;
    const { printableValue, printableWithUnit, calculatePrintableAge } = IRDSS.formatters;
    let initialized = false;

    function printReferralConsentForm() {
        if (!IRDSS.referrals.form.validate(false)) {
            showToast('error', 'Complete the referral details before printing the consent form.', 3500);
            return;
        }

        const printWindow = window.open('', '_blank', 'width=900,height=1000');
        if (!printWindow) {
            showToast('error', 'The print window was blocked. Allow pop-ups for this site and try again.', 4500);
            return;
        }

        const primaryReason = $('#modalReasonText').val() || $('#modalReasonSelect').val();
        const reasons = [primaryReason, ...IRDSS.referrals.form.getAdditionalReasons()].filter(Boolean);
        const severityText = $('#modalSeverity option:selected').text();
        const isDoctor = String(state.currentUser?.role || '').toLowerCase() === 'doctor';
        const clinicianBaseName = state.currentUser?.full_name || state.currentUser?.name || state.currentUser?.username || 'Clinical staff';
        const clinician = isDoctor && !/^(dr\.?|doctor)\s+/i.test(String(clinicianBaseName).trim())
            ? `Dr. ${clinicianBaseName}`
            : clinicianBaseName;
        const clinicianRole = isDoctor ? 'Referring Doctor' : 'Referring Nurse';
        const licenseNumber = state.currentUser?.license_number || 'Not recorded';
        const facility = state.currentHospital?.name || 'Referring facility';
        const patientLocation = $('#displayResolvedAddress').text();
        const dateOfBirth = $('#modalPatientDob').text();
        const patientAge = calculatePrintableAge(dateOfBirth);
        const isPhilHealthMember = String(state.currentReferralPatient?.philhealth_member || '').toLowerCase() === 'yes';
        const philHealthMembership = isPhilHealthMember ? 'Yes' : 'No';
        const philHealthType = isPhilHealthMember
            ? (state.currentReferralPatient?.philhealth_status_type || 'Not specified')
            : 'Not applicable';
        const philHealthNumber = isPhilHealthMember
            ? String(state.currentReferralPatient?.philhealth_number || '').trim()
            : '';
        const pwdStatus = $('#modalIsPwd').is(':checked') ? 'Yes' : 'No';
        const pregnancyStatus = $('#modalIsPregnant').is(':checked') ? 'Yes' : 'No';
        const hasAllergy = $('#modalHasAllergy').is(':checked');
        const allergyStatus = hasAllergy ? 'Yes' : 'No';
        const allergyDetails = hasAllergy
            ? ($('#modalAllergyDetails').val() || 'Not specified')
            : 'Not applicable';
        const bp = `${$('#modalVitalBpSystolic').val() || '--'}/${$('#modalVitalBpDiastolic').val() || '--'}`;
        const createdAt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
        const rows = reasons.map((reason, index) => `<li>${index === 0 ? '<strong>Primary:</strong> ' : ''}${printableValue(reason)}</li>`).join('');
        const hospitalLogoUrl = new URL(getHospitalLogoPath(state.currentHospital?.code), window.location.href).href;
        const irdssLogoUrl = new URL('assets/logos/IRDSS_long.png', window.location.href).href;
        const patientFileName = String($('#modalPatientName').text() || 'patient')
            .trim()
            .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '')
            .replace(/\s+/g, '_') || 'patient';

        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>consent_${printableValue(patientFileName)}</title><style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding-bottom: 20mm; font-size: 11px; line-height: 1.38; }
            h1 { font-family: "Times New Roman", Times, serif; font-size: 20px; font-weight: 700; margin: 0; text-align: center; } h2 { font-size: 11px; margin: 0 0 9px; padding-bottom: 4px; border-bottom: 1px solid #cbd5e1; text-transform: uppercase; letter-spacing: .06em; }
            .document-ref { margin: 0 0 4px; text-align: right; font-size: 9px; color: #475569; }
            .document-ref strong { color: #111827; }
            .header { display: grid; grid-template-columns: 120px 1fr 120px; align-items: center; gap: 16px; padding-bottom: 6px; }
            .logo { display: flex; align-items: center; height: 58px; } .logo:last-child { justify-content: flex-end; }
            .logo img { max-width: 112px; max-height: 56px; object-fit: contain; } .subtitle { font-family: "Times New Roman", Times, serif; font-size: 13px; font-weight: 700; text-align: center; margin-top: 3px; color: #111827; }
            .watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 0; pointer-events: none; font-family: Arial, sans-serif; font-size: 66px; font-weight: 700; letter-spacing: .12em; color: rgba(100, 116, 139, .09); transform: rotate(-35deg); white-space: nowrap; }
            body > *:not(.watermark) { position: relative; z-index: 1; }
            .section { padding: 0; margin-top: 17px; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 32px; } .stack > div { margin-bottom: 7px; }
            .field { padding: 0; min-height: 31px; }
            .label { color: #111827; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .025em; }
            .value { margin-top: 3px; font-weight: 400; } .value.strong { font-weight: 400; } ul { margin: 5px 0 0 16px; padding: 0; }
            .vitals { display: grid; grid-template-columns: repeat(4, 1fr); gap: 13px 18px; } .vital { padding: 0; min-height: 30px; }
            .choice { margin: 9px 0; } .line { display: inline-block; min-width: 205px; border-bottom: 1px solid #111827; height: 17px; vertical-align: bottom; }
            .signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 34px; margin-top: 34px; } .sig { border-top: 1px solid #111827; padding-top: 4px; text-align: center; }
            .sig-name { font-weight: 400; font-size: 12px; } .sig-role { font-size: 9px; font-weight: 700; text-transform: uppercase; margin-top: 2px; }
            .sig-license { font-size: 9px; color: #475569; margin-top: 1px; margin-bottom: 16px; }
            .consent-text { font-family: Arial, sans-serif; font-size: 10.5px; line-height: 1.55; text-align: justify; margin: 0 0 7px; }
            .footer { position: fixed; left: 0; right: 0; bottom: 0; color: #475569; font-size: 8.5px; line-height: 1.25; }
            .footer-meta { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; }
            .footer-disclaimer { max-width: 68%; font-size: 6.5px; font-weight: 400; line-height: 1.2; }
            .no-print { margin-bottom: 10px; padding: 7px 10px; background: #fef3c7; }
            @media print { .no-print { display: none; } }
        </style></head><body>
            <div class="watermark">PROTOTYPE DRAFT</div>
            <div class="no-print"><strong>Prototype draft.</strong> Review the form, then use the browser print dialog. This blank generated form is not stored automatically.</div>
            <div class="document-ref"><strong>Referral Consent</strong> - ${printableValue($('#modalPatientName').text())}</div>
            <div class="header"><div class="logo"><img src="${printableValue(irdssLogoUrl)}" alt="IRDSS logo"></div><div><h1>Patient Referral and Data-Sharing Consent</h1><div class="subtitle">${printableValue(facility)}</div></div><div class="logo"><img src="${printableValue(hospitalLogoUrl)}" alt="Hospital logo"></div></div>
            <div class="section"><h2>Patient Information</h2><div class="grid">
                <div class="field"><div class="label">Patient Name</div><div class="value strong">${printableValue($('#modalPatientName').text())}</div><div class="label" style="margin-top:7px">Phone</div><div class="value">${printableValue($('#modalPatientPhone').text())}</div></div>
                <div class="field stack"><div><span class="label">Date of Birth:</span> <span class="value strong">${printableValue(dateOfBirth)}</span></div><div><span class="label">Age:</span> <span class="value strong">${printableValue(patientAge)}${parseInt(patientAge) >= 60 ? ' (Senior Citizen)' : ''}</span></div><div><span class="label">Gender:</span> <span class="value strong">${printableValue($('#modalPatientGender').text())}</span></div></div>
            </div>
            <div class="grid" style="margin-top:13px"><div class="field"><div class="label">Patient Location</div><div class="value">${printableValue(patientLocation)}</div><div class="grid" style="grid-template-columns: repeat(2, 1fr); gap:12px; margin-top:9px"><div><div class="label">PWD</div><div class="value">${printableValue(pwdStatus)}</div></div><div>${printableValue($('#modalPatientGender').text()).trim().toLowerCase() === 'male' ? '' : `<div class="label">Pregnant</div><div class="value">${printableValue(pregnancyStatus)}</div>`}</div><div><div class="label">Has Allergy</div><div class="value">${printableValue(allergyStatus)}</div></div><div><div class="label">Allergy Details</div><div class="value">${printableValue(allergyDetails)}</div></div></div></div><div class="field"><div class="label">PhilHealth Member</div><div class="value">${printableValue(philHealthMembership)}</div><div class="label" style="margin-top:9px">Membership Type</div><div class="value">${printableValue(philHealthType)}</div>${philHealthNumber ? `<div class="label" style="margin-top:9px">PhilHealth Number</div><div class="value">${printableValue(philHealthNumber)}</div>` : ''}</div></div></div>
            <div class="section"><h2>Referral Information</h2><div class="grid"><div class="field"><div class="label">Referring Hospital</div><div class="value strong">${printableValue(facility)}</div></div><div class="field"><div class="label">Receiving Hospital</div><div class="value strong">To be determined through IRDSS</div></div><div class="field"><div class="label">Chief Complaint</div><div class="value">${printableValue($('#modalChiefComplaint').val())}</div></div><div class="field"><div class="label">Diagnosis</div><div class="value">${printableValue($('#modalDiagnosis').val() || 'Not specified')}</div></div><div class="field"><div class="label">Triage Acuity</div><div class="value strong">${printableValue(severityText)}</div></div><div class="field"><div class="label">Referral Reason(s)</div><ul>${rows}</ul></div></div></div>
            <div class="section">
                <h2>Vital Signs</h2>
                <div class="vitals">
                    <div class="vital">
                        <div class="label">Blood Pressure</div>
                        <div class="value strong">${printableWithUnit(bp, 'mmHg')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Heart Rate</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalHr').val(), 'bpm')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Respiratory Rate</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalRr').val(), 'br/min')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Temperature</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalTemp').val(), '°C')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Oxygen Saturation</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalO2sat').val(), '%')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Height</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalHeight').val(), 'cm')}</div>
                    </div>

                    <div class="vital">
                        <div class="label">Weight</div>
                        <div class="value strong">${printableWithUnit($('#modalVitalWeight').val(), 'kg')}</div>
                    </div>
                </div>
            </div>
            <div class="section"><h2>Consent</h2>
            <p class="consent-text">I have been informed why a referral is recommended and had an opportunity to ask questions. I understand that IRDSS may first share a limited clinical referral summary with candidate hospitals so they can evaluate capacity. My identity, complete clinical details, and protected attachments will be made available only to the hospital selected to receive the referral, except where disclosure is otherwise required or permitted by law.</p>
            <p class="consent-text">I authorize ${printableValue(facility)} and participating IRDSS facilities to collect, securely transmit, access, and use the information reasonably necessary to coordinate this referral and provide care. I understand that consent may be withdrawn before disclosure or processing where withdrawal is legally and operationally possible, without affecting processing already lawfully completed.</p>
            <div class="choice">[ ] Patient &nbsp;&nbsp; [ ] Parent/guardian &nbsp;&nbsp; [ ] Authorized representative</div>
            <div>Name of signer: <span class="line"></span> &nbsp; Relationship (if applicable): <span class="line" style="min-width:150px"></span></div>
            <div class="signature-grid"><div class="sig">Patient / authorized representative signature and date</div><div class="sig">Witness signature and date</div><div class="sig"><div class="sig-name">${printableValue(clinician)}</div><div class="sig-role">${printableValue(clinicianRole)}</div><div class="sig-license">License No.: ${printableValue(licenseNumber)}</div></div></div></div>
            <div class="footer"><div class="footer-meta"><span class="footer-disclaimer">This prototype template requires review and approval by participating hospitals, their legal/privacy teams, and Data Protection Officer before production use.</span><span><strong>System generated at:</strong> ${printableValue(createdAt)}</span></div></div>
        </body></html>`);
        printWindow.document.close();
        printWindow.focus();
        const printableImages = Array.from(printWindow.document.images);
        Promise.all(printableImages.map(image => image.complete
            ? Promise.resolve()
            : new Promise(resolve => { image.onload = resolve; image.onerror = resolve; })))
            .then(() => setTimeout(() => printWindow.print(), 150));
    }

    function init() {
        if (initialized) return;
        initialized = true;
        $('#btnPrintReferralConsent').on('click.consentPrint', printReferralConsentForm);
    }

    IRDSS.consent.print = Object.freeze({ init, print: printReferralConsentForm });
})(window, window.jQuery);

