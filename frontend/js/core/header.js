(function initializeIrdssHeader(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    let initialized = false;
    let clockIntervalId = null;

    function updateClock() {
        const now = new Date();
        const timeText = now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        const dateText = now.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
        $('#headerTimeText').text(timeText);
        $('#headerDateText').text(dateText);
    }

    function init() {
        if (initialized) return;
        initialized = true;
        updateClock();
        clockIntervalId = window.setInterval(updateClock, 30000);
    }

    function stop() {
        if (clockIntervalId) window.clearInterval(clockIntervalId);
        clockIntervalId = null;
        initialized = false;
    }

    IRDSS.header = Object.freeze({ init, stop, updateClock });
})(window, window.jQuery);
