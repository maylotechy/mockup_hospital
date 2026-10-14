(function initializeIrdssNavigation(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    const state = IRDSS.state;
    const { ASSET_CACHE_BUST } = IRDSS.config;
    let actions = {};
    let initialized = false;

    const ACTIVE_LINK_CLASSES = 'bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60';
    const INACTIVE_LINK_CLASSES = 'text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70';
    const ALL_TABS = '#tabPatientsContent, #tabAddPatientContent, #tabReferPatientContent, #tabPendingContent, #tabReferralsContent, #tabIncomingContent, #tabUsersContent, #tabAssessmentContent, #tabAnalyticsContent, #tabLogsContent';

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name) {
        if (typeof actions[name] === 'function') actions[name]();
    }

    function openSidebar() {
        $('#sidebar').removeClass('-translate-x-full');
        $('#sidebarBackdrop').removeClass('hidden');
    }

    function closeSidebar() {
        $('#sidebar').addClass('-translate-x-full');
        $('#sidebarBackdrop').addClass('hidden');
    }

    function getHospitalLogoPath(hospitalCode) {
        const logoMap = {
            'HOSP-DRMC': 'assets/logos/hospitals/DRMC.png',
            'HOSP-CVPHL': 'assets/logos/hospitals/CVPHL.png',
            'HOSP-MMH': 'assets/logos/hospitals/MMH.png'
        };
        return logoMap[hospitalCode] || 'assets/logos/hospitals/_default.png';
    }

    function updateHospitalLogo(hospitalCode) {
        $('#hospitalLogo').attr('src', `${getHospitalLogoPath(hospitalCode)}?v=${ASSET_CACHE_BUST}`);
    }

    function applyRoleBasedNav() {
        const isAdmin = state.currentUser && state.currentUser.role === 'facility_admin';
        const isAssessed = !!(state.currentHospital && state.currentHospital.is_assessment_completed);

        $('[data-nav-role="staff"]').toggle(!isAdmin);
        if (isAdmin && !isAssessed) {
            $('[data-nav-role="admin"]').hide();
            $('#navTabAssessment').show();
            return;
        }
        $('[data-nav-role="admin"]').toggle(isAdmin);
    }

    function activateNav(tabName, title) {
        $('.sidebar-link').removeClass(ACTIVE_LINK_CLASSES).addClass(INACTIVE_LINK_CLASSES);
        $('.sidebar-link i').removeClass('text-red-600').addClass('text-slate-500');

        const navMap = {
            patients: ['#navTabPatients', '#navIconPatients'],
            referrals: ['#navTabReferrals', '#navIconReferrals'],
            pending: ['#navTabPending', '#navIconPending'],
            incoming: ['#navTabIncoming', '#navIconIncoming'],
            users: ['#navTabUsers', '#navIconUsers'],
            assessment: ['#navTabAssessment', '#navIconAssessment'],
            analytics: ['#navTabAnalytics', '#navIconAnalytics'],
            logs: ['#navTabLogs', '#navIconLogs']
        };
        const selectors = navMap[tabName];
        if (selectors) {
            $(selectors[0]).removeClass(INACTIVE_LINK_CLASSES).addClass(ACTIVE_LINK_CLASSES);
            $(selectors[1]).removeClass('text-slate-500').addClass('text-red-600');
        }
        $('#mainHeaderTitle').text(title);
        $(ALL_TABS).hide();
    }

    function switchTab(tabName) {
        const tabs = {
            patients: { title: 'Patient Records', content: '#tabPatientsContent' },
            addPatient: { title: 'Register Patient', content: '#tabAddPatientContent', action: 'initializePatientLocation' },
            referPatient: { title: 'Refer Patient', content: '#tabReferPatientContent' },
            referrals: { title: 'My Referrals', content: '#tabReferralsContent', actions: ['loadMyReferrals', 'checkRecommendations'] },
            pending: { title: 'Pending Referrals', content: '#tabPendingContent', actions: ['stopAlarm', 'pollIncomingReferrals'] },
            incoming: { title: 'Incoming Patients', content: '#tabIncomingContent', action: 'loadAcceptedPatients' },
            users: { title: 'Manage Users', content: '#tabUsersContent', action: 'loadUsers' },
            assessment: { title: 'Service Assessment', content: '#tabAssessmentContent', action: 'loadServiceAssessment' },
            analytics: { title: 'Analytics', content: '#tabAnalyticsContent', action: 'loadFacilityAnalytics' },
            logs: { title: 'System Logs', content: '#tabLogsContent', action: 'loadSystemLogs' }
        };
        const tab = tabs[tabName];
        if (!tab) return;

        activateNav(tabName, tab.title);
        $(tab.content).fadeIn(200, function () {
            if (tabName === 'addPatient') runAction('initializePatientLocation');
        });

        if (tabName !== 'addPatient') {
            if (tab.action) runAction(tab.action);
            (tab.actions || []).forEach(runAction);
        }
    }

    function showDashboardView() {
        const isAdmin = state.currentUser && state.currentUser.role === 'facility_admin';
        const isAssessed = !!(state.currentHospital && state.currentHospital.is_assessment_completed);

        if (!isAdmin && !isAssessed) {
            $('#loginView, #dashboardView').hide();
            $('#lockedNoticeView').fadeIn(200);
            return;
        }

        $('#loginView, #lockedNoticeView').hide();
        $('#dashboardView').fadeIn(200);
        $('#sidebarHospitalName, #headerHospitalName').text(state.currentHospital.name);
        $('#sidebarHospitalCode').text(state.currentHospital.code);
        $('#sidebarFacilityTier').text(state.currentHospital.tier_level || '--').removeClass('hidden');
        updateHospitalLogo(state.currentHospital.code);
        applyRoleBasedNav();

        if (isAdmin && !isAssessed) {
            $('#assessmentLockBanner').removeClass('hidden');
            switchTab('assessment');
        } else if (isAdmin) {
            $('#assessmentLockBanner').addClass('hidden');
            switchTab('users');
        } else {
            $('#assessmentLockBanner').addClass('hidden');
            switchTab('patients');
            runAction('loadPatients');
            runAction('checkRecommendations');
            runAction('connectReferralWebSocket');
        }
    }

    function showLoginView() {
        $('#dashboardView, #lockedNoticeView').hide();
        $('#loginView').fadeIn(200);
        runAction('disconnectReferralWebSocket');
    }

    function init() {
        if (initialized) return;
        initialized = true;

        $('#btnSidebarToggle').on('click.navigation', function () {
            if ($('#sidebar').hasClass('-translate-x-full')) openSidebar();
            else closeSidebar();
        });
        $('#sidebarBackdrop').on('click.navigation', closeSidebar);
        $(document).on('click.navigation', '.sidebar-link', closeSidebar);

        const navBindings = {
            '#navTabPatients': 'patients',
            '#navTabReferrals': 'referrals',
            '#navTabPending': 'pending',
            '#navTabIncoming': 'incoming',
            '#navTabUsers': 'users',
            '#navTabAssessment': 'assessment',
            '#navTabAnalytics': 'analytics',
            '#navTabLogs': 'logs'
        };
        Object.entries(navBindings).forEach(([selector, tabName]) => {
            $(selector).on('click.navigation', function (event) {
                event.preventDefault();
                switchTab(tabName);
            });
        });
    }

    IRDSS.navigation = Object.freeze({
        configure,
        init,
        openSidebar,
        closeSidebar,
        getHospitalLogoPath,
        updateHospitalLogo,
        applyRoleBasedNav,
        showDashboardView,
        showLoginView,
        switchTab
    });
})(window, window.jQuery);
