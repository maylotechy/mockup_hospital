/**
 * Mock Hospital HIS - Multi-Hospital System JS
 * Powered by jQuery & Bootstrap 5
 */

$(document).ready(function () {
    // Enable cross-origin credentials for PHP session cookie persistence
    $.ajaxSetup({
        xhrFields: {
            withCredentials: true
        }
    });

    const IRDSS = window.IRDSS;
    const formatReferralTimestamp = IRDSS.referrals.list.formatTimestamp;

    IRDSS.referrals.form.configure({
        initializeReferralLocation: IRDSS.location.psgc.initializeReferral,
        formatReferralTimestamp
    });
    IRDSS.referrals.submit.configure({
        checkRecommendations: IRDSS.referrals.recommendations.check
    });
    IRDSS.referrals.recommendations.configure({
        playNotificationSound: IRDSS.referrals.notifications.playSound
    });
    IRDSS.referrals.notifications.configure({
        markSeen: IRDSS.referrals.incoming.markSeen,
        showDetail: IRDSS.referrals.incoming.showDetail
    });
    IRDSS.referrals.websocket.configure({
        pollIncomingReferrals: IRDSS.referrals.incoming.poll,
        checkRecommendations: IRDSS.referrals.recommendations.check,
        loadMyReferrals: IRDSS.referrals.list.load,
        loadAcceptedPatients: IRDSS.patients.transferred.load,
        playNotificationSound: IRDSS.referrals.notifications.playSound
    });
    IRDSS.patients.list.configure({
        openReferralForm: IRDSS.referrals.form.openForPatient
    });
    IRDSS.patients.transferred.configure({
        openReferralForm: IRDSS.referrals.form.openForPatient,
        formatReferralTimestamp,
        referralReasonsText: IRDSS.referrals.form.reasonsText,
        attachmentLinksHtml: IRDSS.referrals.form.attachmentLinksHtml
    });
    IRDSS.header.init();
    IRDSS.referrals.form.init();
    IRDSS.consent.print.init();
    IRDSS.referrals.submit.init();
    IRDSS.referrals.list.init();
    IRDSS.referrals.recommendations.init();
    IRDSS.referrals.incoming.init();
    IRDSS.referrals.notifications.init();
    IRDSS.referrals.websocket.init();
    IRDSS.patients.list.init();
    IRDSS.patients.form.init();
    IRDSS.patients.transferred.init();
    IRDSS.location.psgc.init();
    IRDSS.analytics.facility.init();
    IRDSS.admin.auditLogs.init();
    IRDSS.admin.users.init();
    IRDSS.admin.serviceAssessment.init();

    IRDSS.navigation.configure({
        loadPatients: IRDSS.patients.list.load,
        loadMyReferrals: IRDSS.referrals.list.load,
        checkRecommendations: IRDSS.referrals.recommendations.check,
        stopAlarm: IRDSS.referrals.notifications.stopAlarm,
        pollIncomingReferrals: IRDSS.referrals.incoming.poll,
        loadAcceptedPatients: IRDSS.patients.transferred.load,
        loadUsers: IRDSS.admin.users.load,
        loadServiceAssessment: IRDSS.admin.serviceAssessment.load,
        loadFacilityAnalytics: IRDSS.analytics.facility.load,
        loadSystemLogs: IRDSS.admin.auditLogs.load,
        initializePatientLocation: IRDSS.location.psgc.initializePatient,
        connectReferralWebSocket: IRDSS.referrals.websocket.start,
        disconnectReferralWebSocket: IRDSS.referrals.websocket.stop
    });
    IRDSS.navigation.init();

    IRDSS.auth.session.configure({
        clearReferralNotifications: IRDSS.referrals.notifications.clear
    });

    // Compatibility bridge for standalone scripts that still call these globals.
    window.switchTab = IRDSS.navigation.switchTab;
    window.showToast = IRDSS.ui.showToast;

    IRDSS.auth.session.init();
});
