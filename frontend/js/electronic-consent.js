(function () {
    'use strict';

    const CONSENT_VERSION = 'referral-consent-2026-09-v1';
    const CONSENT_PARAGRAPH_ONE = 'I have been informed why a referral is recommended and had an opportunity to ask questions. I understand that IRDSS may first share a limited clinical referral summary with candidate hospitals so they can evaluate capacity. My identity, complete clinical details, and protected attachments will be made available only to the hospital selected to receive the referral, except where disclosure is otherwise required or permitted by law.';
    const CONSENT_PARAGRAPH_TWO_PREFIX = 'I authorize ';
    const CONSENT_PARAGRAPH_TWO_SUFFIX = ' and participating IRDSS facilities to collect, securely transmit, access, and use the information reasonably necessary to coordinate this referral and provide care. I understand that consent may be withdrawn before disclosure or processing where withdrawal is legally and operationally possible, without affecting processing already lawfully completed.';
    const SIGNER_LABELS = {
        PATIENT: 'Patient',
        PARENT_GUARDIAN: 'Parent or guardian',
        AUTHORIZED_REPRESENTATIVE: 'Authorized representative'
    };

    let signatureHasInk = false;
    let isDrawing = false;
    let witnessName = '';
    let witnessLicenseNumber = '';
    let witnessRole = '';
    let electronicConsentApplied = false;
    let generatedElectronicFileName = '';

    const byId = id => document.getElementById(id);
    const show = element => element?.classList.remove('hidden');
    const hide = element => element?.classList.add('hidden');

    function facilityName() {
        return String(byId('headerHospitalName')?.textContent || byId('sidebarHospitalName')?.textContent || 'Referring facility').trim();
    }

    function patientName() {
        return String(byId('modalPatientName')?.textContent || '').trim();
    }

    function safePatientName() {
        return patientName().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 150) || 'Patient';
    }

    function setMethod(method) {
        const isElectronic = method === 'ELECTRONIC';
        if (!isElectronic && electronicConsentApplied) {
            electronicConsentApplied = false;
            byId('consentSignerType').value = '';
            byId('consentSignerName').value = '';
            byId('consentRepresentativeRelationship').value = '';
            byId('consentRecordedAt').value = '';
            byId('consentDocumentSha256').value = '';
            const fileInput = byId('signedConsentForm');
            if (fileInput.files?.[0]?.name === generatedElectronicFileName) fileInput.value = '';
            generatedElectronicFileName = '';
            const status = byId('electronicConsentStatus');
            status.className = 'mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800';
            status.textContent = 'Electronic consent has not been signed.';
        }
        byId('consentMethod').value = method;
        byId('consentMethodPaperCard').className = `flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${isElectronic ? 'border-slate-200' : 'border-red-300 bg-red-50'}`;
        byId('consentMethodElectronicCard').className = `flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${isElectronic ? 'border-red-300 bg-red-50' : 'border-slate-200'}`;
        byId('consentMethodPaper').checked = !isElectronic;
        byId('consentMethodElectronic').checked = isElectronic;
        if (isElectronic) {
            hide(byId('paperConsentPanel'));
            show(byId('electronicConsentPanel'));
        } else {
            show(byId('paperConsentPanel'));
            hide(byId('electronicConsentPanel'));
        }
    }

    async function loadWitness() {
        try {
            const response = await fetch(`${window.API_BASE || '../backend'}/login.php`, { credentials: 'include' });
            const data = await response.json();
            const user = data?.user || {};
            const baseName = String(user.full_name || '').trim();
            witnessRole = String(user.role || '').trim().toLowerCase();
            witnessName = witnessRole === 'doctor' && baseName && !/^(dr\.?|doctor)\s+/i.test(baseName)
                ? `Dr. ${baseName}`
                : baseName;
            witnessLicenseNumber = String(user.license_number || '').trim();
        } catch (error) {
            witnessName = '';
            witnessLicenseNumber = '';
            witnessRole = '';
        }
        byId('electronicConsentWitness').textContent = witnessName || 'Unable to identify logged-in staff';
        byId('electronicConsentWitnessLicense').textContent = witnessLicenseNumber || 'Not recorded';
    }

    function clearSignature() {
        const canvas = byId('electronicSignatureCanvas');
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#0f172a';
        context.lineWidth = 5;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        signatureHasInk = false;
    }

    function signaturePosition(event) {
        const canvas = byId('electronicSignatureCanvas');
        const bounds = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - bounds.left) * canvas.width / bounds.width,
            y: (event.clientY - bounds.top) * canvas.height / bounds.height
        };
    }

    function bindSignaturePad() {
        const canvas = byId('electronicSignatureCanvas');
        canvas.addEventListener('pointerdown', event => {
            event.preventDefault();
            isDrawing = true;
            canvas.setPointerCapture(event.pointerId);
            const point = signaturePosition(event);
            const context = canvas.getContext('2d');
            context.beginPath();
            context.moveTo(point.x, point.y);
        });
        canvas.addEventListener('pointermove', event => {
            if (!isDrawing) return;
            event.preventDefault();
            const point = signaturePosition(event);
            const context = canvas.getContext('2d');
            context.lineTo(point.x, point.y);
            context.stroke();
            signatureHasInk = true;
        });
        const stop = () => { isDrawing = false; };
        canvas.addEventListener('pointerup', stop);
        canvas.addEventListener('pointercancel', stop);
        canvas.addEventListener('pointerleave', stop);
    }

    function updateSignerFields() {
        const type = byId('electronicSignerType').value;
        const isPatient = type === 'PATIENT';
        const nameInput = byId('electronicSignerName');
        nameInput.readOnly = isPatient;
        nameInput.classList.toggle('bg-slate-100', isPatient);
        if (isPatient) nameInput.value = patientName();
        else if (nameInput.value === patientName()) nameInput.value = '';
        if (isPatient) {
            hide(byId('electronicRelationshipField'));
            byId('electronicSignerRelationship').value = '';
        } else {
            show(byId('electronicRelationshipField'));
        }
    }

    async function openModal() {
        if (!byId('modalPatientId')?.value || !patientName() || patientName() === '--') {
            window.Swal?.fire({ icon: 'warning', title: 'Select a patient first', text: 'Choose the patient before obtaining electronic consent.' });
            return;
        }
        await loadWitness();
        byId('electronicConsentFacility').textContent = facilityName();
        byId('electronicSignerType').value = 'PATIENT';
        byId('electronicSignerName').value = patientName();
        byId('electronicSignerRelationship').value = '';
        byId('electronicConsentAcknowledged').checked = false;
        byId('electronicClinicianAttested').checked = false;
        updateSignerFields();
        clearSignature();
        show(byId('electronicConsentModal'));
        document.body.classList.add('overflow-hidden');
    }

    function closeModal() {
        hide(byId('electronicConsentModal'));
        document.body.classList.remove('overflow-hidden');
        isDrawing = false;
    }

    function wrapText(context, text, x, y, maxWidth, lineHeight) {
        const words = text.split(/\s+/);
        let line = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (context.measureText(candidate).width > maxWidth && line) {
                context.fillText(line, x, y);
                line = word;
                y += lineHeight;
            } else {
                line = candidate;
            }
        }
        if (line) context.fillText(line, x, y);
        return y + lineHeight;
    }

    function drawLabelValue(context, label, value, x, y, maxWidth = 500) {
        context.font = 'bold 14px Arial';
        context.fillStyle = '#111827';
        context.fillText(String(label).toUpperCase(), x, y);
        context.font = '16px Arial';
        context.fillStyle = '#0f172a';
        return wrapText(context, value || '--', x, y + 23, maxWidth, 21);
    }

    function drawSectionHeading(context, title, y) {
        context.font = 'bold 17px Arial';
        context.fillStyle = '#111827';
        context.fillText(title.toUpperCase(), 80, y);
        context.strokeStyle = '#94a3b8';
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(80, y + 10);
        context.lineTo(1160, y + 10);
        context.stroke();
    }

    function loadImage(url) {
        return new Promise(resolve => {
            if (!url) return resolve(null);
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = url;
        });
    }

    function drawContainedImage(context, image, x, y, width, height) {
        if (!image?.naturalWidth || !image?.naturalHeight) return;
        const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const drawnWidth = image.naturalWidth * scale;
        const drawnHeight = image.naturalHeight * scale;
        context.drawImage(image, x + (width - drawnWidth) / 2, y + (height - drawnHeight) / 2, drawnWidth, drawnHeight);
    }

    async function generateConsentCanvas(details) {
        const canvas = document.createElement('canvas');
        canvas.width = 1240;
        canvas.height = 1754;
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.save();
        context.translate(620, 900);
        context.rotate(-35 * Math.PI / 180);
        context.textAlign = 'center';
        context.font = 'bold 74px Arial';
        context.fillStyle = 'rgba(100, 116, 139, 0.09)';
        context.fillText('PROTOTYPE DRAFT', 0, 0);
        context.restore();

        context.textAlign = 'right';
        context.font = '13px Arial';
        context.fillStyle = '#475569';
        context.fillText(`Referral Consent - ${details.patientName}`, 1160, 42);

        const [irdssLogo, hospitalLogo] = await Promise.all([
            loadImage(details.irdssLogoUrl),
            loadImage(details.hospitalLogoUrl)
        ]);
        drawContainedImage(context, irdssLogo, 80, 55, 180, 75);
        drawContainedImage(context, hospitalLogo, 980, 55, 180, 75);

        context.textAlign = 'center';
        context.font = 'bold 31px "Times New Roman"';
        context.fillStyle = '#111827';
        context.fillText('Patient Referral and Data-Sharing Consent', 620, 82);
        context.font = 'bold 21px "Times New Roman"';
        context.fillText(details.referringHospital, 620, 113);
        context.textAlign = 'left';

        drawSectionHeading(context, 'Patient Information', 165);
        drawLabelValue(context, 'Patient Name', details.patientName, 80, 205);
        drawLabelValue(context, 'Date of Birth', details.dateOfBirth, 650, 205);
        drawLabelValue(context, 'Phone', details.phone, 80, 258);
        drawLabelValue(context, 'Age', details.age, 650, 258);
        drawLabelValue(context, 'Patient Location', details.patientLocation, 80, 311);
        drawLabelValue(context, 'Gender', details.gender, 650, 311);
        drawLabelValue(context, 'PhilHealth Member', details.philHealthMember, 80, 375, 220);
        drawLabelValue(context, 'Membership Type', details.philHealthType, 350, 375, 260);
        drawLabelValue(context, 'PhilHealth Number', details.philHealthNumber || 'Not available', 650, 375);
        drawLabelValue(context, 'PWD', details.pwd, 80, 428, 160);
        drawLabelValue(context, 'Pregnant', details.pregnant, 300, 428, 190);
        drawLabelValue(context, 'Has Allergy', details.hasAllergy, 570, 428, 180);
        drawLabelValue(context, 'Allergy Details', details.allergyDetails, 820, 428, 340);

        drawSectionHeading(context, 'Referral Information', 505);
        drawLabelValue(context, 'Referring Hospital', details.referringHospital, 80, 545);
        drawLabelValue(context, 'Receiving Hospital', details.receivingHospital, 650, 545);
        drawLabelValue(context, 'Chief Complaint', details.chiefComplaint, 80, 600);
        drawLabelValue(context, 'Diagnosis', details.diagnosis, 650, 600);
        drawLabelValue(context, 'Severity', details.severity, 80, 655);
        const reasons = details.reasons?.length
            ? details.reasons.map((reason, index) => `${index === 0 ? 'Primary: ' : ''}${reason}`).join('; ')
            : 'Not specified';
        drawLabelValue(context, 'Referral Reason(s)', reasons, 650, 655);

        drawSectionHeading(context, 'Vital Signs', 745);
        const vitals = [
            ['Blood Pressure', details.vitals?.bloodPressure],
            ['Heart Rate', details.vitals?.heartRate],
            ['Respiratory Rate', details.vitals?.respiratoryRate],
            ['Temperature', details.vitals?.temperature],
            ['Oxygen Saturation', details.vitals?.oxygenSaturation],
            ['Height', details.vitals?.height],
            ['Weight', details.vitals?.weight]
        ];
        vitals.forEach(([label, value], index) => {
            const column = index % 4;
            const row = Math.floor(index / 4);
            drawLabelValue(context, label, value, 80 + column * 270, 785 + row * 54, 235);
        });

        drawSectionHeading(context, 'Consent', 905);
        context.font = '15px Arial';
        context.fillStyle = '#111827';
        let y = wrapText(context, CONSENT_PARAGRAPH_ONE, 80, 945, 1080, 23);
        y += 12;
        y = wrapText(context, `${CONSENT_PARAGRAPH_TWO_PREFIX}${details.referringHospital}${CONSENT_PARAGRAPH_TWO_SUFFIX}`, 80, y, 1080, 23);

        y += 14;
        context.fillText(`[${details.signerType === 'PATIENT' ? 'X' : ' '}] Patient    [${details.signerType === 'PARENT_GUARDIAN' ? 'X' : ' '}] Parent/guardian    [${details.signerType === 'AUTHORIZED_REPRESENTATIVE' ? 'X' : ' '}] Authorized representative`, 80, y);
        drawLabelValue(context, 'Name of Signer', details.signerName, 80, y + 35, 500);
        drawLabelValue(context, 'Relationship (if applicable)', details.relationship || 'Not applicable', 650, y + 35, 500);

        const signatureY = y + 105;
        context.font = 'bold 14px Arial';
        context.fillText('ELECTRONIC SIGNATURE', 80, signatureY);
        context.strokeStyle = '#cbd5e1';
        context.strokeRect(80, signatureY + 12, 475, 150);
        context.drawImage(byId('electronicSignatureCanvas'), 90, signatureY + 20, 455, 125);
        context.textAlign = 'center';
        context.font = '15px Arial';
        context.fillStyle = '#0f172a';
        context.fillText(details.signerName, 317, signatureY + 185);
        context.font = 'bold 12px Arial';
        context.fillText(`${SIGNER_LABELS[details.signerType].toUpperCase()} - ELECTRONICALLY SIGNED`, 317, signatureY + 205);
        context.textAlign = 'left';

        drawLabelValue(context, 'Referring Clinician and Consent Witness', details.witness, 650, signatureY + 12, 500);
        drawLabelValue(context, 'License No.', details.witnessLicenseNumber || 'Not recorded', 650, signatureY + 70, 240);
        drawLabelValue(context, 'Role', details.witnessRole === 'doctor' ? 'Referring Doctor' : 'Referring Nurse', 920, signatureY + 70, 240);
        drawLabelValue(context, 'Electronically Signed At', new Date(details.recordedAt).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' }), 650, signatureY + 128, 500);

        context.font = 'bold 14px Arial';
        context.fillStyle = '#0f172a';
        wrapText(context, 'Clinician attestation: I confirm that I explained the referral, answered questions, and personally witnessed the signer provide consent.', 80, signatureY + 240, 1080, 22);

        context.font = '12px Arial';
        context.fillStyle = '#475569';
        context.fillText(`Consent text version: ${CONSENT_VERSION}`, 80, 1640);
        context.textAlign = 'right';
        context.fillText(`System generated at: ${new Date(details.recordedAt).toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })}`, 1160, 1640);
        context.textAlign = 'left';

        context.font = '10px Arial';
        context.fillStyle = '#64748b';
        wrapText(context, 'This prototype template requires review and approval by participating hospitals, their legal/privacy teams, and Data Protection Officer before production use. The SHA-256 hash of this system-generated electronic consent is stored with the referral to detect later alteration.', 80, 1680, 1080, 15);
        return canvas;
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not generate the consent document.')), 'image/jpeg', 0.92));
    }

    async function sha256(blob) {
        if (!window.crypto?.subtle) throw new Error('Secure document hashing requires HTTPS or localhost.');
        const digest = await window.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }

    async function acceptElectronicConsent() {
        const signerType = byId('electronicSignerType').value;
        const signerName = byId('electronicSignerName').value.trim();
        const relationship = byId('electronicSignerRelationship').value.trim();
        if (!SIGNER_LABELS[signerType] || !signerName) {
            window.Swal?.fire({ icon: 'warning', title: 'Signer information required', text: 'Select the signer type and enter the signer’s full name.' });
            return;
        }
        if (signerType !== 'PATIENT' && !relationship) {
            window.Swal?.fire({ icon: 'warning', title: 'Relationship required', text: 'Enter the representative’s relationship to the patient.' });
            return;
        }
        if (!signatureHasInk) {
            window.Swal?.fire({ icon: 'warning', title: 'Signature required', text: 'Ask the signer to sign inside the signature box.' });
            return;
        }
        if (!byId('electronicConsentAcknowledged').checked) {
            window.Swal?.fire({ icon: 'warning', title: 'Confirmation required', text: 'The signer must confirm that they reviewed and understood the consent.' });
            return;
        }
        if (!byId('electronicClinicianAttested').checked) {
            window.Swal?.fire({ icon: 'warning', title: 'Clinician attestation required', text: 'The logged-in clinician must confirm that they explained the referral and personally witnessed the consent.' });
            return;
        }
        if (!witnessName) {
            window.Swal?.fire({ icon: 'error', title: 'Witness unavailable', text: 'The logged-in clinical staff member could not be identified. Sign in again before recording consent.' });
            return;
        }

        const button = byId('btnAcceptElectronicConsent');
        const originalText = button.innerHTML;
        button.disabled = true;
        button.innerHTML = '<span class="inline-block animate-spin me-2">◌</span>Generating record…';
        try {
            const recordedAt = new Date().toISOString();
            const referralSnapshot = typeof window.getReferralConsentSnapshot === 'function'
                ? window.getReferralConsentSnapshot()
                : {};
            const details = {
                ...referralSnapshot,
                patientName: referralSnapshot.patientName || patientName(),
                referringHospital: referralSnapshot.referringHospital || facilityName(),
                receivingHospital: referralSnapshot.receivingHospital || 'To be determined through IRDSS',
                diagnosis: referralSnapshot.diagnosis || String(byId('modalDiagnosis')?.value || 'Not specified').trim(),
                reasons: referralSnapshot.reasons?.length
                    ? referralSnapshot.reasons
                    : [String(byId('modalReasonText')?.value || 'Not specified').trim()],
                signerType,
                signerName,
                relationship,
                witness: witnessName,
                witnessLicenseNumber,
                witnessRole,
                recordedAt
            };
            const documentCanvas = await generateConsentCanvas(details);
            const blob = await canvasToBlob(documentCanvas);
            const documentHash = await sha256(blob);
            const fileName = `consent_${safePatientName()}.jpg`;
            const file = new File([blob], fileName, { type: 'image/jpeg', lastModified: Date.now() });
            const transfer = new DataTransfer();
            transfer.items.add(file);
            const fileInput = byId('signedConsentForm');
            fileInput.dataset.skipScannerOnce = 'true';
            fileInput.files = transfer.files;
            fileInput.dispatchEvent(new Event('change', { bubbles: true }));

            byId('consentMethod').value = 'ELECTRONIC';
            byId('consentSignerType').value = signerType;
            byId('consentSignerName').value = signerName;
            byId('consentRepresentativeRelationship').value = relationship;
            byId('consentRecordedAt').value = recordedAt;
            byId('consentDocumentSha256').value = documentHash;
            generatedElectronicFileName = fileName;
            electronicConsentApplied = true;

            const status = byId('electronicConsentStatus');
            status.className = 'mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800';
            status.innerHTML = `<i class="bi bi-shield-check me-1"></i>Signed electronically by <strong>${signerName.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))}</strong>. The referring clinician and consent witness is <strong>${witnessName.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))}</strong>.`;
            closeModal();
        } catch (error) {
            window.Swal?.fire({ icon: 'error', title: 'Could not record consent', text: error.message });
        } finally {
            button.disabled = false;
            button.innerHTML = originalText;
        }
    }

    function invalidateElectronicConsent() {
        if (!electronicConsentApplied) return;
        electronicConsentApplied = false;
        byId('consentSignerType').value = '';
        byId('consentSignerName').value = '';
        byId('consentRepresentativeRelationship').value = '';
        byId('consentRecordedAt').value = '';
        byId('consentDocumentSha256').value = '';
        const input = byId('signedConsentForm');
        if (input.files?.[0]?.name === generatedElectronicFileName) input.value = '';
        const status = byId('electronicConsentStatus');
        status.className = 'mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800';
        status.textContent = 'Referral details changed. Please review and sign the electronic consent again.';
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!byId('electronicConsentModal')) return;
        clearSignature();
        bindSignaturePad();
        byId('consentMethodPaper').addEventListener('change', () => setMethod('PAPER'));
        byId('consentMethodElectronic').addEventListener('change', () => setMethod('ELECTRONIC'));
        byId('btnOpenElectronicConsent').addEventListener('click', openModal);
        byId('btnCloseElectronicConsent').addEventListener('click', closeModal);
        byId('btnCancelElectronicConsent').addEventListener('click', closeModal);
        byId('btnClearElectronicSignature').addEventListener('click', clearSignature);
        byId('electronicSignerType').addEventListener('change', updateSignerFields);
        byId('btnAcceptElectronicConsent').addEventListener('click', acceptElectronicConsent);
        byId('electronicConsentModal').addEventListener('click', event => {
            if (event.target === byId('electronicConsentModal')) closeModal();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !byId('electronicConsentModal').classList.contains('hidden')) closeModal();
        });

        const signedSnapshotFields = '#modalPatientId, #modalReasonCategory, #modalReasonSelect, #modalReasonText, .additional-reason-select, #modalDiagnosis, #modalChiefComplaint, #modalSeverity';
        document.addEventListener('change', event => {
            if (event.target.matches?.(signedSnapshotFields)) invalidateElectronicConsent();
        });
        document.addEventListener('input', event => {
            if (event.target.matches?.(signedSnapshotFields)) invalidateElectronicConsent();
        });
        byId('referralForm')?.addEventListener('reset', () => window.setTimeout(() => {
            electronicConsentApplied = false;
            generatedElectronicFileName = '';
            setMethod('ELECTRONIC');
            byId('consentSignerType').value = '';
            byId('consentSignerName').value = '';
            byId('consentRepresentativeRelationship').value = '';
            byId('consentRecordedAt').value = '';
            byId('consentDocumentSha256').value = '';
            const status = byId('electronicConsentStatus');
            status.className = 'mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800';
            status.textContent = 'Electronic consent has not been signed.';
        }, 0));
    });
})();
