(function initializeIrdssServiceAssessmentLoader(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.admin = IRDSS.admin || {};

    /**
     * Load / populate the facility's Service Assessment (full DOH Assessment Instrument,
     * rendered dynamically by service_assessment.js against IOL's live form + submit API)
     */
    function loadServiceAssessment() {
        const doh = window.DOHAssessment || (typeof DOHAssessment !== 'undefined' ? DOHAssessment : null);
        if (doh && typeof doh.loadForm === 'function') {
            doh.loadForm();
        } else {
            console.error('DOHAssessment module not found on window object!');
        }
    }

    IRDSS.admin.serviceAssessment = Object.freeze({
        init: function () {},
        load: loadServiceAssessment
    });
})(window);
