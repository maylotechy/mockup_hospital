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
        return [patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(' ');
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
        const today = new Date();
        let years = today.getFullYear() - birthDate.getFullYear();
        const birthdayPassed = today.getMonth() > birthDate.getMonth()
            || (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!birthdayPassed) years -= 1;
        years = Math.max(0, years);
        return `${years} year${years === 1 ? '' : 's'} old`;
    }

    function consentRecordedText(consentStatus, consentMethod) {
        if (String(consentStatus || '').toUpperCase() !== 'GRANTED') return 'Not recorded';
        const method = String(consentMethod || '').toUpperCase();
        if (method === 'ELECTRONIC') return 'Electronic consent recorded';
        if (method === 'PAPER') return 'Paper consent recorded';
        return 'Consent recorded';
    }

    IRDSS.formatters = Object.freeze({
        escapeHtml,
        formatPatientName,
        formatDateTime12h,
        formatAgeDisplay,
        printableValue,
        printableWithUnit,
        calculatePrintableAge,
        consentRecordedText
    });
})(window);
