(function initializeIrdssConfig(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    const isIdeServer = window.location.port === '63342' || window.location.port === '63343';

    IRDSS.config = Object.freeze({
        isIdeServer,
        API_BASE: isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend',
        API_V1_REFERRAL: isIdeServer
            ? 'http://localhost/mock_hospitals/api/v1/referral'
            : '../api/v1/referral',
        ASSET_CACHE_BUST: Date.now()
    });

    // Kept temporarily for existing standalone scripts that already read this global.
    window.API_BASE = IRDSS.config.API_BASE;
})(window);
