(function initializeIrdssReferralNotifications(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.referrals = IRDSS.referrals || {};

    const { escapeHtml } = IRDSS.formatters;
    const notifiedReferralIds = new Set();
    const incomingNotifications = new Map();
    const PENDING_SEVERITY_LABEL = { 1: 'Mild', 2: 'Moderate', 3: 'Severe', 4: 'Critical', 5: 'Extreme' };

    let actions = {};
    let initialized = false;
    let newReferralToastTimeout = null;
    let alarmIntervalId = null;
    let alarmStopTimeoutId = null;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name, ...args) {
        if (typeof actions[name] === 'function') return actions[name](...args);
        return undefined;
    }

    function getReferralId(item) {
        return item && (item.referral_id || item.id);
    }

    function isPending(item) {
        const status = String(item?.response_status || item?.status || '').toUpperCase();
        return !!getReferralId(item) && status !== 'ACCEPTED' && status !== 'REDIRECTED';
    }

    function formatWaitLabel(createdAt) {
        if (!createdAt) return { text: 'Unknown', cls: 'text-slate-500' };
        const mins = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
        const text = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const cls = mins < 5 ? 'text-emerald-700' : mins < 15 ? 'text-amber-700' : 'text-red-700 font-bold';
        return { text, cls };
    }

    function renderNotificationBell() {
        const $badge = $('#notificationBadge');
        const $list = $('#notificationList');
        const count = incomingNotifications.size;

        if (count > 0) {
            $badge.text(count > 9 ? '9+' : count).removeClass('hidden');
        } else {
            $badge.addClass('hidden');
        }

        if (count === 0) {
            $list.html('<div class="px-4 py-6 text-center text-xs text-slate-400">No new referrals</div>');
            return;
        }

        const sorted = Array.from(incomingNotifications.entries()).sort((a, b) => {
            return new Date(b[1].created_at || 0) - new Date(a[1].created_at || 0);
        });

        $list.html(sorted.map(([referralId, alert]) => {
            const referringFacility = alert.referring_facility || alert.referring_hospital ||
                (alert.serviceProvider && alert.serviceProvider.display) || 'Unknown Hospital';
            return `
                <div class="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                    <div class="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                        <i class="bi bi-hospital"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-semibold text-slate-800">New referral from <span class="text-red-700">${escapeHtml(referringFacility)}</span></p>
                        <p class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(alert.referral_number || String(referralId))}</p>
                        <button type="button" class="btn-view-referral-form mt-2 px-3 py-1 bg-yellow-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition-all" data-ref-id="${escapeHtml(String(referralId))}">
                            <i class="bi bi-file-earmark-text-fill me-1"></i> View Form
                        </button>
                    </div>
                </div>
            `;
        }).join(''));
    }

    function renderPendingReferralsList() {
        const $list = $('#pendingReferralsList');
        const items = Array.from(incomingNotifications.values());
        const count = items.length;
        const criticalCount = items.filter(item => (parseInt(item.disease_severity, 10) || 0) >= 4).length;

        $('#statPendingCount').text(count);
        $('#statCriticalPendingCount').text(criticalCount);
        $('#navPendingBadge').text(count > 9 ? '9+' : count).toggleClass('hidden', count === 0);

        if ($list.length === 0) return;
        if (count === 0) {
            $list.html('<div class="px-6 py-10 text-center text-xs text-slate-400"><i class="bi bi-check2-circle text-2xl text-slate-300 block mb-2"></i>No pending referrals right now.</div>');
            return;
        }

        const sorted = items.slice().sort((a, b) => {
            const severityDifference = (parseInt(b.disease_severity, 10) || 0) - (parseInt(a.disease_severity, 10) || 0);
            if (severityDifference !== 0) return severityDifference;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0);
        });

        $list.html(sorted.map(item => {
            const referralId = getReferralId(item);
            const severity = parseInt(item.disease_severity, 10) || 0;
            const severityLabel = PENDING_SEVERITY_LABEL[severity] || String(item.disease_severity);
            const wait = formatWaitLabel(item.created_at);
            return `
                <div class="bg-white rounded-xl border border-slate-200/70 p-4">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm text-slate-800"><span class="font-semibold">Referral from:</span> ${escapeHtml(item.referring_facility || 'Unknown Facility')}</p>
                            <p class="text-sm text-slate-800"><span class="font-semibold">Triage:</span> ${severity} &middot; ${escapeHtml(severityLabel)}</p>
                            <p class="text-sm"><span class="font-semibold text-slate-800">Waiting time:</span> <span class="${wait.cls}">${escapeHtml(wait.text)}</span></p>
                        </div>
                        <button type="button" data-ref-id="${escapeHtml(String(referralId))}"
                            class="btn-review-pending-referral flex-shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-all">
                            <i class="bi bi-file-earmark-text-fill"></i> Review &amp; Decide
                        </button>
                    </div>
                </div>
            `;
        }).join(''));
    }

    function render() {
        renderNotificationBell();
        renderPendingReferralsList();
    }

    function showNewReferralToast() {
        const $toast = $('#newReferralToast');
        const $bell = $('#btnNotificationBell');

        $toast.removeClass('hidden');
        clearTimeout(newReferralToastTimeout);
        newReferralToastTimeout = setTimeout(() => $toast.addClass('hidden'), 4000);

        $bell.removeClass('animate-bell-shake');
        if ($bell[0]) void $bell[0].offsetWidth;
        $bell.addClass('animate-bell-shake');
    }

    function getAudioContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return null;
        if (!window._notificationAudioCtx) window._notificationAudioCtx = new AudioContext();
        if (window._notificationAudioCtx.state === 'suspended') window._notificationAudioCtx.resume();
        return window._notificationAudioCtx;
    }

    function playTones(frequencies, oscillatorType, spacing, volume, duration) {
        try {
            const context = getAudioContext();
            if (!context) return;
            const now = context.currentTime;
            frequencies.forEach((frequency, index) => {
                const oscillator = context.createOscillator();
                const gain = context.createGain();
                const start = now + index * spacing;
                oscillator.type = oscillatorType;
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(volume, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
                oscillator.connect(gain);
                gain.connect(context.destination);
                oscillator.start(start);
                oscillator.stop(start + duration + 0.05);
            });
        } catch (error) {
            // Audio may be blocked until the user interacts with the page.
        }
    }

    function playNotificationSound() {
        playTones([880, 1108], 'sine', 0.15, 0.3, 0.35);
    }

    function playAlarmBeep() {
        playTones([1046, 784], 'square', 0.18, 0.22, 0.3);
    }

    function stopAlarm() {
        if (alarmIntervalId) clearInterval(alarmIntervalId);
        if (alarmStopTimeoutId) clearTimeout(alarmStopTimeoutId);
        alarmIntervalId = null;
        alarmStopTimeoutId = null;
    }

    function playAlarm() {
        stopAlarm();
        playAlarmBeep();
        alarmIntervalId = setInterval(playAlarmBeep, 900);
        alarmStopTimeoutId = setTimeout(stopAlarm, 20000);
    }

    function sync(items) {
        const stillPendingIds = new Set();
        let hasNewNotification = false;

        (Array.isArray(items) ? items : []).forEach(item => {
            if (!isPending(item)) return;
            const id = getReferralId(item);
            stillPendingIds.add(id);
            incomingNotifications.set(id, item);
            if (!notifiedReferralIds.has(id)) {
                notifiedReferralIds.add(id);
                hasNewNotification = true;
            }
        });

        Array.from(incomingNotifications.keys()).forEach(id => {
            if (!stillPendingIds.has(id)) {
                incomingNotifications.delete(id);
                notifiedReferralIds.delete(id);
            }
        });

        render();
        if (hasNewNotification) {
            showNewReferralToast();
            playAlarm();
        }
        return hasNewNotification;
    }

    function upsert(item) {
        const id = getReferralId(item);
        if (!id) return;
        incomingNotifications.set(id, item);
        notifiedReferralIds.add(id);
        render();
    }

    function get(referralId) {
        return incomingNotifications.get(referralId);
    }

    function openReferral(referralId) {
        const alert = get(referralId);
        if (!alert) return;
        $('#notificationDropdown').addClass('hidden');
        stopAlarm();
        runAction('markSeen', referralId);
        runAction('showDetail', alert);
    }

    function clear() {
        stopAlarm();
        clearTimeout(newReferralToastTimeout);
        newReferralToastTimeout = null;
        notifiedReferralIds.clear();
        incomingNotifications.clear();
        $('#newReferralToast, #notificationDropdown').addClass('hidden');
        render();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        render();

        $(document).on('click.referralNotifications', '#btnNotificationBell', function (event) {
            event.stopPropagation();
            $('#notificationDropdown').toggleClass('hidden');
            stopAlarm();
        });
        $(document).on('click.referralNotifications', '#notificationDropdown', event => event.stopPropagation());
        $(document).on('click.referralNotifications', function () {
            $('#notificationDropdown').addClass('hidden');
        });
        $(document).on('click.referralNotifications', '.btn-view-referral-form, .btn-review-pending-referral', function () {
            openReferral($(this).data('ref-id'));
        });
        $(document).on('click.referralNotifications', '#btnTestAlarm', playAlarm);
    }

    IRDSS.referrals.notifications = Object.freeze({
        configure,
        init,
        sync,
        upsert,
        get,
        render,
        renderBell: renderNotificationBell,
        renderPending: renderPendingReferralsList,
        playSound: playNotificationSound,
        playAlarm,
        stopAlarm,
        clear,
        getCount: function () { return incomingNotifications.size; }
    });
})(window, window.jQuery);
