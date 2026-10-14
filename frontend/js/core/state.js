(function initializeIrdssState(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};

    IRDSS.state = IRDSS.state || {
        currentHospital: null,
        currentUser: null,
        currentReferralPatient: null,
        activeInitiatedReferralId: null,
        activeInitiatedReferralNumber: null,
        currentActiveReferralId: null
    };
})(window);
