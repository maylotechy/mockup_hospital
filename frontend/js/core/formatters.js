(function initializeIrdssFormatters(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatPatientName(patient) {
        return [patient.first_name, patient.middle_name, patient.last_name, patient.suffix]
            .map(part => String(part || '').trim())
            .filter(Boolean)
            .join(' ');
    }

    function formatDateTime12h(dtString) {
        if (!dtString) return '';
        const date = new Date(String(dtString).replace(' ', 'T'));
        if (Number.isNaN(date.getTime())) return dtString;
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }

    function formatAgeDisplay(age, ageMonths, ageDays, withSuffix) {
        const hasAge = typeof age === 'number';
        const hasMonths = ageMonths !== null && ageMonths !== undefined;
        const hasDays = ageDays !== null && ageDays !== undefined;

        if (hasAge && age < 1 && hasMonths && ageMonths < 1 && hasDays) {
            return `${ageDays} day${ageDays === 1 ? '' : 's'}${withSuffix ? ' old' : ''}`;
        }
        if (hasAge && age < 1 && hasMonths) {
            return `${ageMonths} month${ageMonths === 1 ? '' : 's'}${withSuffix ? ' old' : ''}`;
        }
        if (hasAge) {
            return withSuffix ? `${age} years old` : String(age);
        }
        return '—';
    }

    function printableValue(value) {
        const text = String(value || '').trim();
        return escapeHtml(text || '--');
    }

    function printableWithUnit(value, unit) {
        const text = printableValue(value);
        return (text === '--' || text === '--/--') ? text : `${text} ${unit}`;
    }

    function calculatePrintableAge(dateOfBirth) {
        const match = String(dateOfBirth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return '--';

        const birthDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (birthDate.getFullYear() !== Number(match[1])
            || birthDate.getMonth() !== Number(match[2]) - 1
            || birthDate.getDate() !== Number(match[3])) return '--';

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (birthDate > today) return '--';

        const years = calculateAgeYears(dateOfBirth, today);
        if (years === null) return '--';
        if (years >= 1) return `${years} year${years === 1 ? '' : 's'} old`;

        let months = (today.getFullYear() - birthDate.getFullYear()) * 12
            + today.getMonth() - birthDate.getMonth();
        if (today.getDate() < birthDate.getDate()) months -= 1;
        if (months >= 1) return `${months} month${months === 1 ? '' : 's'} old`;

        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        const days = Math.floor((today.getTime() - birthDate.getTime()) / millisecondsPerDay);
        return `${days} day${days === 1 ? '' : 's'} old`;
    }

    function calculateAgeYears(dateOfBirth, referenceDate = new Date()) {
        const match = String(dateOfBirth || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const birthDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (birthDate.getFullYear() !== Number(match[1])
            || birthDate.getMonth() !== Number(match[2]) - 1
            || birthDate.getDate() !== Number(match[3])) return null;

        const today = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
        if (birthDate > today) return null;

        let years = today.getFullYear() - birthDate.getFullYear();
        const birthdayPassed = today.getMonth() > birthDate.getMonth()
            || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!birthdayPassed) years -= 1;
        return Math.max(0, years);
    }

    function consentRecordedText(consentStatus, consentMethod) {
        if (String(consentStatus || '').toUpperCase() !== 'GRANTED') return 'Not recorded';
        const method = String(consentMethod || '').toUpperCase();
        if (method === 'ELECTRONIC') return 'Electronic consent recorded';
        if (method === 'PAPER') return 'Paper consent recorded';
        return 'Consent recorded';
    }

    // Staff-facing referral number (REF-YYYYMM-NNNNN). Referrals created before IRDSS
    // issued readable numbers only have the random system referral_id, so fall back to it.
    function displayReferralNumber(referral) {
        return String((referral && (referral.referral_number || referral.referral_id)) || '');
    }

    function displayPatientId(patient) {
        if (patient && patient.local_patient_id) return '#' + String(patient.local_patient_id).padStart(5, '0');
        const value = String((patient && (patient.patient_display_id || patient.patient_id
            || (patient.subject && patient.subject.reference))) || '');
        if (!value || /^(?:Patient\/)?tx_/i.test(value)) return 'Not registered yet';
        return value;
    }

    IRDSS.formatters = Object.freeze({
        displayPatientId,
        escapeHtml,
        formatPatientName,
        formatDateTime12h,
        formatAgeDisplay,
        printableValue,
        printableWithUnit,
        calculatePrintableAge,
        calculateAgeYears,
        consentRecordedText,
        displayReferralNumber
    });
})(window);
