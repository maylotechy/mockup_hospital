(function initializeIrdssReferralWebSocket(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { showToast } = IRDSS.ui;

    let actions = {};
    let initialized = false;
    let started = false;
    let ticketRequestInProgress = false;
    let referralSocket = null;
    let reconnectTimeoutId = null;
    let reconnectAttempts = 0;
    let lifecycleId = 0;
    const fallbackIntervalIds = new Set();

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    function handleMessage(message) {
        if (!message || !message.type) return;

        switch (message.type) {
            case 'NEW_REFERRAL':
            case 'REFERRAL_CANCELLED':
                runAction('pollIncomingReferrals');
                break;

            case 'REFERRAL_SEEN':
            case 'REFERRAL_ACCEPTED':
            case 'REFERRAL_REDIRECTED':
            case 'REFERRAL_FINALIZED_CONFIRMED':
                runAction('checkRecommendations');
                if ($('#tabReferralsContent').is(':visible')) runAction('loadMyReferrals');
                break;

            case 'REFERRAL_FINALIZED_TO_YOU':
                showToast('success', 'A referral has been finalized to your facility!', 4000);
                runAction('playNotificationSound');
                if ($('#tabIncomingContent').is(':visible')) runAction('loadAcceptedPatients');
                break;

            case 'REFERRAL_NOT_SELECTED':
                if ($('#tabIncomingContent').is(':visible')) runAction('loadAcceptedPatients');
                break;

            case 'PATIENT_ARRIVED':
            case 'PATIENT_DEPARTED':
                if ($('#tabReferralsContent').is(':visible')) runAction('loadMyReferrals');
                break;

            case 'CLINICAL_URGENCY_UPDATED':
                runAction('loadMyReferrals');
                runAction('loadAcceptedPatients');
                if (message.immediate_notification) {
                    showToast('warning', 'A referral clinical urgency was reassessed. Review the updated triage.', 4000);
                    runAction('playNotificationSound');
                }
                break;

            default:
                break;
        }
    }

    function scheduleReconnect() {
        if (!started || !state.currentHospital || reconnectTimeoutId) return;
        reconnectAttempts += 1;
        const delay = Math.min(30000, 2000 * reconnectAttempts);
        reconnectTimeoutId = setTimeout(() => {
            reconnectTimeoutId = null;
            connect();
        }, delay);
    }

    function connect() {
        if (!started || !state.currentHospital || referralSocket || ticketRequestInProgress) return;
        ticketRequestInProgress = true;
        const requestLifecycleId = lifecycleId;

        $.ajax({
            url: `${API_BASE}/get_ws_ticket.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (requestLifecycleId !== lifecycleId) return;
                ticketRequestInProgress = false;
                if (!started) return;
                if (!response.success || !response.ws_url) {
                    scheduleReconnect();
                    return;
                }

                try {
                    referralSocket = new window.WebSocket(response.ws_url);
                } catch (error) {
                    referralSocket = null;
                    scheduleReconnect();
                    return;
                }

                referralSocket.onopen = function () {
                    reconnectAttempts = 0;
                };
                referralSocket.onmessage = function (event) {
                    try {
                        handleMessage(JSON.parse(event.data));
                    } catch (error) {
                        // Ignore malformed frames and keep the connection alive.
                    }
                };
                referralSocket.onclose = function () {
                    referralSocket = null;
                    scheduleReconnect();
                };
                referralSocket.onerror = function () {
                    if (referralSocket) referralSocket.close();
                };
            },
            error: function () {
                if (requestLifecycleId !== lifecycleId) return;
                ticketRequestInProgress = false;
                scheduleReconnect();
            }
        });
    }

    function addFallback(actionName, milliseconds) {
        const intervalId = setInterval(() => {
            if (started && state.currentHospital) runAction(actionName);
        }, milliseconds);
        fallbackIntervalIds.add(intervalId);
    }

    function startFallbackPolling() {
        if (fallbackIntervalIds.size > 0) return;
        addFallback('pollIncomingReferrals', 45000);
        addFallback('checkRecommendations', 30000);
        addFallback('loadAcceptedPatients', 45000);
    }

    function stopFallbackPolling() {
        fallbackIntervalIds.forEach(intervalId => clearInterval(intervalId));
        fallbackIntervalIds.clear();
    }

    function start() {
        if (started || !state.currentHospital) return;
        started = true;
        lifecycleId += 1;
        startFallbackPolling();
        runAction('pollIncomingReferrals');
        connect();
    }

    function stop() {
        started = false;
        lifecycleId += 1;
        ticketRequestInProgress = false;
        reconnectAttempts = 0;
        if (reconnectTimeoutId) clearTimeout(reconnectTimeoutId);
        reconnectTimeoutId = null;
        stopFallbackPolling();

        if (referralSocket) {
            referralSocket.onclose = null;
            referralSocket.close();
            referralSocket = null;
        }
    }

    function init() {
        if (initialized) return;
        initialized = true;
        $(window).on('beforeunload.referralWebSocket', stop);
    }

    IRDSS.referrals.websocket = Object.freeze({
        configure,
        init,
        start,
        stop,
        connect,
        handleMessage,
        isStarted: function () { return started; }
    });
})(window, window.jQuery);
