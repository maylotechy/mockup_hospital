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

    // API Base URL (auto-detect PhpStorm/IntelliJ built-in preview server, ports 63342/63343)
    const isIdeServer = location.port === '63342' || location.port === '63343';
    const API_BASE = isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend';
    window.API_BASE = API_BASE;
    const API_V1_REFERRAL = isIdeServer ? 'http://localhost/mock_hospitals/api/v1/referral' : '../api/v1/referral';

    // Cache-buster appended to logo URLs so replacing a logo file (e.g. _default.png)
    // shows up on next page load instead of silently serving the browser's old cached copy
    const ASSET_CACHE_BUST = Date.now();


    // Active Facility State (kept as `currentHospital` since referral/inventory/outcomes
    // code throughout this file already treats it as the logged-in facility's own record)
    let currentHospital = null;
    // Active Staff User State (role-based nav & assessment lockout)
    let currentUser = null;

    const TOAST_STYLE = {
        success: { bg: '#5cb85c', bar: '#4a9440', title: 'Success' },
        info:    { bg: '#4a9fc4', bar: '#3d84a3', title: 'Info' },
        warning: { bg: '#f0a030', bar: '#cf8620', title: 'Warning' },
        error:   { bg: '#c0504d', bar: '#a4423f', title: 'Error' }
    };

    /**
     * Shows a corner toast notification in the shared design: solid colored card,
     * icon, bold category title, a message line below it, and a bottom timer bar
     * that drains as it counts down. Replaces every ad-hoc `Swal.fire({toast:true})`
     * call so all transient notifications look and behave the same way.
     *
     * @param {'success'|'info'|'warning'|'error'} type
     * @param {string} message - plain text; escaped internally, never pass raw HTML
     * @param {number} [duration=3000] - ms before auto-dismiss
     */
    function showToast(type, message, duration) {
        const style = TOAST_STYLE[type] || TOAST_STYLE.info;

        Swal.fire({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: duration || 3000,
            timerProgressBar: true,
            background: style.bg,
            color: '#ffffff',
            html: `
                <div class="text-start" style="min-width: 240px; max-width: 340px;">
                    <div style="font-weight: 700; font-size: 0.95rem; line-height: 1.25;">${style.title}</div>
                    <div style="font-size: 0.82rem; opacity: 0.95; line-height: 1.3;">${escapeHtml(message)}</div>
                </div>
            `,
            customClass: { popup: 'toast-notification-popup' },
            didOpen: (toastEl) => {
                const bar = toastEl.querySelector('.swal2-timer-progress-bar');
                if (bar) bar.style.backgroundColor = style.bar;
                toastEl.onmouseenter = Swal.stopTimer;
                toastEl.onmouseleave = Swal.resumeTimer;
            }
        });
    }

    /**
     * Check active staff session on page load
     */
    function checkSession() {
        $.ajax({
            url: `${API_BASE}/login.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.authenticated && response.user && response.facility) {
                    currentUser = response.user;
                    currentHospital = response.facility;
                    showDashboardView();
                } else {
                    currentUser = null;
                    currentHospital = null;
                    showLoginView();
                }
            },
            error: function () {
                showLoginView();
            }
        });
    }

    /**
     * Mobile sidebar: off-canvas on small screens (toggled via hamburger + backdrop),
     * always visible on lg+ via the `lg:translate-x-0` class already on #sidebar --
     * these open/close calls are simply no-ops on desktop since that class wins there.
     */
    function openSidebar() {
        $('#sidebar').removeClass('-translate-x-full');
        $('#sidebarBackdrop').removeClass('hidden');
    }
    function closeSidebar() {
        $('#sidebar').addClass('-translate-x-full');
        $('#sidebarBackdrop').addClass('hidden');
    }
    $('#btnSidebarToggle').on('click', function () {
        if ($('#sidebar').hasClass('-translate-x-full')) openSidebar(); else closeSidebar();
    });
    $('#sidebarBackdrop').on('click', closeSidebar);
    $(document).on('click', '.sidebar-link', closeSidebar);

    /**
     * Update hospital logo based on hospital code
     */
    function updateHospitalLogo(hospitalCode) {
        const logoMap = {
            'HOSP-DRMC': 'assets/logos/hospitals/DRMC.png',
            'HOSP-CVPHL': 'assets/logos/hospitals/CVPHL.png',
            'HOSP-MMH': 'assets/logos/hospitals/MMH.png',
            // add more hospitals
        };

        const logo = logoMap[hospitalCode] || 'assets/logos/hospitals/_default.png';

        $('#hospitalLogo').attr('src', `${logo}?v=${ASSET_CACHE_BUST}`);
    }

    /**
     * Show Dashboard View (Authenticated State)
     */
    function showDashboardView() {
        const isAdmin = currentUser && currentUser.role === 'facility_admin';
        const isAssessed = !!(currentHospital && currentHospital.is_assessment_completed);

        // Non-admin staff at a facility that hasn't completed its Service Assessment
        // can't use the system at all yet -- they don't have a way to fill it in.
        if (!isAdmin && !isAssessed) {
            $('#loginView, #dashboardView').hide();
            $('#lockedNoticeView').fadeIn(200);
            return;
        }

        $('#loginView, #lockedNoticeView').hide();
        $('#dashboardView').fadeIn(200);

        $('#sidebarHospitalName, #headerHospitalName').text(currentHospital.name);
        $('#sidebarHospitalCode').text(currentHospital.code);
        $('#sidebarFacilityTier').text(currentHospital.tier_level || '--').removeClass('hidden');

        // edit logo
        updateHospitalLogo(currentHospital.code);

        applyRoleBasedNav();

        if (isAdmin && !isAssessed) {
            // Facility admin must complete the Service Assessment before anything unlocks
            $('#assessmentLockBanner').removeClass('hidden');
            switchTab('assessment');
        } else if (isAdmin) {
            $('#assessmentLockBanner').addClass('hidden');
            switchTab('users');
        } else {
            $('#assessmentLockBanner').addClass('hidden');
            switchTab('patients');
            loadPatients();
            checkAndPollRecommendations();
            connectReferralWebSocket();
        }
    }

    /**
     * Show/hide sidebar nav links based on the logged-in user's role -- Facility Admins
     * manage staff & the Service Assessment, Doctors/Nurses handle patients & referrals.
     * Also locks everything but Service Assessment for a facility_admin whose facility
     * hasn't completed its assessment yet.
     */
    function applyRoleBasedNav() {
        const isAdmin = currentUser && currentUser.role === 'facility_admin';
        const isAssessed = !!(currentHospital && currentHospital.is_assessment_completed);

        $('[data-nav-role="staff"]').toggle(!isAdmin);

        if (isAdmin && !isAssessed) {
            $('[data-nav-role="admin"]').hide();
            $('#navTabAssessment').show();
            return;
        }

        $('[data-nav-role="admin"]').toggle(isAdmin);
    }

    /**
     * Show Login View (Unauthenticated State)
     */
    function showLoginView() {
        $('#dashboardView, #lockedNoticeView').hide();
        $('#loginView').fadeIn(200);
        disconnectReferralWebSocket();
    }

    /**
     * Sidebar Tab Switcher
     */
    function switchTab(tabName) {
        $('.sidebar-link')
            .removeClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60')
            .addClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70');
        $('.sidebar-link i')
            .removeClass('text-red-600')
            .addClass('text-slate-500');

        const $allTabs = $('#tabPatientsContent, #tabAddPatientContent, #tabReferPatientContent, #tabPendingContent, #tabReferralsContent, #tabIncomingContent, #tabUsersContent, #tabAssessmentContent, #tabAnalyticsContent, #tabLogsContent');

        if (tabName === 'patients') {
            $('#navTabPatients')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconPatients')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Patient Records');
            $allTabs.hide();
            $('#tabPatientsContent').fadeIn(200);
        } else if (tabName === 'addPatient') {
            $('#mainHeaderTitle').text('Register Patient');
            $allTabs.hide();
            $('#tabAddPatientContent').fadeIn(200, function () {
                patientLocationCascade.init();
            });
        } else if (tabName === 'referPatient') {
            $('#mainHeaderTitle').text('Refer Patient');
            $allTabs.hide();
            $('#tabReferPatientContent').fadeIn(200);
        } else if (tabName === 'referrals') {
            $('#navTabReferrals')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconReferrals')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('My Referrals');
            $allTabs.hide();
            $('#tabReferralsContent').fadeIn(200);
            loadMyReferrals();
            checkAndPollRecommendations();
        } else if (tabName === 'pending') {
            $('#navTabPending')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconPending')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Pending Referrals');
            $allTabs.hide();
            $('#tabPendingContent').fadeIn(200);
            stopAlarmSound();
            pollIncomingReferrals();
        } else if (tabName === 'incoming') {
            $('#navTabIncoming')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconIncoming')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Incoming Patients');
            $allTabs.hide();
            $('#tabIncomingContent').fadeIn(200);
            loadAcceptedPatients();
        } else if (tabName === 'users') {
            $('#navTabUsers')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconUsers')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Manage Users');
            $allTabs.hide();
            $('#tabUsersContent').fadeIn(200);
            loadUsers();
        } else if (tabName === 'assessment') {
            $('#navTabAssessment')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconAssessment')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Service Assessment');
            $allTabs.hide();
            $('#tabAssessmentContent').fadeIn(200);
            loadServiceAssessment();
        } else if (tabName === 'analytics') {
            $('#navTabAnalytics')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconAnalytics')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Analytics');
            $allTabs.hide();
            $('#tabAnalyticsContent').fadeIn(200);
            loadFacilityAnalytics();
        } else if (tabName === 'logs') {
            $('#navTabLogs')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconLogs')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('System Logs');
            $allTabs.hide();
            $('#tabLogsContent').fadeIn(200);
            loadSystemLogs();
        }
    }

    function loadServiceAssessment() {
        const doh = window.DOHAssessment || (typeof DOHAssessment !== 'undefined' ? DOHAssessment : null);
        if (doh && typeof doh.loadForm === 'function') {
            doh.loadForm();
        } else {
            console.error('DOHAssessment module not found on window object!');
        }
    }



    $('#navTabPatients').on('click', function (e) {
        e.preventDefault();
        switchTab('patients');
    });

    $('#navTabReferrals').on('click', function (e) {
        e.preventDefault();
        switchTab('referrals');
    });

    $('#navTabPending').on('click', function (e) {
        e.preventDefault();
        switchTab('pending');
    });

    $(document).on('click', '#btnRefreshPending', function () {
        pollIncomingReferrals();
    });

    $(document).on('click', '#btnTestAlarm', function () {
        playAlarmSound();
    });

    $('#navTabIncoming').on('click', function (e) {
        e.preventDefault();
        switchTab('incoming');
    });

    $('#navTabUsers').on('click', function (e) {
        e.preventDefault();
        switchTab('users');
    });

    $('#navTabAssessment').on('click', function (e) {
        e.preventDefault();
        switchTab('assessment');
    });

    $('#navTabAnalytics').on('click', function (e) {
        e.preventDefault();
        switchTab('analytics');
    });

    $(document).on('click', '#btnApplyAnalyticsDates', function () {
        loadFacilityAnalytics();
    });

    $(document).on('click', '#btnClearAnalyticsDates', function () {
        $('#analyticsStartDate, #analyticsEndDate').val('');
        loadFacilityAnalytics();
    });

    $(document).on('click', '#btnExportAnalyticsCsv', function () {
        exportFacilityAnalyticsCsv();
    });

    $('#navTabLogs').on('click', function (e) {
        e.preventDefault();
        switchTab('logs');
    });

    $(document).on('click', '#btnRefreshLogs', function () {
        loadSystemLogs();
    });

    /**
     * Handle Login Form Submission
     */
    $('#loginForm').on('submit', function (e) {
        e.preventDefault();

        const username = $('#loginUsername').val();
        const password = $('#loginPassword').val();
        const $btn = $('#btnLoginSubmit');

        $btn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Signing In...').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/login.php`,
            type: 'POST',
            data: { username: username, password: password },
            dataType: 'json',
            success: function (response) {
                $btn.html('<span>Sign In</span> <i class="bi bi-arrow-right"></i>').prop('disabled', false);

                if (response.success && response.user && response.facility) {
                    currentUser = response.user;
                    currentHospital = response.facility;
                    showDashboardView();

                    showToast('success', `Welcome back, ${response.user.full_name}!`, 3000);
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Authentication Failed',
                        text: response.message || 'Invalid credentials.',
                        confirmButtonColor: '#0d6efd'
                    });
                }
            },
            error: function (xhr) {
                $btn.html('<span>Sign In</span> <i class="bi bi-arrow-right"></i>').prop('disabled', false);

                let errMsg = 'Failed to connect to authentication server.';
                if (xhr.responseJSON && xhr.responseJSON.message) {
                    errMsg = xhr.responseJSON.message;
                }

                Swal.fire({
                    icon: 'error',
                    title: 'Login Error',
                    text: errMsg,
                    confirmButtonColor: '#0d6efd'
                });
            }
        });
    });

    /**
     * Handle Logout Button Click
     */
    $(document).on('click', '#btnLogoutBtn, #btnLockedLogout', function () {
        Swal.fire({
            title: 'Log Out?',
            text: 'Are you sure you want to sign out?',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: '<i class="bi bi-box-arrow-right me-1"></i> Yes, Log Out',
            cancelButtonText: 'Cancel',
            reverseButtons: true,
            buttonsStyling: false,
            customClass: {
                popup: 'logout-popup',
                title: 'logout-title',
                htmlContainer: 'logout-text',
                confirmButton: 'logout-confirm',
                cancelButton: 'logout-cancel'
            }
        }).then((result) => {
            if (result.isConfirmed) {
                $.ajax({
                    url: `${API_BASE}/logout.php`,
                    type: 'POST',
                    dataType: 'json',
                    success: function () {
                        currentHospital = null;
                        currentUser = null;
                        window.activeInitiatedReferralId = null;

                        // Clear referral notification state so the next login starts fresh
                        stopAlarmSound();
                        notifiedReferralIds.clear();
                        incomingNotifications.clear();
                        renderNotificationBell();

                        // Explicitly remove active referral key & wipe local storage
                        try {
                            localStorage.removeItem('active_initiated_referral');
                            localStorage.clear();
                        } catch(e) {}

                        showLoginView();

                        showToast('info', 'Signed out successfully.', 2500);
                    }
                });
            }
        });
    });

    /**
     * Load patients for currently authenticated hospital
     */
    function loadPatients() {
        const $tableBody = $('#patientsTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="6" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading hospital patient records...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/get_patients.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.success && Array.isArray(response.data)) {
                    renderPatientsTable(response.data);
                    $('#patientsLastUpdated').text(
                        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                    );
                } else {
                    $tableBody.html(`
                        <tr>
                            <td colspan="6" class="text-center py-4 text-danger">
                                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                                ${response.message || 'Failed to load patients.'}
                            </td>
                        </tr>
                    `);
                }
            },
            error: function (xhr, status, error) {
                $tableBody.html(`
                    <tr>
                        <td colspan="6" class="text-center py-4 text-danger">
                            <i class="bi bi-wifi-off me-1"></i>
                            Error connecting to backend API (${xhr.status} ${error}).
                        </td>
                    </tr>
                `);
            }
        });
    }

    /**
     * Live System Clock Ticker — renders into the header, left of the notification bell.
     */
    function updateSystemClock() {
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
    setInterval(updateSystemClock, 30000);
    updateSystemClock();

    /**
     * Render patient rows in table with jQuery DataTables
     */
    function renderPatientsTable(patients) {
        if ($.fn.DataTable.isDataTable('#patientsTable')) {
            $('#patientsTable').DataTable().destroy();
        }

        const $tableBody = $('#patientsTableBody');
        $tableBody.empty();

        if (patients.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="7" class="text-center py-4 text-muted">
                        No patient records registered for this hospital.
                    </td>
                </tr>
            `);
            return;
        }

        patients.forEach(function (patient) {
            let genderBadgeClass = 'bg-slate-100 text-slate-700 border border-slate-200';
            if (patient.gender === 'Female') genderBadgeClass = 'bg-pink-50 text-pink-700 border border-pink-200';
            if (patient.gender === 'Male') genderBadgeClass = 'bg-blue-50 text-blue-700 border border-blue-200';

            // Transferred-in patients (came via a referral) get a "Mark as Out" action
            // here too, not just on the one-time Incoming Patients intake list -- this
            // is where a doctor actually finds the patient once treatment is ongoing.
            // Status badges (a fact about the patient) and the Mark as Out button (an
            // action you take) are kept in separate columns so they don't read as the
            // same kind of thing.
            let statusBadge = '';
            let markOutButton = '';
            if (patient.is_transferred_in) {
                if (patient.departed_at) {
                    const label = DEPARTURE_OUTCOME_LABEL[patient.departure_outcome] || patient.departure_outcome || 'Out';
                    statusBadge = `
                        <span class="whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                            ${escapeHtml(label)}
                        </span>`;
                } else if (patient.already_referred_onward) {
                    // Already sent to another facility through a real referral -- don't
                    // also offer a discharge action that would contradict it.
                    statusBadge = `
                        <span class="whitespace-nowrap px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 inline-flex items-center gap-1">
                            Referred Onward
                        </span>`;
                } else {
                    markOutButton = `
                        <button class="whitespace-nowrap px-3.5 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm hover:shadow-lg hover:border-slate-700/60 hover:text-slate-700 active:scale-[0.98] transition-all btn-mark-departed" data-referral-id="${escapeHtml(patient.source_referral_id)}">
                            Mark as Out
                        </button>`;
                }
            }

            const row = `
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500 border-b border-slate-300/60">#${String(patient.id).padStart(5, '0')}</td>
                    <td class="py-3.5 px-6 font-semibold text-slate-900 border-b border-slate-300/60">${escapeHtml(formatPatientName(patient))}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(patient.dob)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${genderBadgeClass}">${escapeHtml(patient.gender)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${escapeHtml(patient.phone)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60 whitespace-nowrap">${statusBadge}</td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60 whitespace-nowrap">
                        <div class="flex items-center justify-end gap-1.5">
                            ${markOutButton}
                            <button class="whitespace-nowrap px-3.5 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm hover:shadow-lg hover:border-slate-700/60 hover:text-slate-700 active:scale-[0.98] transition-all btn-refer-patient inline-flex items-center gap-1.5" data-id="${patient.id}">
                                <i class="bi bi-send-plus"></i> Refer
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            $tableBody.append(row);
        });

        // Initialize DataTable
        $('#patientsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [5, 10, 25, 50],
            language: {
                search: "_INPUT_",
                searchPlaceholder: "Search patient records...",
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ patients",
                paginate: {
                    next: '<i class="bi bi-chevron-right"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>'
                }
            },
            columnDefs: [
                {
                    targets: [4, 6],
                    orderable: false
                }
            ]
        });
    }


    /**
     * Open Referral Modal for a specific patient
     */
    $(document).on('click', '.btn-refer-patient', function () {
        openReferralFormForPatientId($(this).data('id'), $(this));
    });

    /**
     * Fetches a patient's local record and opens/pre-fills the Refer Patient form for
     * them -- shared by the Patient Records "Refer" button and, separately, the "Refer
     * to Another Facility" option on an already-transferred-in patient's Mark as Out
     * flow, so re-referring a patient onward always goes through this one real path
     * instead of a redundant manual "Transferred" label.
     *
     * @param {number} patientId
     * @param {jQuery|null} $btn - triggering button, gets a loading spinner while fetching
     * @param {object|null} clinicalData - when re-referring an already transferred-in
     *   patient, their last known vitals/status/severity/timestamp (see the
     *   "Referred to Another Facility" branch below for how this is built). Never
     *   passed for a brand-new patient -- there's no prior clinical data to reuse.
     */
    function openReferralFormForPatientId(patientId, $btn, clinicalData) {
        const originalText = $btn ? $btn.html() : null;
        if ($btn) $btn.html('<span class="spinner-border spinner-border-sm" role="status"></span>').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/get_patients.php`,
            type: 'GET',
            data: { id: patientId },
            dataType: 'json',
            success: function (response) {
                if ($btn) $btn.html(originalText).prop('disabled', false);

                if (response.success && response.data) {
                    const patient = response.data;

                    // Clean slate every time -- without this, a partially-filled-then-
                    // abandoned re-referral (with prefilled vitals) could leak into the
                    // next patient's form if the doctor opens a normal "Refer" afterward.
                    $('#referralForm')[0].reset();
                    resetAdditionalReferralReasons();

                    $('#modalPatientId').val(patient.id);
                    $('#modalPatientName').text(formatPatientName(patient));
                    $('#modalPatientDob').text(patient.dob);
                    $('#modalPatientGender').text(patient.gender);
                    $('#modalPatientPhone').text(patient.phone || 'N/A');

                    switchTab('referPatient');
                    // Pre-fill the location selector from the patient's own registered
                    // address instead of always defaulting to Davao City
                    referralLocationCascade.init({
                        region: patient.region,
                        province: patient.province,
                        city: patient.city_municipality,
                        barangay: patient.barangay
                    });

                    if (clinicalData) {
                        if (clinicalData.vital_bp) {
                            const bpParts = String(clinicalData.vital_bp).split('/');
                            $('#modalVitalBpSystolic').val(bpParts[0] || '');
                            $('#modalVitalBpDiastolic').val(bpParts[1] || '');
                        }
                        if (clinicalData.vital_hr) $('#modalVitalHr').val(clinicalData.vital_hr);
                        if (clinicalData.vital_rr) $('#modalVitalRr').val(clinicalData.vital_rr);
                        if (clinicalData.vital_temp_c) $('#modalVitalTemp').val(clinicalData.vital_temp_c);
                        if (clinicalData.vital_o2sat) $('#modalVitalO2sat').val(clinicalData.vital_o2sat);
                        if (clinicalData.vital_height_cm) $('#modalVitalHeight').val(clinicalData.vital_height_cm);
                        if (clinicalData.vital_weight_kg) $('#modalVitalWeight').val(clinicalData.vital_weight_kg);

                        $('#modalIsPwd').prop('checked', !!clinicalData.is_pwd);
                        $('#modalIsPregnant').prop('checked', !!clinicalData.is_pregnant);
                        $('#modalIsSeniorCitizen').prop('checked', !!clinicalData.is_senior_citizen);
                        $('#modalHasAllergy').prop('checked', !!clinicalData.has_allergy);
                        if (clinicalData.has_allergy && clinicalData.allergy_details) {
                            $('#modalAllergyDetails').val(clinicalData.allergy_details);
                        }

                        if (clinicalData.disease_severity) $('#modalSeverity').val(clinicalData.disease_severity);

                        // Vitals are a reading from a point in time, not a static fact like
                        // PWD/pregnant status -- flag prominently that they may be stale
                        // instead of letting them look like a just-taken measurement.
                        if (clinicalData.vitalsAsOf) {
                            $('#modalVitalsPrefillTimestamp').text(formatReferralTimestamp(clinicalData.vitalsAsOf));
                            $('#modalVitalsPrefillNotice').removeClass('hidden');
                        }
                    } else {
                        $('#modalVitalsPrefillNotice').addClass('hidden');
                    }

                    toggleReferralReasonOther();
                    toggleAllergyDetails();
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: response.message || 'Could not fetch patient details.',
                        confirmButtonColor: '#2563eb'
                    });
                }
            },
            error: function (xhr) {
                if ($btn) $btn.html(originalText).prop('disabled', false);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: `Failed to fetch patient data (${xhr.status}).`,
                    confirmButtonColor: '#2563eb'
                });
            }
        });
    }

    const REFERRAL_REASONS = {
        HUMAN_RESOURCE: [
            'No Available Anaesthesiologist', 'No Available Cardiologist', 'No Available Cardio Thoracic Surgeon',
            'No Available Dentist', 'No Available Dermatologist', 'No Available Endocrinologist', 'No Available Orthodontist',
            'No Available Rheumatologist', 'No Available Urologist', 'No Available General Physician',
            'No Available Family Medicine Physician', 'No Available General Surgeon', 'No Available Critical Care Surgeon',
            'No Available Internal Medicine', 'No Available Neurologist', 'No Available Gastroenterologist',
            'No Available Toxicologist', 'No Available Neonatologist', 'No Available Nephrologist', 'No Available Neurosurgeon',
            'No Available Obstetrician-Gynecologist', 'No Available Oncologist', 'No Available Ophthalmologist',
            'No Available Haematologist', 'No Available Colorectal Surgeon', 'No Available ENT Specialist',
            'No Available Orthopaedic Surgeon', 'No Available Paediatrician', 'No Available Psychiatrist',
            'No Available Diabetologist', 'No Available Pulmonologist'
        ],
        HEALTH_FACILITY: [
            'No Available Delivery Room', 'No Available Operating Room', 'No Available Intensive Care Unit',
            'No Available Coronary Care Unit', 'No Available Critical Care Unit (CCU)', 'No Available Neonatal Intensive Care Unit',
            'No Available Pediatrics Intensive Care Unit', 'No Available Burn Unit', 'No Available CoVid19 Isolation',
            'Full Delivery Room', 'Full Operating Room', 'Full Intensive Care Unit', 'Full Coronary Care Unit',
            'Full Critical Care Unit (CCU)', 'Full Neonatal Intensive Care Unit', 'Full Pediatrics Intensive Care Unit',
            'Full Burn Unit', 'Full CoVid19 Isolation'
        ],
        MEDICATION: [
            'No Available Anaesthesia Medication', 'No Available Anti-Convulsant Medication', 'No Available Epinephrine',
            'No Available Anti-Rabies Vaccine', 'No Available Anti-Tetanus Vaccine', 'No Available Anti-Venom',
            'No Available Thrombolytic Medication', 'No Available Blood Product', 'No Available Dialysis Medication',
            'No Available Insulin', 'No Available MGSO4', 'No Available Nitroglycerine'
        ],
        DIAGNOSTIC_EQUIPMENT: [
            'No Available Mammogram Machine', 'No Available Cardiac Monitor', 'No Available Anaesthesia Machine',
            'No Available CT Scan Machine', 'No Available 2D Echo Ultrasound Machine', 'No Available Ultrasonography Machine',
            'No Available Endoscopy Machine', 'No Available Colonoscopy Machine', 'No Available MRI Machine',
            'No Available Incubator', 'No Available ECG Machine', 'No Available Dental X-Ray', 'No Available X-Ray Machine',
            'No Available PET Scan', 'Non Functional Ultrasonography Machine', 'Non Functional Endoscopy Machine',
            'Non Functional 2D Echo Ultrasound Machine', 'Non Functional Colonoscopy Machine', 'Non Functional CT Scan Machine',
            'Non Functional Mechanical Ventilator', 'Non Functional Mammogram Machine', 'Non Functional Cardiac Monitor',
            'Non Functional Anaesthesia Machine', 'Non Functional MRI Machine', 'Non Functional Incubator',
            'Non Functional ECG Machine', 'Non Functional X-Ray Machine', 'Non Functional PET Scan'
        ],
        HEALTH_SERVICES: [
            'No Available Animal Bite Center Services', 'No Available Safe Birthing Facility Services',
            'No Available Dental Services', 'No Available Dialysis Services', 'No Available Laboratory Services',
            'No Available Surgical Services', 'No Available Ultrasound Services', 'No Available X-Ray Services',
            'No Available Endoscopy Services', 'No Available Colonoscopy Services', 'No Available Mammogram Services',
            'No Available Patient Admission Services', 'No Available Admission Services',
            'No Animal Bite Center Services Beyond Operating Hours', 'No Safe Birthing Facility Services Beyond Operating Hours',
            'No Dental Services Beyond Operating Hours', 'No Dialysis Services Beyond Operating Hours',
            'No Laboratory Services Beyond Operating Hours', 'No Surgical Services Beyond Operating Hours',
            'No Ultrasound Services Beyond Operating Hours', 'No X-Ray Services Beyond Operating Hours',
            'No Endoscopy Services Beyond Operating Hours', 'No Colonoscopy Services Beyond Operating Hours',
            'No Mammogram Services Beyond Operating Hours'
        ],
        MEDICAL_PROCEDURE: [
            'No Available Chest Tube Thoracostomy'
        ]
    };

    function referralReasonCode(label) {
        return String(label || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100);
    }

    function referralReasonsText(data) {
        const reasons = Array.isArray(data?.referral_reasons) ? data.referral_reasons : [];
        if (!reasons.length) return data?.clinical_reason || data?.reason_text || data?.reason || 'Referral Request';
        return reasons.map((reason, index) => `${index === 0 || reason.is_primary ? 'Primary: ' : 'Additional: '}${reason.label || reason.text || reason.code}`).join(' • ');
    }

    function attachmentLinksHtml(referralId, attachments) {
        if (!Array.isArray(attachments) || !attachments.length) return '<p class="text-xs text-slate-400">No clinical attachments.</p>';
        return attachments.map(file => {
            const stage = file.attachment_type === 'CONSENT_FORM'
                ? 'Signed consent'
                : (file.workflow_stage === 'DEPARTURE' ? 'Departure result' : 'Referral document');
            return `<button type="button" class="btn-preview-referral-attachment w-full flex items-center justify-between gap-3 py-2 text-left text-sm text-blue-700 hover:underline border-b border-slate-100 last:border-0" data-referral-id="${escapeHtml(referralId)}" data-attachment-id="${escapeHtml(file.id)}" data-filename="${escapeHtml(file.original_filename || 'Attachment')}" data-mime-type="${escapeHtml(file.mime_type || '')}"><span><i class="bi bi-paperclip me-1"></i>${escapeHtml(file.original_filename || 'Attachment')}</span><span class="text-[10px] text-slate-400">${escapeHtml(stage)} · Preview</span></button>`;
        }).join('');
    }

    $(document).on('click', '.btn-preview-referral-attachment', function () {
        const referralId = String($(this).data('referral-id'));
        const attachmentId = String($(this).data('attachment-id'));
        const filename = String($(this).data('filename') || 'Attachment');
        const mimeType = String($(this).data('mime-type') || '');
        const baseUrl = `${API_BASE}/download_referral_attachment.php?referral_id=${encodeURIComponent(referralId)}&attachment_id=${encodeURIComponent(attachmentId)}`;
        const previewUrl = `${baseUrl}&preview=1`;
        const previewHtml = mimeType === 'application/pdf'
            ? `<iframe src="${previewUrl}" title="${escapeHtml(filename)}" class="w-full h-[65vh] rounded-lg border border-slate-200"></iframe>`
            : `<div class="flex justify-center bg-slate-100 rounded-lg p-3 max-h-[65vh] overflow-auto"><img src="${previewUrl}" alt="${escapeHtml(filename)}" class="max-w-full h-auto object-contain rounded"></div>`;

        Swal.fire({
            title: escapeHtml(filename),
            width: '64rem',
            html: `${previewHtml}<div class="mt-3 text-center"><a href="${baseUrl}" class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"><i class="bi bi-download"></i> Download File</a></div>`,
            confirmButtonText: 'Close',
            confirmButtonColor: '#64748b',
            customClass: { popup: 'rounded-3xl shadow-xl' }
        });
    });

    function populateAdditionalReferralReasonSelect($select) {
        $select.empty().append('<option value="" selected hidden disabled>select additional reason...</option>');
        Object.keys(REFERRAL_REASONS).forEach(category => {
            const $group = $('<optgroup>').attr('label', category.replaceAll('_', ' '));
            REFERRAL_REASONS[category].forEach(label => $('<option>').val(label).text(label).appendTo($group));
            $select.append($group);
        });
    }

    function getAdditionalReferralReasons() {
        if (!$('#enableAdditionalReasons').is(':checked')) return [];
        return $('.additional-reason-select').map(function () { return $(this).val(); }).get().filter(Boolean);
    }

    function resetAdditionalReferralReasons() {
        $('#enableAdditionalReasons').prop('checked', false);
        $('#additionalReasonsFields').addClass('hidden');
        $('.additional-reason-row').slice(1).remove();
        populateAdditionalReferralReasonSelect($('.additional-reason-select').first().val(''));
        $('#btnAddAdditionalReason').prop('disabled', false).removeClass('opacity-40 cursor-not-allowed');
    }

    populateAdditionalReferralReasonSelect($('.additional-reason-select').first());
    $('#enableAdditionalReasons').on('change', function () {
        $('#additionalReasonsFields').toggleClass('hidden', !this.checked);
        if (!this.checked) resetAdditionalReferralReasons();
    });
    $('#btnAddAdditionalReason').on('click', function () {
        const count = $('.additional-reason-row').length;
        if (count >= 3) return;
        const $row = $('<div class="additional-reason-row flex items-center gap-2 min-w-0"></div>');
        const $select = $('<select class="additional-reason-select flex-1 min-w-0 h-12 px-4 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 text-sm focus:bg-white focus:border-red-600 focus:ring-2 focus:ring-red-600/10 outline-none"></select>');
        populateAdditionalReferralReasonSelect($select);
        $row.append($select).append('<button type="button" class="btn-remove-additional-reason w-10 h-10 rounded-lg text-red-600 hover:bg-red-50" aria-label="Remove additional reason"><i class="bi bi-trash"></i></button>');
        $(this).before($row);
        if (count + 1 >= 3) $(this).prop('disabled', true).addClass('opacity-40 cursor-not-allowed');
    });
    $(document).on('click', '.btn-remove-additional-reason', function () {
        $(this).closest('.additional-reason-row').remove();
        $('#btnAddAdditionalReason').prop('disabled', false).removeClass('opacity-40 cursor-not-allowed');
    });

    function updateReasonDropdown() {
        const category = $('#modalReasonCategory').val();
        const $reasonSelect = $('#modalReasonSelect');

        $reasonSelect.empty().append('<option value="" selected disabled hidden>select a reason...</option>');

        if (!category) {
            $reasonSelect.prop('disabled', true);
            return;
        }

        if (category === 'OTHER') {
            $reasonSelect.prop('disabled', true);
            $('#modalReasonText').removeClass('hidden').val('');
            return;
        }

        $reasonSelect.prop('disabled', false);
        const reasons = REFERRAL_REASONS[category] || [];
        reasons.forEach(reason => {
            $reasonSelect.append(`<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`);
        });
    }

    $('#modalReasonCategory').on('change', updateReasonDropdown);

    $('#modalReasonSelect').on('change', function () {
        const selected = $(this).val();
        if (selected) {
            $('#modalReasonText').addClass('hidden').val(selected);
        }
    });

    /**
     * Reveal the free-text allergy details field only when "Has Allergy" is checked.
     */
    function toggleAllergyDetails() {
        if ($('#modalHasAllergy').is(':checked')) {
            $('#modalAllergyDetails').removeClass('hidden');
        } else {
            $('#modalAllergyDetails').addClass('hidden').val('');
        }
    }
    $('#modalHasAllergy').on('change', toggleAllergyDetails);

    // Shared invalid-field highlight, applied/cleared by the validation pass below
    // and by the live input/change listener that clears it once a field is fixed.
    const REQUIRED_FIELD_ERROR_CLASSES = 'border-red-600 ring-2 ring-red-600/20 bg-red-50/40';

    /**
     * Highlights every empty required field in the referral form in red (instead
     * of the browser's default one-at-a-time validation UI, which #referralForm's
     * novalidate attribute disables) and returns whether the form is valid overall.
     */
    function validateReferralForm(requireConsent = true) {
        let isValid = true;
        let $firstInvalid = null;

        function markField($field, invalid) {
            $field.toggleClass(REQUIRED_FIELD_ERROR_CLASSES, invalid);
            if (invalid) {
                isValid = false;
                if (!$firstInvalid) $firstInvalid = $field;
            }
        }

        // Generic required fields, excluding the hidden reason-text proxy -- that
        // one's handled specially below since it's not the control the user
        // actually sees/interacts with once a real (non-"Others") reason is picked.
        $('#referralForm [required]').not(':disabled').not('#modalReasonText').each(function () {
            const $field = $(this);
            markField($field, !String($field.val() || '').trim());
        });

        // Referral Reason: validate category first, then reason or free-text
        const categorySelected = $('#modalReasonCategory').val();
        if (!categorySelected) {
            markField($('#modalReasonCategory'), true);
        } else if (categorySelected === 'OTHER') {
            markField($('#modalReasonText'), !String($('#modalReasonText').val() || '').trim());
        } else {
            const reasonSelected = $('#modalReasonSelect').val();
            markField($('#modalReasonSelect'), !reasonSelected);
        }

        const additionalReasons = getAdditionalReferralReasons();
        const primaryReason = String($('#modalReasonText').val() || '').trim().toLowerCase();
        const normalizedAdditional = additionalReasons.map(reason => String(reason).trim().toLowerCase());
        if ($('#enableAdditionalReasons').is(':checked')) {
            $('.additional-reason-select').each(function () { markField($(this), !$(this).val()); });
            const invalidAdditional = additionalReasons.length > 3
                || normalizedAdditional.includes(primaryReason)
                || new Set(normalizedAdditional).size !== normalizedAdditional.length;
            if (invalidAdditional) {
                markField($('.additional-reason-select').first(), true);
            }
        }

        const files = Array.from($('#referralAttachments')[0]?.files || []);
        const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        markField(
            $('#referralAttachments'),
            files.length > 5 || files.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))
        );

        const consentFiles = Array.from($('#signedConsentForm')[0]?.files || []);
        markField(
            $('#signedConsentForm'),
            consentFiles.length > 1 || consentFiles.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))
        );
        if (requireConsent) {
            markField($('#paperConsentConfirmed'), !$('#paperConsentConfirmed').is(':checked'));
        }

        if ($firstInvalid) {
            $firstInvalid[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
            $firstInvalid.focus();
        }

        return isValid;
    }

    function printableValue(value) {
        const text = String(value || '').trim();
        return escapeHtml(text || '--');
    }

    function printReferralConsentForm() {
        if (!validateReferralForm(false)) {
            showToast('error', 'Complete the referral details before printing the consent form.', 3500);
            return;
        }

        const printWindow = window.open('', '_blank', 'width=900,height=1000');
        if (!printWindow) {
            showToast('error', 'The print window was blocked. Allow pop-ups for this site and try again.', 4500);
            return;
        }

        const primaryReason = $('#modalReasonText').val() || $('#modalReasonSelect').val();
        const reasons = [primaryReason, ...getAdditionalReferralReasons()].filter(Boolean);
        const severityText = $('#modalSeverity option:selected').text();
        const clinician = currentUser?.full_name || currentUser?.name || currentUser?.username || 'Clinical staff';
        const facility = currentHospital?.name || 'Referring facility';
        const address = $('#displayResolvedAddress').text();
        const bp = `${$('#modalVitalBpSystolic').val() || '--'}/${$('#modalVitalBpDiastolic').val() || '--'}`;
        const createdAt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
        const rows = reasons.map((reason, index) => `<li>${index === 0 ? '<strong>Primary:</strong> ' : ''}${printableValue(reason)}</li>`).join('');

        printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Referral Consent - ${printableValue($('#modalPatientName').text())}</title><style>
            @page { size: A4; margin: 14mm; }
            * { box-sizing: border-box; } body { font-family: Arial, sans-serif; color: #111827; margin: 0; font-size: 12px; line-height: 1.42; }
            h1 { font-size: 19px; margin: 0; } h2 { font-size: 13px; margin: 14px 0 6px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
            .header { display: flex; justify-content: space-between; gap: 20px; border-bottom: 2px solid #b91c1c; padding-bottom: 10px; }
            .draft { color: #b91c1c; font-weight: 700; text-align: right; } .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px 24px; }
            .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 9px; margin-top: 8px; }
            .label { color: #64748b; font-size: 10px; text-transform: uppercase; } ul { margin: 4px 0 0 18px; padding: 0; }
            .choice { margin: 9px 0; } .line { display: inline-block; min-width: 210px; border-bottom: 1px solid #111827; height: 18px; vertical-align: bottom; }
            .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 26px; } .sig { border-top: 1px solid #111827; padding-top: 4px; text-align: center; }
            .footer { margin-top: 15px; color: #64748b; font-size: 9px; } .no-print { margin-bottom: 10px; padding: 8px; background: #fef3c7; border: 1px solid #f59e0b; }
            @media print { .no-print { display: none; } }
        </style></head><body>
            <div class="no-print"><strong>Prototype draft.</strong> Review the form, then use the browser print dialog. This blank generated form is not stored automatically.</div>
            <div class="header"><div><h1>Patient Referral and Data-Sharing Consent</h1><div>${printableValue(facility)}</div></div><div class="draft">PROTOTYPE DRAFT<br><span style="font-weight:400;color:#475569">${printableValue(createdAt)}</span></div></div>
            <h2>Patient and referral details</h2><div class="grid">
                <div><span class="label">Patient</span><br><strong>${printableValue($('#modalPatientName').text())}</strong></div>
                <div><span class="label">Date of birth / Sex</span><br>${printableValue($('#modalPatientDob').text())} / ${printableValue($('#modalPatientGender').text())}</div>
                <div><span class="label">Phone</span><br>${printableValue($('#modalPatientPhone').text())}</div>
                <div><span class="label">Referral origin</span><br>${printableValue(address)}</div>
                <div><span class="label">Referring hospital</span><br>${printableValue(facility)}</div>
                <div><span class="label">Receiving hospital</span><br><strong>To be determined through IRDSS</strong></div>
            </div>
            <div class="box"><span class="label">Chief complaint / Diagnosis / Severity</span><br>${printableValue($('#modalChiefComplaint').val())} / ${printableValue($('#modalDiagnosis').val() || 'Not specified')} / ${printableValue(severityText)}<br><span class="label">Latest vital signs</span><br>BP ${printableValue(bp)} mmHg; HR ${printableValue($('#modalVitalHr').val())} bpm; RR ${printableValue($('#modalVitalRr').val())} br/min; Temp ${printableValue($('#modalVitalTemp').val())} C; O2 sat ${printableValue($('#modalVitalO2sat').val())}%</div>
            <div class="box"><span class="label">Referral reason(s)</span><ul>${rows}</ul></div>
            <h2>Consent</h2>
            <p>I have been informed why a referral is recommended and had an opportunity to ask questions. I understand that IRDSS may first share a limited clinical referral summary with candidate hospitals so they can evaluate capacity. My identity, complete clinical details, and protected attachments will be made available only to the hospital selected to receive the referral, except where disclosure is otherwise required or permitted by law.</p>
            <p>I authorize ${printableValue(facility)} and participating IRDSS facilities to collect, securely transmit, access, and use the information reasonably necessary to coordinate this referral and provide care. I understand that consent may be withdrawn before disclosure or processing where withdrawal is legally and operationally possible, without affecting processing already lawfully completed.</p>
            <div class="choice">[ ] Patient &nbsp;&nbsp; [ ] Parent/guardian &nbsp;&nbsp; [ ] Authorized representative &nbsp;&nbsp; [ ] Emergency exception documented by clinician</div>
            <div>Name of signer: <span class="line"></span> &nbsp; Relationship (if applicable): <span class="line" style="min-width:150px"></span></div>
            <div class="signature-grid"><div class="sig">Patient / authorized representative signature and date</div><div class="sig">Witness signature and date</div><div class="sig">Referring clinician: ${printableValue(clinician)}</div><div class="sig">Clinician signature and date</div></div>
            <div class="footer">Consent text version: referral-consent-2026-09-v1. This is a prototype template and must be reviewed and approved by participating hospitals, their legal/privacy teams, and Data Protection Officer before production use.</div>
        </body></html>`);
        printWindow.document.close();
        printWindow.focus();
        setTimeout(() => printWindow.print(), 250);
    }

    $('#btnPrintReferralConsent').on('click', printReferralConsentForm);

    // Clear the red highlight on a required field as soon as it's fixed, rather
    // than making the doctor resubmit to find out it's no longer invalid.
    // #modalReasonCategory and #modalReasonSelect are included even though they don't have [required] attributes --
    // they're flagged manually above since the real requirement lives on the reason dropdowns.
    $(document).on('input change', '#referralForm [required], #modalReasonCategory, #modalReasonSelect, .additional-reason-select, #referralAttachments, #signedConsentForm, #paperConsentConfirmed', function () {
        const $field = $(this);
        if (String($field.val() || '').trim()) {
            $field.removeClass(REQUIRED_FIELD_ERROR_CLASSES);
        }
    });

    /**
     * Handle Referral Form Submit
     */
    $('#referralForm').on('submit', function (e) {
        e.preventDefault();

        if (!validateReferralForm()) {
            showToast('error', 'Please fill in all required fields highlighted in red.', 3500);
            return;
        }

        const $submitBtn = $('#btnSubmitReferral');
        const originalBtnHtml = $submitBtn.html();

        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Transmitting...').prop('disabled', true);

        // BP is entered as two separate systolic/diastolic fields but sent to the
        // backend merged as a single "120/80" string, matching how it's stored and
        // displayed everywhere else (vital_bp).
        const bpSystolic = $('#modalVitalBpSystolic').val();
        const bpDiastolic = $('#modalVitalBpDiastolic').val();
        const vitalBp = (bpSystolic && bpDiastolic) ? `${bpSystolic}/${bpDiastolic}` : '';

        const primaryReason = $('#modalReasonText').val() || 'Severe Pneumonia';
        const additionalReasons = getAdditionalReferralReasons().map(label => ({
            code: referralReasonCode(label),
            label: label
        }));
        const formData = new FormData();
        const fields = {
            patient_id: parseInt($('#modalPatientId').val(), 10) || 1,
            latitude: parseFloat($('#modalLatitude').val()) || 7.1907,
            longitude: parseFloat($('#modalLongitude').val()) || 125.4553,
            severity: parseFloat($('#modalSeverity').val()) || 3,
            reason_text: primaryReason,
            reason_code: referralReasonCode(primaryReason),
            additional_reasons: JSON.stringify(additionalReasons),
            diagnosis: $('#modalDiagnosis').val() || 'Pneumonia',
            chief_complaint: $('#modalChiefComplaint').val() || '',
            vital_bp: vitalBp,
            vital_hr: $('#modalVitalHr').val() || '',
            vital_rr: $('#modalVitalRr').val() || '',
            vital_temp_c: $('#modalVitalTemp').val() || '',
            vital_o2sat: $('#modalVitalO2sat').val() || '',
            vital_height_cm: $('#modalVitalHeight').val() || '',
            vital_weight_kg: $('#modalVitalWeight').val() || '',
            is_pwd: $('#modalIsPwd').is(':checked') ? 1 : 0,
            is_pregnant: $('#modalIsPregnant').is(':checked') ? 1 : 0,
            is_senior_citizen: $('#modalIsSeniorCitizen').is(':checked') ? 1 : 0,
            has_allergy: $('#modalHasAllergy').is(':checked') ? 1 : 0,
            allergy_details: $('#modalHasAllergy').is(':checked') ? ($('#modalAllergyDetails').val() || '') : '',
            consent_status: 'GRANTED',
            consent_method: 'PAPER',
            consent_text_version: 'referral-consent-2026-09-v1',
            consent_recorded_at: new Date().toISOString(),
            consent_witnessed_by: currentUser?.full_name || currentUser?.name || currentUser?.username || 'Clinical staff'
        };
        Object.entries(fields).forEach(([key, value]) => formData.append(key, value));
        Array.from($('#referralAttachments')[0]?.files || []).forEach(file => formData.append('referral_attachments[]', file));
        const signedConsentFile = $('#signedConsentForm')[0]?.files?.[0];
        if (signedConsentFile) formData.append('signed_consent_form', signedConsentFile);

        $.ajax({
            url: `${API_BASE}/send_referral.php`,
            type: 'POST',
            data: formData,
            processData: false,
            contentType: false,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                if (response.success) {
                    switchTab('patients');
                    // switchTab() only handles the UI/tab-switch -- it doesn't refresh
                    // table data (unlike switchTab('referrals'), which does). Without
                    // this, a patient just re-referred onward would still show the
                    // stale pre-referral state (e.g. "Mark as Out") until a manual
                    // refresh, even though the table underneath it just changed.
                    loadPatients();
                    let refId = response.referral_id || null;
                    if (!refId && response.iol_response) {
                        if (typeof response.iol_response === 'object') {
                            refId = response.iol_response.referral_id || response.iol_response.referral_tracking_id || response.iol_response.id || (response.iol_response.data && (response.iol_response.data.referral_id || response.iol_response.data.id));
                        }
                    }
                    if (!refId && response.iol_response) {
                        const str = typeof response.iol_response === 'object' ? JSON.stringify(response.iol_response) : String(response.iol_response);
                        const match = str.match(/ref_[a-zA-Z0-9_\-]+/i);
                        if (match) refId = match[0];
                    }

                    const patientName = $('#modalPatientName').text() || 'Patient';

                    if (refId) {
                        const activeRefData = { id: refId, patientName: patientName, status: 'AWAITING' };
                        window.activeInitiatedReferralId = refId;
                        try {
                            localStorage.setItem('active_initiated_referral', JSON.stringify(activeRefData));
                        } catch(e) {}
                        checkAndPollRecommendations();
                    }

                    Swal.fire({
                        icon: 'success',
                        title: 'Referral Transmitted Successfully!',
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">The referral payload has been successfully compiled and transmitted to the Interoperability Layer (IOL).</p>
                            <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #dbeafe; color: #1e3a8a; border-color: #bfdbfe;">
                                <div class="flex items-start gap-2.5">
                                    <i class="bi bi-info-circle-fill text-red-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                                    <span class="text-xs font-semibold leading-relaxed">Please wait for receiving hospitals to accept your referral. Accepting facilities will appear on the "My Referrals" page.${response.attachment_warning ? '<br><span class="text-amber-700">' + escapeHtml(response.attachment_warning) + '</span>' : ''}</span>
                                </div>
                            </div>
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Got it',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                } else {
                    const status = response.http_status || 500;
                    const errorMsg = escapeHtml(cleanErrorMessage(response.message || "Referral process failed.", status));

                    Swal.fire({
                        icon: 'error',
                        title: 'Unable to submit this referral.',
                        html: `${buildErrorNoteHtml(errorMsg, status)}`,
                        confirmButtonText: 'OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            },
            error: function (xhr) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                const status = xhr.status || 500;
                const errData = xhr.responseJSON || {};
                const rawMsg = errData.message || errData.detail || `HTTP ${status} Server Error`;
                const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, status));

                Swal.fire({
                    icon: 'error',
                    title: 'Unable to submit this referral.',
                    html: `${buildErrorNoteHtml(errorMsg, status)}`,
                    confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            }
        });
    });

    /**
     * Copy API Key to Clipboard
     */
    $('#btnCopyApiKey').on('click', function () {
        const apiKeyText = $('#displayApiKey').text();
        navigator.clipboard.writeText(apiKeyText).then(function () {
            showToast('success', 'API Key copied to clipboard!', 2000);
        });
    });

    /**
     * Refresh button events
     */
    $('#btnRefreshPatients').on('click', function () {
        loadPatients();
    });

    $(document).on('click', '#btnRefreshRecommendations', function () {
        checkAndPollRecommendations();
    });

    $(document).on('click', '#btnRefreshAcceptedPatients', function () {
        loadAcceptedPatients();
    });

    /**
     * Load referrals finalized to this facility via GET /api/v1/referral/outcomes,
     * filtered to CHOSEN -- these are the only ones eligible for the full patient
     * details reveal (GET .../patient-details is gated the same way server-side).
     */
    const DEPARTURE_OUTCOME_LABEL = {
        DISCHARGED: 'Discharged',
        TRANSFERRED: 'Transferred',
        DECEASED: 'Deceased',
        LEFT_AMA: 'Left AMA'
    };

    function loadAcceptedPatients() {
        const isClinicalUser = currentUser && (currentUser.role === 'doctor' || currentUser.role === 'nurse');
        if (!currentHospital || !isClinicalUser) return;

        const $list = $('#acceptedPatientsList');

        $.when(
            $.ajax({ url: `${API_BASE}/get_referral_outcomes.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_onward_referred_referral_ids.php`, type: 'GET', dataType: 'json' })
        ).done(function (outcomesRes, onwardRes) {
            const data = outcomesRes[0];
            const onwardData = onwardRes[0];
            // Referral IDs already referred onward through the system -- these should
            // never offer "Mark as Out" too, since the two facts would contradict each
            // other (mark_patient_departed.php enforces this server-side either way).
            const onwardReferredIds = new Set(
                (onwardData && onwardData.success && Array.isArray(onwardData.data)) ? onwardData.data : []
            );

            const all = Array.isArray(data) ? data : [];
            const chosen = all.filter(o => o.outcome === 'CHOSEN');
            const bypassed = all.filter(o => o.outcome === 'BYPASSED');
            // Discharged is its own count, not lumped with Deceased/Left AMA -- those
            // are meaningfully different outcomes and collapsing them would hide it.
            // Mutually exclusive with "referred onward" by design: mark_patient_departed.php
            // already refuses to record a departure once a patient's been referred onward.
            const dischargedCount = chosen.filter(o => o.departure_outcome === 'DISCHARGED').length;
            const referredOnwardCount = chosen.filter(o => onwardReferredIds.has(o.referral_id)).length;

            $('#statTransferredToUs').text(chosen.length);
            $('#statRedirectedElsewhere').text(bypassed.length);
            $('#statDischarged').text(dischargedCount);
            $('#statReferredOnward').text(referredOnwardCount);

            if (chosen.length === 0) {
                $list.html('<div class="px-6 py-6 text-center text-xs text-slate-400">No finalized referrals yet.</div>');
                return;
            }

            $list.html(chosen.map(function (o) {
                const arrivalControl = o.arrived_at
                    ? `<span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200">
                           <i class="bi bi-check-circle-fill"></i> Arrived ${formatReferralTimestamp(o.arrived_at)}
                       </span>`
                    : `<button type="button" data-referral-id="${escapeHtml(o.referral_id)}"
                           class="btn-mark-arrived inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-all">
                           <i class="bi bi-box-arrow-in-down"></i> Mark as Arrived
                       </button>`;

                let departureControl = '';
                if (o.arrived_at) {
                    if (o.departed_at) {
                        const label = DEPARTURE_OUTCOME_LABEL[o.departure_outcome] || o.departure_outcome || 'Out';
                        departureControl = `
                            <span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200">
                                <i class="bi bi-box-arrow-right"></i> ${escapeHtml(label)} ${formatReferralTimestamp(o.departed_at)}
                            </span>`;
                    } else if (onwardReferredIds.has(o.referral_id)) {
                        departureControl = `
                            <span class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-200">
                                <i class="bi bi-arrow-right-circle"></i> Referred Onward
                            </span>`;
                    } else {
                        departureControl = `
                            <button type="button" data-referral-id="${escapeHtml(o.referral_id)}"
                                class="btn-mark-departed inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-600 hover:bg-slate-700 text-white text-xs font-semibold transition-all">
                                <i class="bi bi-box-arrow-right"></i> Mark as Out
                            </button>`;
                    }
                }

                return `
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-semibold text-slate-900">${escapeHtml(o.clinical_reason || 'Referral')}</p>
                            <p class="text-xs text-slate-500 mt-0.5 break-words">From <strong>${escapeHtml(o.referring_facility)}</strong></p>
                            <p class="text-xs text-slate-500 mt-0.5">${formatReferralTimestamp(o.created_at)}</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2 flex-shrink-0">
                            ${arrivalControl}
                            ${departureControl}
                            <button type="button" data-referral-id="${escapeHtml(o.referral_id)}"
                                class="btn-view-patient-details inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all">
                                <i class="bi bi-person-lines-fill"></i> View Full Patient Details
                            </button>
                        </div>
                    </div>
                `;
            }).join(''));
        }).fail(function () {
            $list.html('<div class="px-6 py-6 text-center text-xs text-red-500">Could not load finalized referrals.</div>');
        });
    }

    /**
     * Facility Admin Analytics tab -- reuses the same two endpoints Incoming Patients
     * uses for its outcome counters (so the numbers can never drift apart between the
     * doctor/nurse view and the admin view), plus a dedicated aggregation endpoint for
     * top reasons/senders/receivers and monthly referral volume.
     */
    let analyticsCharts = {};
    let latestAnalyticsExport = null;

    function loadFacilityAnalytics() {
        if (!currentUser || currentUser.role !== 'facility_admin') return;

        const startDate = $('#analyticsStartDate').val();
        const endDate = $('#analyticsEndDate').val();
        if (startDate && endDate && startDate > endDate) {
            showToast('error', 'Start date must be on or before end date.', 3500);
            return;
        }

        const analyticsQuery = {};
        if (startDate) analyticsQuery.start_date = startDate;
        if (endDate) analyticsQuery.end_date = endDate;

        $('#btnApplyAnalyticsDates, #btnClearAnalyticsDates').prop('disabled', true);
        $('#btnExportAnalyticsCsv').prop('disabled', true);

        $.when(
            $.ajax({ url: `${API_BASE}/get_referral_outcomes.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_onward_referred_referral_ids.php`, type: 'GET', dataType: 'json' }),
            $.ajax({ url: `${API_BASE}/get_facility_analytics.php`, type: 'GET', data: analyticsQuery, dataType: 'json' })
        ).done(function (outcomesRes, onwardRes, analyticsRes) {
            const allOutcomes = Array.isArray(outcomesRes[0]) ? outcomesRes[0] : [];
            const outcomes = allOutcomes.filter(outcome => {
                if (!startDate && !endDate) return true;
                const createdDate = String(outcome.created_at || '').slice(0, 10);
                if (!createdDate) return false;
                return (!startDate || createdDate >= startDate) && (!endDate || createdDate <= endDate);
            });
            const onwardData = onwardRes[0];
            const onwardReferredIds = new Set(
                (onwardData && onwardData.success && Array.isArray(onwardData.data)) ? onwardData.data : []
            );

            const chosen = outcomes.filter(o => o.outcome === 'CHOSEN');
            const bypassed = outcomes.filter(o => o.outcome === 'BYPASSED');
            const dischargedCount = chosen.filter(o => o.departure_outcome === 'DISCHARGED').length;
            const referredOnwardCount = chosen.filter(o => onwardReferredIds.has(o.referral_id)).length;

            $('#analyticsStatTransferredToUs').text(chosen.length);
            $('#analyticsStatRedirectedElsewhere').text(bypassed.length);
            $('#analyticsStatDischarged').text(dischargedCount);
            $('#analyticsStatReferredOnward').text(referredOnwardCount);

            const analytics = (analyticsRes[0] && typeof analyticsRes[0] === 'object') ? analyticsRes[0] : {};
            renderAnalyticsCharts(analytics);
            updateAnalyticsPeriodLabel(startDate, endDate);
            latestAnalyticsExport = {
                analytics,
                period: { startDate, endDate },
                counters: {
                    transferredToUs: chosen.length,
                    redirectedElsewhere: bypassed.length,
                    discharged: dischargedCount,
                    referredOnward: referredOnwardCount
                }
            };
            $('#btnExportAnalyticsCsv').prop('disabled', false);
        }).fail(function () {
            showToast('error', 'Could not load facility analytics.', 3500);
            latestAnalyticsExport = null;
        }).always(function () {
            $('#btnApplyAnalyticsDates, #btnClearAnalyticsDates').prop('disabled', false);
        });
    }

    function updateAnalyticsPeriodLabel(startDate, endDate) {
        const formatDate = value => new Intl.DateTimeFormat('en-PH', {
            year: 'numeric', month: 'short', day: 'numeric'
        }).format(new Date(`${value}T00:00:00`));

        let label = 'Showing all available referral history';
        let shortLabel = 'all-time';
        if (startDate && endDate) {
            label = `Showing ${formatDate(startDate)} to ${formatDate(endDate)}`;
            shortLabel = `${formatDate(startDate)} to ${formatDate(endDate)}`;
        } else if (startDate) {
            label = `Showing referrals from ${formatDate(startDate)} onward`;
            shortLabel = `from ${formatDate(startDate)}`;
        } else if (endDate) {
            label = `Showing referrals through ${formatDate(endDate)}`;
            shortLabel = `through ${formatDate(endDate)}`;
        }

        $('#analyticsPeriodLabel').text(label);
        $('#analyticsVolumeSubtitle').text(`Referrals sent by your facility vs. referrals received, by month, ${shortLabel}`);
    }

    function exportFacilityAnalyticsCsv() {
        if (!latestAnalyticsExport) return;

        const { analytics, period, counters } = latestAnalyticsExport;
        const monthly = Array.isArray(analytics.monthly_volume) ? analytics.monthly_volume : [];
        const reasons = Array.isArray(analytics.top_reasons) ? analytics.top_reasons : [];
        const incomingReasons = Array.isArray(analytics.top_incoming_reasons) ? analytics.top_incoming_reasons : [];
        const senders = Array.isArray(analytics.top_senders) ? analytics.top_senders : [];
        const receivers = Array.isArray(analytics.top_receivers) ? analytics.top_receivers : [];
        const rows = [
            ['Facility Analytics Report'],
            ['Start date', period.startDate || 'All time'],
            ['End date', period.endDate || 'All time'],
            [],
            ['Outcome', 'Count'],
            ['Transferred To Us', counters.transferredToUs],
            ['Accepted But Sent Elsewhere', counters.redirectedElsewhere],
            ['Discharged', counters.discharged],
            ['Referred Onward', counters.referredOnward],
            [],
            ['Monthly Referral Volume'],
            ['Month', 'Sent', 'Received'],
            ...monthly.map(row => [row.month, row.sent, row.received]),
            [],
            ['Top Reasons You Refer Out'],
            ['Rank', 'Reason', 'Count'],
            ...reasons.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Reasons Patients Are Referred to You'],
            ['Rank', 'Reason', 'Count'],
            ...incomingReasons.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Facilities Sending To You'],
            ['Rank', 'Facility', 'Count'],
            ...senders.map((row, index) => [index + 1, row.label, row.count]),
            [],
            ['Top Facilities You Refer To'],
            ['Rank', 'Facility', 'Count'],
            ...receivers.map((row, index) => [index + 1, row.label, row.count])
        ];

        const csvCell = value => {
            let text = String(value ?? '');
            // Prevent spreadsheet applications from treating labels as formulas.
            if (/^[=+\-@]/.test(text)) text = `'${text}`;
            return `"${text.replace(/"/g, '""')}"`;
        };
        const csv = '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const suffix = period.startDate || period.endDate
            ? `${period.startDate || 'beginning'}_to_${period.endDate || 'present'}`
            : 'all_time';
        link.href = url;
        link.download = `facility_analytics_${suffix}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function renderAnalyticsCharts(analytics) {
        const monthly = Array.isArray(analytics.monthly_volume) ? analytics.monthly_volume : [];
        const reasons = Array.isArray(analytics.top_reasons) ? analytics.top_reasons : [];
        const incomingReasons = Array.isArray(analytics.top_incoming_reasons) ? analytics.top_incoming_reasons : [];
        const senders = Array.isArray(analytics.top_senders) ? analytics.top_senders : [];
        const receivers = Array.isArray(analytics.top_receivers) ? analytics.top_receivers : [];

        $('#analyticsVolumeEmpty').toggle(monthly.length === 0);
        $('#analyticsReasonsEmpty').toggle(reasons.length === 0);
        $('#analyticsIncomingReasonsEmpty').toggle(incomingReasons.length === 0);
        $('#analyticsSendersEmpty').toggle(senders.length === 0);
        $('#analyticsReceiversEmpty').toggle(receivers.length === 0);
        $('#analyticsReasonsChartWrap').toggle(reasons.length > 0);
        $('#analyticsIncomingReasonsChartWrap').toggle(incomingReasons.length > 0);
        $('#analyticsSendersChartWrap').toggle(senders.length > 0);
        $('#analyticsReceiversChartWrap').toggle(receivers.length > 0);

        Object.values(analyticsCharts).forEach(chart => chart && chart.destroy());
        analyticsCharts = {};

        if (monthly.length && typeof Chart !== 'undefined') {
            analyticsCharts.volume = new Chart($('#analyticsVolumeChart')[0], {
                type: 'line',
                data: {
                    labels: monthly.map(m => m.month),
                    datasets: [
                        { label: 'Sent', data: monthly.map(m => m.sent), borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', tension: 0.3, fill: true },
                        { label: 'Received', data: monthly.map(m => m.received), borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,0.1)', tension: 0.3, fill: true }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
                }
            });
        }

        renderAnalyticsDoughnut('reasons', '#analyticsReasonsChart', reasons, ['#9333ea', '#a855f7', '#c084fc', '#d8b4fe', '#e9d5ff']);
        renderAnalyticsDoughnut('incomingReasons', '#analyticsIncomingReasonsChart', incomingReasons, ['#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe']);
        renderAnalyticsDoughnut('senders', '#analyticsSendersChart', senders, ['#059669', '#10b981', '#34d399', '#6ee7b7', '#a7f3d0']);
        renderAnalyticsDoughnut('receivers', '#analyticsReceiversChart', receivers, ['#d97706', '#f59e0b', '#fbbf24', '#fcd34d', '#fde68a']);
    }

    function renderAnalyticsDoughnut(chartKey, canvasSelector, rows, colors) {
        if (!rows.length || typeof Chart === 'undefined') return;

        const visibleRows = rows.slice(0, 5);
        analyticsCharts[chartKey] = new Chart($(canvasSelector)[0], {
            type: 'doughnut',
            data: {
                labels: visibleRows.map(row => row.label),
                datasets: [{
                    data: visibleRows.map(row => row.count),
                    backgroundColor: colors,
                    borderColor: '#ffffff',
                    borderWidth: 3,
                    hoverOffset: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '58%',
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            boxWidth: 12,
                            boxHeight: 12,
                            padding: 14,
                            usePointStyle: true,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: context => `${context.label}: ${context.parsed}`
                        }
                    }
                }
            }
        });
    }

    /**
     * Facility Admin System Logs tab -- reads the local audit_logs table (never
     * proxied through IOL, since IOL only authenticates at the facility level and
     * has no concept of individual staff users).
     */
    const AUDIT_ACTION_LABEL = {
        REFERRAL_SENT: { text: 'Sent Referral', badge: 'bg-red-50 text-red-700' },
        REFERRAL_ACCEPTED: { text: 'Accepted Referral', badge: 'bg-emerald-50 text-emerald-700' },
        REFERRAL_REJECTED: { text: 'Rejected Referral', badge: 'bg-slate-100 text-slate-700' },
        REFERRAL_FINALIZED: { text: 'Finalized Referral', badge: 'bg-indigo-50 text-indigo-700' },
        REFERRAL_CANCELLED: { text: 'Cancelled Referral', badge: 'bg-rose-50 text-rose-700' },
        PATIENT_ARRIVED: { text: 'Marked Arrived', badge: 'bg-amber-50 text-amber-700' },
        PATIENT_ARRIVED_LINKED: { text: 'Linked Arrival to Existing Patient', badge: 'bg-teal-50 text-teal-700' },
        PATIENT_DEPARTED: { text: 'Marked Departed', badge: 'bg-purple-50 text-purple-700' },
        PATIENT_ADDED: { text: 'Added Patient', badge: 'bg-sky-50 text-sky-700' }
    };

    function loadSystemLogs() {
        const $tableBody = $('#logsTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="7" class="text-center py-8 text-slate-400 font-normal">
                    <div class="inline-block animate-spin rounded-full h-5 w-5 border-2 border-red-600 border-t-transparent mr-2"></div>
                    Loading activity log...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/get_audit_logs.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.success && Array.isArray(response.data)) {
                    renderLogsTable(response.data);
                } else {
                    $tableBody.html(`
                        <tr>
                            <td colspan="7" class="text-center py-8 text-red-500 font-normal">
                                <i class="bi bi-exclamation-triangle-fill me-1"></i>
                                ${response.message || 'Failed to load activity log.'}
                            </td>
                        </tr>
                    `);
                }
            },
            error: function () {
                $tableBody.html(`
                    <tr>
                        <td colspan="7" class="text-center py-8 text-red-500 font-normal">
                            <i class="bi bi-wifi-off me-1"></i>
                            Error connecting to backend API.
                        </td>
                    </tr>
                `);
            }
        });
    }

    function renderLogsTable(logs) {
        if ($.fn.DataTable.isDataTable('#logsTable')) {
            $('#logsTable').DataTable().destroy();
        }

        const $tableBody = $('#logsTableBody');
        $tableBody.empty();

        if (logs.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="7" class="text-center py-8 text-slate-400 font-normal">
                        No activity recorded yet.
                    </td>
                </tr>
            `);
            return;
        }

        logs.forEach(function (log) {
            const meta = AUDIT_ACTION_LABEL[log.action] || { text: log.action, badge: 'bg-slate-100 text-slate-700' };
            const row = `
                <tr class="hover:bg-slate-100/60 transition-colors">
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${formatReferralTimestamp(log.created_at)}</td>
                    <td class="py-3.5 px-6 text-xs font-medium text-slate-800 border-b border-slate-200/70">${escapeHtml(log.user_full_name)}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-500 capitalize border-b border-slate-200/70">${escapeHtml(log.user_role)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-200/70"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${meta.badge}">${escapeHtml(meta.text)}</span></td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${log.patient_name ? escapeHtml(log.patient_name) : '—'}</td>
                    <td class="py-3.5 px-6 text-xs font-mono text-slate-500 border-b border-slate-200/70">${log.referral_id ? escapeHtml(log.referral_id) : '—'}</td>
                    <td class="py-3.5 px-6 text-xs text-slate-600 border-b border-slate-200/70">${log.details ? escapeHtml(log.details) : '—'}</td>
                </tr>
            `;
            $tableBody.append(row);
        });

        $('#logsTable').DataTable({
            paging: true,
            searching: true,
            ordering: true,
            // order: [] -- logs already arrive newest-first from the backend; without
            // this DataTables would silently re-sort by column 0 on render (same
            // gotcha as the referrals table).
            order: [],
            info: true,
            responsive: true,
            pageLength: 15,
            lengthMenu: [15, 25, 50, 100],
            language: {
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ activity entries",
                search: "Search:"
            }
        });
    }

    $(document).on('click', '.btn-mark-arrived', function () {
        const $btn = $(this);
        const referralId = $btn.data('referral-id');
        const originalHtml = $btn.html();

        Swal.fire({
            icon: 'question',
            title: 'Mark Patient as Arrived',
            html: `
                <p class="text-sm text-slate-600 mb-4 text-start">Confirms the patient has physically arrived at your facility. Optionally record vitals taken on arrival -- a patient's condition can change during transport, so this is kept separate from the referring facility's readings.</p>
                <div class="grid grid-cols-2 gap-3 text-start">
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">BP (mmHg)</label>
                        <input type="text" id="arrivalVitalBp" placeholder="120/80" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">HR (bpm)</label>
                        <input type="number" min="0" id="arrivalVitalHr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">RR (br/min)</label>
                        <input type="number" min="0" id="arrivalVitalRr" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Temp (°C)</label>
                        <input type="text" id="arrivalVitalTemp" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-500">
                    </div>
                    <div class="col-span-2">
                        <label class="block text-xs font-semibold text-slate-500 mb-1">O2 Sat (%)</label>
                        <input type="number" min="0" max="100" id="arrivalVitalO2sat" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-amber-500">
                    </div>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Mark as Arrived',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#f59e0b',
            reverseButtons: true,
            focusConfirm: false,
            preConfirm: function () {
                return {
                    arrival_vital_bp: $('#arrivalVitalBp').val() || '',
                    arrival_vital_hr: $('#arrivalVitalHr').val() || '',
                    arrival_vital_rr: $('#arrivalVitalRr').val() || '',
                    arrival_vital_temp_c: $('#arrivalVitalTemp').val() || '',
                    arrival_vital_o2sat: $('#arrivalVitalO2sat').val() || ''
                };
            }
        }).then(function (result) {
            if (!result.isConfirmed) return;
            submitMarkArrived($btn, referralId, originalHtml, result.value);
        });
    });

    function submitMarkArrived($btn, referralId, originalHtml, arrivalVitals) {
        $btn.prop('disabled', true).html('<span class="inline-block animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span> Marking...');

        $.ajax({
            url: `${API_BASE}/receive_transferred_patient.php`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify(Object.assign({ referral_id: referralId }, arrivalVitals || {})),
            dataType: 'json',
            success: function (response) {
                if (response.success) {
                    showToast('success', response.message || 'Patient marked as arrived.', 3000);
                    loadAcceptedPatients();
                    if (typeof loadPatients === 'function') loadPatients();
                } else if (response.possible_duplicate) {
                    const ep = response.existing_patient;
                    Swal.fire({
                        icon: 'warning',
                        title: 'Possible Existing Patient',
                        html: `<p class="text-sm text-slate-600 text-start">A patient named <strong>${ep.full_name}</strong> (DOB ${ep.dob}) is already on file at your facility, registered ${formatDateTime12h(ep.registered_at)}. Link this arrival to that record, or create a new one?</p>`,
                        showDenyButton: true,
                        showCancelButton: true,
                        confirmButtonText: 'Link to Existing',
                        denyButtonText: 'Create New Anyway',
                        cancelButtonText: 'Cancel',
                        confirmButtonColor: '#16a34a',
                        denyButtonColor: '#f59e0b',
                        reverseButtons: true
                    }).then(function (choice) {
                        if (choice.isConfirmed) {
                            submitMarkArrived($btn, referralId, originalHtml, Object.assign({}, arrivalVitals, { duplicate_choice: 'link', link_patient_id: ep.id }));
                        } else if (choice.isDenied) {
                            submitMarkArrived($btn, referralId, originalHtml, Object.assign({}, arrivalVitals, { duplicate_choice: 'new' }));
                        } else {
                            $btn.prop('disabled', false).html(originalHtml);
                        }
                    });
                } else {
                    $btn.prop('disabled', false).html(originalHtml);
                    Swal.fire({ icon: 'error', title: 'Could Not Mark as Arrived', text: response.message, confirmButtonColor: '#dc3545' });
                }
            },
            error: function (xhr) {
                $btn.prop('disabled', false).html(originalHtml);
                const errData = xhr.responseJSON || {};
                Swal.fire({
                    icon: 'error',
                    title: 'Could Not Mark as Arrived',
                    text: errData.message || `Request failed (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    }

    /**
     * Marks the end of this facility's episode of care for a transferred-in patient
     * (discharged, transferred onward, deceased, or left against medical advice) so
     * the original referring hospital's tracker doesn't go dark after "Arrived".
     */
    function uploadDepartureAttachments(referralId, attachmentType, files) {
        const uploads = Array.from(files || []).map(file => {
            const body = new FormData();
            body.append('referral_id', referralId);
            body.append('workflow_stage', 'DEPARTURE');
            body.append('attachment_type', attachmentType);
            body.append('attachment', file);
            return $.ajax({ url: `${API_BASE}/upload_referral_attachment.php`, type: 'POST', data: body, processData: false, contentType: false, dataType: 'json' });
        });
        return Promise.allSettled(uploads);
    }

    $(document).on('click', '.btn-mark-departed', function () {
        const $btn = $(this);
        const referralId = $btn.data('referral-id');
        const originalHtml = $btn.html();

        Swal.fire({
            icon: 'question',
            title: 'Mark Patient as Out',
            html: `
                <div class="text-start">
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Outcome</label>
                    <select id="departureOutcome" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-500 mb-3">
                        <option value="DISCHARGED">Discharged</option>
                        <option value="TRANSFERRED">Referred to Another Facility</option>
                        <option value="LEFT_AMA">Left Against Medical Advice</option>
                        <option value="DECEASED">Deceased</option>
                    </select>
                    <div id="departureRemarksWrap">
                        <label class="block text-xs font-semibold text-slate-500 mb-1">Remarks (optional)</label>
                        <textarea id="departureRemarks" rows="3" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-slate-500" placeholder="Any additional notes..."></textarea>
                        <label class="block text-xs font-semibold text-slate-500 mt-3 mb-1">Clinical result type (optional)</label>
                        <select id="departureAttachmentType" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm mb-2">
                            <option value="DISCHARGE_SUMMARY">Discharge Summary</option><option value="LAB_RESULT">Laboratory Result</option><option value="XRAY">X-ray / Imaging</option><option value="PRESCRIPTION">Prescription</option><option value="OTHER">Other Clinical Document</option>
                        </select>
                        <input id="departureAttachments" type="file" multiple accept="application/pdf,image/jpeg,image/png" class="block w-full text-xs text-slate-600">
                        <p class="text-[10px] text-slate-400 mt-1">Up to 5 PDF, JPEG, or PNG files; maximum 5 MB each.</p>
                    </div>
                    <p id="departureTransferNote" class="text-xs text-slate-500 mt-2 hidden">This opens the Refer Patient form for this patient instead of just saving a note -- actually referring them is what notifies the original hospital.</p>
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Confirm',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#475569',
            reverseButtons: true,
            focusConfirm: false,
            didOpen: function () {
                $('#departureOutcome').on('change', function () {
                    const isTransfer = $(this).val() === 'TRANSFERRED';
                    $('#departureRemarksWrap').toggleClass('hidden', isTransfer);
                    $('#departureTransferNote').toggleClass('hidden', !isTransfer);
                });
            },
            preConfirm: function () {
                const files = Array.from($('#departureAttachments')[0]?.files || []);
                const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
                if (files.length > 5 || files.some(file => file.size > 5 * 1024 * 1024 || !allowedTypes.includes(file.type))) {
                    return Swal.showValidationMessage('Choose up to 5 valid PDF, JPEG, or PNG files, no larger than 5 MB each.');
                }
                return {
                    outcome: $('#departureOutcome').val(),
                    remarks: $('#departureRemarks').val() || '',
                    attachment_type: $('#departureAttachmentType').val(),
                    attachment_files: files
                };
            }
        }).then(function (result) {
            if (!result.isConfirmed) return;

            // "Referred to Another Facility" isn't a standalone note -- it IS a real
            // referral. Send the doctor straight into the Refer Patient form for this
            // same local patient record instead of recording a redundant label that
            // wouldn't actually notify the original referring hospital.
            if (result.value.outcome === 'TRANSFERRED') {
                $.ajax({
                    url: `${API_BASE}/get_transferred_patient_details.php?referral_id=${encodeURIComponent(referralId)}`,
                    type: 'GET',
                    dataType: 'json',
                    success: function (d) {
                        if (d && d.local_patient_id) {
                            // Prefer arrival vitals (more recent) over the original
                            // referral-time vitals when both exist; either way, flagged
                            // as "last recorded" in the form rather than treated as current.
                            const clinicalData = {
                                vital_bp: d.arrival_vital_bp || d.vital_bp || '',
                                vital_hr: d.arrival_vital_hr || d.vital_hr || '',
                                vital_rr: d.arrival_vital_rr || d.vital_rr || '',
                                vital_temp_c: d.arrival_vital_temp_c || d.vital_temp_c || '',
                                vital_o2sat: d.arrival_vital_o2sat || d.vital_o2sat || '',
                                vital_height_cm: d.vital_height_cm || '',
                                vital_weight_kg: d.vital_weight_kg || '',
                                is_pwd: !!d.is_pwd,
                                is_pregnant: !!d.is_pregnant,
                                is_senior_citizen: !!d.is_senior_citizen,
                                has_allergy: !!d.has_allergy,
                                allergy_details: d.allergy_details || '',
                                disease_severity: d.disease_severity || '',
                                vitalsAsOf: d.arrived_at || null
                            };
                            openReferralFormForPatientId(d.local_patient_id, null, clinicalData);
                        } else {
                            Swal.fire({ icon: 'error', title: 'Error', text: "Could not find this patient's local record.", confirmButtonColor: '#dc3545' });
                        }
                    },
                    error: function () {
                        Swal.fire({ icon: 'error', title: 'Error', text: "Could not look up this patient's local record.", confirmButtonColor: '#dc3545' });
                    }
                });
                return;
            }

            $btn.prop('disabled', true).html('<span class="inline-block animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span> Saving...');

            const departureFiles = result.value.attachment_files || [];
            const departureAttachmentType = result.value.attachment_type || 'OTHER';
            const departurePayload = { outcome: result.value.outcome, remarks: result.value.remarks };

            $.ajax({
                url: `${API_BASE}/mark_patient_departed.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify(Object.assign({ referral_id: referralId }, departurePayload)),
                dataType: 'json',
                success: function (response) {
                    if (response.success) {
                        if (departureFiles.length) {
                            uploadDepartureAttachments(referralId, departureAttachmentType, departureFiles).then(results => {
                                const failed = results.filter(item => item.status === 'rejected').length;
                                showToast(failed ? 'warning' : 'success', failed ? `Departure saved, but ${failed} attachment(s) failed to upload.` : `Departure saved with ${departureFiles.length} attachment(s).`, 4000);
                            });
                        } else {
                            showToast('success', response.message || 'Patient departure recorded.', 3000);
                        }
                        loadAcceptedPatients();
                        if (typeof loadPatients === 'function') loadPatients();
                    } else {
                        $btn.prop('disabled', false).html(originalHtml);
                        Swal.fire({ icon: 'error', title: 'Could Not Record Departure', text: response.message, confirmButtonColor: '#dc3545' });
                    }
                },
                error: function (xhr) {
                    $btn.prop('disabled', false).html(originalHtml);
                    const errData = xhr.responseJSON || {};
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Record Departure',
                        text: errData.message || `Request failed (${xhr.status}).`,
                        confirmButtonColor: '#dc3545'
                    });
                }
            });
        });
    });

    $(document).on('click', '.btn-view-patient-details', function () {
        const referralId = $(this).data('referral-id');

        $.ajax({
            url: `${API_BASE}/get_transferred_patient_details.php?referral_id=${encodeURIComponent(referralId)}`,
            type: 'GET',
            dataType: 'json',
            success: function (d) {
                const ageDisplay = formatAgeDisplay(d.age, d.age_months, d.age_days);

                const vitalTile = function (label, value, unit) {
                    const displayValue = (value != null && value !== '') ? `${escapeHtml(String(value))}${unit ? ' ' + unit : ''}` : '—';
                    return `
                        <div class="bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-center">
                            <p class="text-[10px] uppercase tracking-wide text-slate-500">${label}</p>
                            <p class="font-semibold text-slate-900 text-sm">${displayValue}</p>
                        </div>
                    `;
                };

                const severityNum = parseInt(d.disease_severity, 10) || 0;
                const severityLabelMap = { 1: 'Low', 2: 'Moderate', 3: 'High', 4: 'Critical', 5: 'Extreme' };
                const severityColorMap = {
                    1: 'bg-emerald-100 text-emerald-800',
                    2: 'bg-amber-100 text-amber-800',
                    3: 'bg-orange-100 text-orange-800',
                    4: 'bg-red-100 text-red-800',
                    5: 'bg-red-600 text-white'
                };
                const severityText = `Level ${severityNum} (${severityLabelMap[severityNum] || 'Unknown'})`;
                const severityClass = severityColorMap[severityNum] || 'bg-slate-100 text-slate-700';

                const statusTags = [];
                if (d.is_pwd) statusTags.push('PWD');
                if (d.is_pregnant) statusTags.push('Pregnant');
                if (d.is_senior_citizen) statusTags.push('Senior Citizen');
                const tagsRow = statusTags.length > 0
                    ? `<p class="text-sm mt-3 pt-3 border-t border-slate-100"><span class="text-slate-500">Patient Status:</span> <span class="font-semibold text-slate-800">${escapeHtml(statusTags.join(', '))}</span></p>`
                    : '';

                const allergyBanner = d.has_allergy
                    ? `
                        <div class="mb-4 px-3.5 py-3 rounded-lg bg-red-50 border border-red-200">
                            <p class="text-sm text-red-800"><strong>Allergy Alert:</strong> ${escapeHtml(d.allergy_details || 'Known allergy (unspecified)')}</p>
                        </div>
                    `
                    : '';

                Swal.fire({
                    title: 'Patient Details',
                    width: '48rem',
                    html: `
                        <div class="text-start text-sm">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                <div class="border border-slate-200 rounded-xl p-4">
                                    <p class="text-xs text-slate-500 mb-0.5">Full Name</p>
                                    <p class="text-lg font-bold text-slate-900 mb-3">${escapeHtml(d.full_name || '—')}</p>
                                    <div class="grid grid-cols-2 gap-y-2 gap-x-3">
                                        <p><span class="text-slate-500">DOB:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.date_of_birth || '—')}</span></p>
                                        <p><span class="text-slate-500">Gender:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.gender || '—')}</span></p>
                                        <p><span class="text-slate-500">Age:</span> <span class="font-semibold text-slate-800">${escapeHtml(String(ageDisplay))}</span></p>
                                        <p><span class="text-slate-500">Civil Status:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.civil_status || '—')}</span></p>
                                        <p class="col-span-2"><span class="text-slate-500">Phone:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.phone || '—')}</span></p>
                                        <p class="col-span-2"><span class="text-slate-500">PhilHealth ID:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.philhealth_status || '—')}${d.philhealth_number ? ' (' + escapeHtml(d.philhealth_number) + ')' : ''}</span></p>
                                    </div>
                                </div>

                                <div class="border border-slate-200 rounded-xl p-4">
                                    <p class="text-xs text-slate-500 mb-0.5">Diagnosis</p>
                                    <p class="text-base font-bold text-slate-900 mb-3">${escapeHtml(d.diagnosis || '—')}</p>
                                    <p class="mb-2"><span class="text-slate-500">Chief Complaint:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.chief_complaint || '—')}</span></p>
                                    <p class="mb-2"><span class="text-slate-500">Referral Reasons:</span> <span class="font-semibold text-slate-800">${escapeHtml(referralReasonsText(d))}</span></p>
                                    <p class="mb-2"><span class="text-slate-500">Consent:</span> <span class="font-semibold ${d.consent_status === 'GRANTED' ? 'text-emerald-700' : 'text-red-700'}">${d.consent_status === 'GRANTED' ? 'Paper consent recorded' : 'Not recorded'}</span></p>
                                    <p class="mb-3"><span class="text-slate-500">Severity:</span> <span class="${severityClass} px-2.5 py-1 rounded-full text-xs font-bold ml-1">${severityText}</span></p>
                                    <p><span class="text-slate-500">Referring Facility:</span> <span class="font-semibold text-slate-800">${escapeHtml(d.referring_facility || '—')}</span></p>
                                    ${tagsRow}
                                </div>
                            </div>

                            ${allergyBanner}

                            <div class="mb-4 border border-slate-200 rounded-xl p-4">
                                <p class="font-semibold text-slate-800 mb-1">Clinical Attachments</p>
                                ${attachmentLinksHtml(referralId, d.attachments)}
                            </div>

                            <p class="mb-4"><strong class="text-slate-800">Address:</strong> <span class="text-slate-700">${escapeHtml(d.address || '—')}</span></p>

                            <div>
                                <p class="font-semibold text-slate-800 mb-2">Vitals at Time of Referral</p>
                                <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    ${vitalTile('BP', d.vital_bp)}
                                    ${vitalTile('HR', d.vital_hr, 'bpm')}
                                    ${vitalTile('RR', d.vital_rr, 'rpm')}
                                    ${vitalTile('Temp', d.vital_temp_c, '°C')}
                                    ${vitalTile('O2 Sat', d.vital_o2sat, '%')}
                                    ${vitalTile('Height', d.vital_height_cm, 'cm')}
                                    ${vitalTile('Weight', d.vital_weight_kg, 'kg')}
                                </div>
                            </div>

                            ${(d.arrival_vital_bp || d.arrival_vital_hr || d.arrival_vital_rr || d.arrival_vital_temp_c || d.arrival_vital_o2sat) ? `
                                <div class="mt-4">
                                    <p class="font-semibold text-slate-800 mb-2">Vitals at Arrival${d.arrived_at ? ' &middot; ' + formatReferralTimestamp(d.arrived_at) : ''}</p>
                                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        ${vitalTile('BP', d.arrival_vital_bp)}
                                        ${vitalTile('HR', d.arrival_vital_hr, 'bpm')}
                                        ${vitalTile('RR', d.arrival_vital_rr, 'rpm')}
                                        ${vitalTile('Temp', d.arrival_vital_temp_c, '°C')}
                                        ${vitalTile('O2 Sat', d.arrival_vital_o2sat, '%')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    `,
                    confirmButtonColor: '#16a34a',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            },
            error: function (xhr) {
                const errData = xhr.responseJSON || {};
                Swal.fire({
                    icon: 'error',
                    title: 'Could Not Load Patient Details',
                    text: errData.detail || 'This referral may not be finalized to your facility.',
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    });

    /**
     * Poll GET /api/v1/referral/{referral_id}/recommendations for accepting hospitals
     */
    function checkAndPollRecommendations() {
        if (!currentHospital) {
            $('#acceptedHospitalsCard').hide();
            return;
        }

        let referralId = window.activeInitiatedReferralId || null;
        let patientName = 'Patient';

        if (!referralId) {
            const stored = localStorage.getItem('active_initiated_referral');
            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    if (parsed && parsed.id) {
                        referralId = parsed.id;
                        patientName = parsed.patientName || 'Patient';
                    }
                } catch(e) {}
            }
        }

        if (referralId) {
            $('#acceptedHospitalsCard').fadeIn(200);
            $('#activeReferralIdText').text(referralId);
            $('#activeReferralPatientText').text(patientName);
            fetchRecommendationsForReferral(referralId, currentHospital.api_key || '');
            return;
        }

        // Nothing in this browser's local state (fresh login, different device, or
        // logout wiped it) -- fall back to server truth: find the most recent referral
        // this facility sent that has an acceptance still awaiting finalization.
        $.ajax({
            url: `${API_BASE}/get_my_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (data) {
                const awaitingFinalization = (Array.isArray(data) ? data : [])
                    .filter(r => r.status === 'ACCEPTED' && !r.receiving_facility)
                    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

                if (awaitingFinalization.length === 0) {
                    $('#acceptedHospitalsCard').hide();
                    return;
                }

                const rehydrated = awaitingFinalization[0];
                window.activeInitiatedReferralId = rehydrated.referral_id;
                const rehydratedName = 'Patient';
                localStorage.setItem('active_initiated_referral', JSON.stringify({ id: rehydrated.referral_id, patientName: rehydratedName }));

                $('#acceptedHospitalsCard').fadeIn(200);
                $('#activeReferralIdText').text(rehydrated.referral_id);
                $('#activeReferralPatientText').text(rehydratedName);
                fetchRecommendationsForReferral(rehydrated.referral_id, currentHospital.api_key || '');
            },
            error: function () {
                $('#acceptedHospitalsCard').hide();
            }
        });
    }

    function fetchRecommendationsForReferral(referralId, apiKey) {
        // Unauthenticated on IOL's side (no get_current_hospital dependency on this
        // endpoint) -- called directly, no signing/API key needed or sent.
        $.ajax({
            url: `${API_V1_REFERRAL}/${encodeURIComponent(referralId)}/recommendations`,
            type: 'GET',
            dataType: 'json',
            xhrFields: {
                withCredentials: false
            },
            success: function (res) {
                renderAcceptedHospitalsList(referralId, res);
            },
            error: function (xhr) {
                const $list = $('#acceptedHospitalsList');
                $list.html(`
                    <div class="col-span-full text-center py-6 px-4 text-slate-400 font-normal bg-slate-50/80 rounded-2xl border border-slate-200/60">
                        <span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-red-600 border-t-transparent me-2"></span>
                        Awaiting acceptances from receiving hospitals...
                    </div>
                `);
            }
        });
    }

    $(document).on('change', '#selectActiveReferralId', function() {
        const selectedId = $(this).val();
        if (!selectedId || !currentHospital) return;
        const apiKey = currentHospital.api_key || '';

        const selectedRef = initiatedReferralsCache.find(r => r.referral_id === selectedId);
        if (selectedRef) {
            $('#activeReferralPatientText').text(selectedRef.patient_name || 'Patient');
        }

        try {
            localStorage.setItem('active_initiated_referral', JSON.stringify({ id: selectedId, patientName: selectedRef ? selectedRef.patient_name : '' }));
        } catch(e) {}

        fetchRecommendationsForReferral(selectedId, apiKey);
    });

    const locationGeoCache = {};

    function getClientLocationFallback(lat, lng) {
        if (Math.abs(lat - 7.0620) < 0.03 && Math.abs(lng - 125.6050) < 0.03) {
            return "Gumamela Street, Purok 60, SIR 1, 76-A Bucana, Davao City";
        }
        if (Math.abs(lat - 7.0998) < 0.03 && Math.abs(lng - 125.6195) < 0.03) {
            return "J.P. Laurel Avenue, Bajada, Davao City, Davao del Sur";
        }
        if (Math.abs(lat - 6.6402) < 0.03 && Math.abs(lng - 124.7384) < 0.03) {
            return "Tacurong City, Sultan Kudarat, Soccsksargen";
        }
        return "Davao Region, Philippines";
    }

    function resolveLocationAddressHtml(lat, lng, elementId, opts) {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
            return 'Location N/A';
        }

        // admin3: "Barangay, Municipality, Province/District" instead of the default
        // street-first address string — opt in per call site (see Facility Profile).
        const wantAdmin3 = !!(opts && opts.admin3);
        const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}_${wantAdmin3 ? 'admin3' : 'full'}`;
        if (locationGeoCache[cacheKey]) {
            return escapeHtml(locationGeoCache[cacheKey]);
        }

        const fallbackAddr = getClientLocationFallback(lat, lng);

        // Trigger asynchronous reverse geocode via PHP proxy backend
        setTimeout(() => {
            $.ajax({
                url: `${API_BASE}/reverse_geo.php`,
                data: wantAdmin3 ? { lat: lat, lng: lng, format: 'admin3' } : { lat: lat, lng: lng },
                dataType: 'json',
                xhrFields: { withCredentials: true },
                timeout: 6000,
                success: function(res) {
                    if (res && res.address && !res.address.includes(lat.toFixed(2))) {
                        locationGeoCache[cacheKey] = res.address;
                        $(`#${elementId}`).text(res.address);
                    } else {
                        locationGeoCache[cacheKey] = fallbackAddr;
                        $(`#${elementId}`).text(fallbackAddr);
                    }
                },
                error: function() {
                    locationGeoCache[cacheKey] = fallbackAddr;
                    $(`#${elementId}`).text(fallbackAddr);
                }
            });
        }, 30);

        return `<span id="${elementId}" class="text-slate-500 font-normal italic flex items-center gap-1.5"><i class="bi bi-geo-alt text-red-500 animate-pulse"></i> Resolving location address...</span>`;
    }

    function renderAcceptedHospitalsList(referralId, data) {
        const $list = $('#acceptedHospitalsList');
        $list.empty();

        let items = [];
        if (Array.isArray(data)) {
            items = data;
        } else if (data && Array.isArray(data.recommendations)) {
            items = data.recommendations;
        } else if (data && Array.isArray(data.hospitals)) {
            items = data.hospitals;
        } else if (data && Array.isArray(data.data)) {
            items = data.data;
        } else if (data && typeof data === 'object' && (data.hospital_id || data.id || data.hospital_name)) {
            items = [data];
        }

        if (!items || items.length === 0) {
            $('#activeReferralStatusBadge')
                .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800')
                .text('Awaiting Acceptances');

            $list.html(`
                <div class="col-span-full text-center py-8 px-4 text-slate-400 font-normal bg-slate-100/90 rounded-b-2xl border border-slate-200/60">
                    <i class="bi bi-clock text-2xl block mb-2 text-slate-400"></i>
                    <span class="text-xs font-medium">Awaiting referrals...</span>
                </div>
            `);
            return;
        }

        $('#activeReferralStatusBadge')
            .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800')
            .text(`${items.length} Facility Accepted!`);

        // Track new accepting hospitals per referral to trigger the compact toast
        const newHospitals = [];
        items.forEach(hosp => {
            const hospId = hosp.hospital_id || hosp.id || hosp.hospital_name || 'h';
            const key = `${referralId}_${hospId}`;
            if (!knownAcceptedHospitalKeys.has(key)) {
                knownAcceptedHospitalKeys.add(key);
                newHospitals.push(hosp);
            }
        });

        // Surface a small, dismissible toast instead of a blocking full-screen popup —
        // the full details are already visible in #acceptedHospitalsCard on the page.
        if (newHospitals.length > 0) {
            showHospitalAcceptedToast(items, newHospitals);
        }

        // Hospitals arrive pre-ranked by the backend's FCM compatibility score
        // (highest matching_degree first) — do not re-sort client-side.
        items.forEach((hosp, idx) => {
            const hospName = hosp.hospital_name || hosp.name || `Hospital #${hosp.hospital_id || hosp.id || idx+1}`;
            const level = hosp.hospital_level || hosp.level || 'Level 2';
            const beds = hosp.available_beds !== undefined ? hosp.available_beds : 0;
            const matchDeg = hosp.matching_degree !== undefined ? Math.round(hosp.matching_degree * 100) : 100;
            const lat = hosp.latitude !== undefined ? parseFloat(hosp.latitude) : null;
            const lng = hosp.longitude !== undefined ? parseFloat(hosp.longitude) : null;
            const isBestMatch = idx === 0;

            const locId = `hosp-rec-loc-${idx}-${(hosp.hospital_id || 'h').toString().replace(/[^a-zA-Z0-9]/g, '')}`;
            const locContent = resolveLocationAddressHtml(lat, lng, locId);

            const card = `
                <div class="relative p-5 bg-slate-50/90 rounded-2xl border ${isBestMatch ? 'border-yellow-400 ring-2 ring-yellow-100' : 'border-slate-200'} shadow-xs space-y-4 hover:border-yellow-300 hover:shadow-md transition-all flex flex-col justify-between">
                    ${isBestMatch ? `
                        <span class="absolute -top-2.5 left-4 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-yellow-600 text-white shadow-sm flex items-center gap-1">
                            <i class="bi bi-star-fill"></i> BEST MATCH
                        </span>
                    ` : ''}
                    <div class="space-y-3">
                        <div class="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <h4 class="font-bold text-slate-900 text-base leading-snug">${escapeHtml(hospName)}</h4>
                                <span class="inline-block mt-1 px-2.5 py-0.5 rounded-md text-xs font-bold bg-red-100 text-red-800 border border-red-200/80">${escapeHtml(level)}</span>
                            </div>
                            <div class="flex items-center gap-1.5 flex-wrap">
                                <span class="px-2.5 py-1 rounded-lg font-bold text-xs bg-emerald-100 text-emerald-800 flex items-center gap-1 border border-emerald-200">
                                    <i class="bi bi-hospital text-xs"></i> ${beds} Beds Available
                                </span>
                                <span class="px-2.5 py-1 rounded-lg font-bold text-xs bg-indigo-100 text-indigo-800 border border-indigo-200">
                                    ${matchDeg}% Match
                                </span>
                            </div>
                        </div>

                        <div class="text-xs text-slate-600 font-medium leading-relaxed pt-2 border-t border-slate-200/70 flex items-start gap-1.5">
                            <i class="bi bi-geo-alt-fill text-red-500 text-xs shrink-0 mt-0.5"></i>
                            <span id="${locId}" class="break-words font-medium text-slate-700">${locContent}</span>
                        </div>
                    </div>

                    <button class="w-full py-2.5 px-4 bg-white/50 hover:bg-yellow-50 text-slate-700 hover:text-yellow-700 border border-slate-300 hover:border-yellow-500 rounded-xl shadow-sm hover:shadow-lg active:scale-[0.98] transition-all font-semibold flex items-center justify-center gap-2 btn-select-hospital"
                        data-hosp-name="${escapeHtml(hospName)}"
                        data-ref-id="${escapeHtml(referralId)}">
                        <i class="bi bi-check2-circle text-base"></i>
                        <span>Select This Hospital</span>
                    </button>
                </div>
            `;

            $list.append(card);
        });

        // Attach click listener for hospital selection
        $('.btn-select-hospital').off('click').on('click', function() {
            const selectedHosp = $(this).attr('data-hosp-name');
            const targetRefId = $(this).attr('data-ref-id');
            confirmAndFinalizeReferral(targetRefId, selectedHosp, $(this));
        });
    }

    /**
     * Shared confirm + PATCH /api/v1/referral/{id}/finalize flow, used by both the
     * main "Accepted Hospitals" card and the persistent acceptance popup — this is
     * the doctor's "lock in the transfer" action, so both entry points must agree.
     */
    function confirmAndFinalizeReferral(targetRefId, selectedHosp, $btn) {
        Swal.fire({
            title: 'Confirm Hospital Selection',
            text: `Are you sure you want to select "${selectedHosp}" as the target transfer destination for referral ${targetRefId}?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Yes, Select Hospital',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#16a34a',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' }
        }).then((result) => {
            if (!result.isConfirmed) return;
            if (!currentHospital) return;

            const apiKey = currentHospital.api_key || '';
            const originalBtnHtml = $btn ? $btn.html() : null;
            if ($btn) $btn.html('<span class="spinner-border spinner-border-sm me-2"></span> Finalizing...').prop('disabled', true);

            $.ajax({
                url: `${API_BASE}/finalize_referral.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ referral_id: targetRefId, hospital_name: selectedHosp }),
                dataType: 'json',
                success: function () {
                    $('#hospitalAcceptedToast').addClass('hidden');

                    Swal.fire({
                        icon: 'success',
                        title: 'Destination Hospital Confirmed!',
                        text: `Patient transfer to "${selectedHosp}" has been finalized for referral ${targetRefId}.`,
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });

                    $('#activeReferralStatusBadge')
                        .attr('class', 'px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-600 text-white')
                        .text(`Finalized`);

                    // Close out this referral's session client-side so polling stops surfacing it
                    window.activeInitiatedReferralId = null;
                    try { localStorage.removeItem('active_initiated_referral'); } catch (e) {}

                    // Hide the card immediately -- it's finalized, there's nothing left to
                    // decide on. checkAndPollRecommendations() would only clear this itself
                    // on its next poll, which left it sitting there stale for up to 30s.
                    $('#acceptedHospitalsCard').hide();
                },
                error: function (xhr) {
                    if ($btn) $btn.html(originalBtnHtml).prop('disabled', false);

                    const httpStatus = xhr.status || 500;
                    const errData = xhr.responseJSON || {};
                    const rawMsg = errData.message || errData.detail || `HTTP ${httpStatus} Server Error`;
                    const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, httpStatus));

                    Swal.fire({
                        icon: 'error',
                        title: `HTTP ${httpStatus} Error`,
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">Unable to finalize this referral.</p>
                            ${buildErrorNoteHtml(errorMsg, httpStatus)}
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            });
        });
    }

    // Tracks which hospital-acceptance events have already surfaced a toast, per referral
    const knownAcceptedHospitalKeys = new Set();

    let hospitalAcceptedToastTimeout = null;

    /**
     * Show a small, dismissible corner toast when a new hospital accepts, instead of
     * a blocking full-screen popup — the full ranked list already lives in
     * #acceptedHospitalsCard on the page, so the toast just points the doctor to it.
     */
    function showHospitalAcceptedToast(allAcceptedHospitals, newHospitals) {
        const newNames = newHospitals.map(h => h.hospital_name || h.name || 'Hospital').join(', ');
        const total = allAcceptedHospitals.length;

        $('#hospitalAcceptedToastText').text(
            `${newNames} accepted your referral. ${total} facilit${total === 1 ? 'y has' : 'ies have'} accepted so far.`
        );

        $('#hospitalAcceptedToast').removeClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);
        hospitalAcceptedToastTimeout = setTimeout(() => {
            $('#hospitalAcceptedToast').addClass('hidden');
        }, 8000);

        playNotificationSound();
    }

    $('#btnDismissAcceptedToast').on('click', function () {
        $('#hospitalAcceptedToast').addClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);
    });

    $('#btnViewAcceptedHospitals').on('click', function () {
        $('#hospitalAcceptedToast').addClass('hidden');
        clearTimeout(hospitalAcceptedToastTimeout);

        switchTab('referrals');

        const $card = $('#acceptedHospitalsCard');
        if ($card.length) {
            $('html, body').animate({ scrollTop: $card.offset().top - 90 }, 300);
            $card.removeClass('animate-highlight-pulse');
            void $card[0].offsetWidth;
            $card.addClass('animate-highlight-pulse');
        }
    });

    /**
     * Generic Alert Popup
     */
    function showAlert(type, title, message) {
        const swalIcon = type === 'success' ? 'success' : (type === 'warning' ? 'warning' : 'error');

        Swal.fire({
            icon: swalIcon,
            title: title,
            text: message,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
            confirmButtonColor: '#0d6efd',
            customClass: { popup: 'rounded-4 shadow-lg' }
        });
    }

    /**
     * Clean and format error messages (hides internal DB traces on 500 errors)
     */
    function cleanErrorMessage(msg, statusCode) {
        if (statusCode >= 500 || (typeof msg === 'string' && (msg.includes('SQL') || msg.includes('violates') || msg.includes('constraint') || msg.includes('psycopg2') || msg.includes('NotNullViolation')))) {
            return 'An internal server error occurred while processing the request.';
        }
        if (!msg || typeof msg !== 'string') return 'An unexpected error occurred.';
        let clean = msg;
        if (clean.includes('[SQL:')) {
            clean = clean.split('[SQL:')[0];
        }
        if (clean.includes('DETAIL:')) {
            clean = clean.split('DETAIL:')[0];
        }
        clean = clean.replace(/\s*\([^)]*psycopg2[^)]*\)/gi, '').trim();
        if (clean.length > 400) {
            clean = clean.substring(0, 397) + '...';
        }
        return clean;
    }

    /**
     * Build the colored note box for an error dialog: a "contact developer" notice for
     * genuine 5xx server failures, or the actual business-rule detail message otherwise.
     */
    function buildErrorNoteHtml(errorMsg, statusCode) {
        if (statusCode >= 500) {
            return `
                <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #fef2f2; color: #991b1b; border-color: #fecaca;">
                    <div class="flex items-start gap-2.5">
                        <i class="bi bi-exclamation-triangle-fill text-red-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                        <span class="text-xs font-semibold leading-relaxed">It seems like there is a problem with the server, contact developer at irdss.dev@upmin.edu.ph</span>
                    </div>
                </div>
            `;
        }
        return `
            <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #fffbeb; color: #92400e; border-color: #fde68a;">
                <div class="flex items-start gap-2.5">
                    <i class="bi bi-info-circle-fill text-amber-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                    <span class="text-xs font-semibold leading-relaxed">${errorMsg}</span>
                </div>
            </div>
        `;
    }

    /**
     * Escape HTML special characters
     */
    function formatPatientName(patient) {
        return [patient.first_name, patient.middle_name, patient.last_name].filter(Boolean).join(' ');
    }

    // MySQL DATETIME strings ("2026-09-01 14:22:10") aren't reliably parsed by `new Date()`
    // across browsers unless the space is swapped for a "T" -- falls back to the raw string
    // if parsing fails rather than showing "Invalid Date".
    function formatDateTime12h(dtString) {
        if (!dtString) return '';
        const d = new Date(String(dtString).replace(' ', 'T'));
        if (isNaN(d.getTime())) return dtString;
        return d.toLocaleString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * Three-tier age display: years, falling back to whole months under a year,
     * falling back to whole days under a month -- so a newborn a few weeks old
     * doesn't show as "0 months old" (indistinguishable from missing/broken data)
     * the same way "0 years old" would've been indistinguishable from an infant.
     *
     * @param {number|null|undefined} age - years
     * @param {number|null|undefined} ageMonths - completed months since birth
     * @param {number|null|undefined} ageDays - completed days since birth
     * @param {boolean} [withSuffix=false] - append " old" (years/months) for prose use
     * @returns {string}
     */
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

    // ============================================================
    // MY REFERRALS PAGE (list, filter, cancel)
    // ============================================================
    let myReferralsCache = [];

    const REFERRAL_STATUS_BADGE_CLASS = {
        PENDING: 'bg-amber-100 text-amber-800',
        SEEN: 'bg-red-100 text-red-800',
        ACCEPTED: 'bg-emerald-100 text-emerald-800',
        REDIRECTED: 'bg-indigo-100 text-indigo-800',
        NOT_SELECTED: 'bg-slate-200 text-slate-600',
        CANCELLED: 'bg-slate-200 text-slate-700'
    };

    function formatReferralTimestamp(value) {
        if (!value) return '—';
        const d = new Date(value);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    }

    /**
     * Load referrals initiated by this hospital via GET /api/v1/referral/mine
     */
    function loadMyReferrals() {
        if (!currentHospital) return;

        const $tableBody = $('#referralsTableBody');

        $.ajax({
            url: `${API_BASE}/get_my_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (data) {
                $('#referralsConnectionAlert').slideUp(200);
                myReferralsCache = Array.isArray(data) ? data : [];
                applyReferralFilters();
                $('#myReferralsLastUpdated').text(
                    new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                );
            },
            error: function (xhr) {
                const errData = xhr.responseJSON || {};
                const httpStatus = xhr.status || 500;
                const isConnectionErr = httpStatus === 503 || httpStatus === 0 || (errData.detail && errData.detail.includes("reach the server"));

                if (isConnectionErr) {
                    $('#referralsConnectionAlert').slideDown(200);
                    $tableBody.html(`
                        <tr>
                            <td colspan="8" class="text-center py-8 text-slate-400 font-normal text-xs">
                                Can't reach the server — showing nothing to display.
                            </td>
                        </tr>
                    `);
                    return;
                }

                $('#referralsConnectionAlert').slideUp(200);
                $tableBody.html(`
                    <tr>
                        <td colspan="8" class="text-center py-8 text-red-500 font-normal text-xs">
                            ${escapeHtml(cleanErrorMessage(errData.detail || 'Could not load your referrals.', httpStatus))}
                        </td>
                    </tr>
                `);
            }
        });
    }

    /**
     * Filter the cached referral list by status/date range/search, then re-render
     */
    function applyReferralFilters() {
        const statusFilter = $('#referralFilterStatus').val();
        const fromVal = $('#referralFilterFrom').val();
        const toVal = $('#referralFilterTo').val();
        const search = ($('#referralFilterSearch').val() || '').trim().toLowerCase();

        const fromDate = fromVal ? new Date(fromVal + 'T00:00:00') : null;
        const toDate = toVal ? new Date(toVal + 'T23:59:59') : null;

        const filtered = myReferralsCache.filter(function (ref) {
            if (statusFilter && ref.status !== statusFilter) return false;

            if (fromDate || toDate) {
                const created = new Date(ref.created_at);
                if (fromDate && created < fromDate) return false;
                if (toDate && created > toDate) return false;
            }

            if (search) {
                const haystack = `${ref.referral_id} ${ref.patient_id} ${ref.clinical_reason}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }

            return true;
        });

        // Sort by created_at descending (newest first)
        filtered.sort(function (a, b) {
            const dateA = new Date(a.created_at);
            const dateB = new Date(b.created_at);
            return dateB - dateA;
        });

        renderReferralsTable(filtered);
    }

    /**
     * Render the "My Referrals" DataTable from a (pre-filtered) referral list
     */
    function renderReferralsTable(referrals) {
        if ($.fn.DataTable.isDataTable('#referralsTable')) {
            $('#referralsTable').DataTable().destroy();
        }

        const $tableBody = $('#referralsTableBody');
        $tableBody.empty();

        if (referrals.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="8" class="text-center py-8 text-slate-400 font-normal">
                        No referrals match the current filters.
                    </td>
                </tr>
            `);
            return;
        }

        referrals.forEach(function (ref) {
            const badgeClass = REFERRAL_STATUS_BADGE_CLASS[ref.status] || 'bg-slate-100 text-slate-700';
            const responses = Array.isArray(ref.responses) ? ref.responses : [];

            const cancelBtn = ref.cancellable
                ? `<button class="px-3.5 py-1.5 bg-white/50 hover:bg-red-50 text-red-600 border border-red-300/70 text-xs font-medium rounded-lg shadow-sm hover:shadow-lg hover:border-red-500 hover:text-red-700 active:scale-[0.98] transition-all btn-cancel-referral flex items-center gap-1.5 ml-auto" data-ref-id="${escapeHtml(ref.referral_id)}">
                    <i class="bi bi-x-circle"></i> Cancel
                </button>`
                : '';

            const row = `
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500 border-b border-slate-300/60">${escapeHtml(ref.referral_id)}</td>
                    <td class="py-3.5 px-6 text-slate-700 text-xs font-mono border-b border-slate-300/60">${escapeHtml(ref.patient_id)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(ref.disease_severity)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}">${escapeHtml(ref.status)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${formatReferralTimestamp(ref.created_at)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${formatReferralTimestamp(ref.seen_at)}</td>
                    <td class="py-3.5 px-6 text-xs border-b border-slate-300/60">
                        <button type="button" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium btn-view-referral-timeline" data-ref-id="${escapeHtml(ref.referral_id)}">
                            <i class="bi bi-truck me-1"></i> Track
                        </button>
                    </td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60">${cancelBtn}</td>
                </tr>
            `;
            $tableBody.append(row);
        });

        // Stash the raw filtered list for the timeline popup lookup
        $tableBody.data('referrals', referrals);

        $('#referralsTable').DataTable({
            paging: true,
            searching: false,
            ordering: true,
            // order: [] -- without this, DataTables silently re-sorts by column 0
            // (Referral ID, alphabetically) on every render, discarding the
            // newest-first sort already applied above in applyReferralFilters().
            // Column headers stay clickable for a manual re-sort either way.
            order: [],
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [5, 10, 25, 50],
            language: {
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ referrals",
                paginate: {
                    next: '<i class="bi bi-chevron-right"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>'
                }
            }
        });
    }

    $('#btnRefreshReferrals').on('click', function () {
        if (currentHospital) loadMyReferrals();
    });

    $('#referralFilterStatus, #referralFilterFrom, #referralFilterTo').on('change', applyReferralFilters);
    $('#referralFilterSearch').on('input', applyReferralFilters);

    $('#btnClearReferralFilters').on('click', function () {
        $('#referralFilterStatus').val('');
        $('#referralFilterFrom').val('');
        $('#referralFilterTo').val('');
        $('#referralFilterSearch').val('');
        applyReferralFilters();
    });

    /**
     * Renders one step of the Shopee-style vertical tracker: a dot on a connecting line,
     * filled/green with a step-specific icon when complete, hollow/gray when still pending.
     */
    function trackerStep(label, timestamp, completed, isLast, iconClass, extraHtml) {
        const dotClasses = completed
            ? 'bg-emerald-500 text-white'
            : 'bg-white text-slate-300 border-2 border-slate-200';
        const labelClasses = completed ? 'text-slate-900' : 'text-slate-400';
        const icon = completed ? `<i class="bi ${iconClass || 'bi-check-lg'} text-xs"></i>` : '';

        return `
            <div class="relative ${isLast ? '' : 'pb-6'} pl-9">
                ${isLast ? '' : `<div class="absolute left-[11px] top-6 bottom-0 w-0.5 ${completed ? 'bg-emerald-400' : 'bg-slate-200'}"></div>`}
                <div class="absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${dotClasses}">${icon}</div>
                <p class="text-sm font-semibold ${labelClasses}">${label}</p>
                <p class="text-xs text-slate-500 mt-0.5">${timestamp ? formatReferralTimestamp(timestamp) : 'Pending'}</p>
                ${extraHtml || ''}
            </div>
        `;
    }

    /**
     * Shopee-style order-tracking UI, adapted for referral lifecycle: Sent -> Seen ->
     * Accepted -> Finalized -> Arrived, each step timestamped once it happens.
     */
    $(document).on('click', '.btn-view-referral-timeline', function () {
        const referralId = $(this).data('ref-id');
        const referrals = $('#referralsTableBody').data('referrals') || [];
        const ref = referrals.find(function (r) { return r.referral_id === referralId; });
        if (!ref) return;

        const responses = Array.isArray(ref.responses) ? ref.responses : [];

        const onward = ref.onward_referral || null;
        const hasFollowUp = !!(onward || ref.departed_at);

        let stepsHtml;
        if (ref.status === 'CANCELLED') {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false, 'bi-send-fill') +
                trackerStep('Cancelled by Referring Facility', null, true, true, 'bi-x-circle-fill');
        } else {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false, 'bi-send-fill') +
                trackerStep('Seen by a Facility', ref.seen_at, !!ref.seen_at, false, 'bi-eye-fill') +
                trackerStep(ref.receiving_facility ? `Accepted by ${escapeHtml(ref.receiving_facility)}` : 'Accepted', ref.accepted_at, !!ref.accepted_at, false, 'bi-check-circle-fill') +
                trackerStep(ref.receiving_facility ? `Finalized to ${escapeHtml(ref.receiving_facility)}` : 'Finalized', ref.finalized_at, !!ref.finalized_at, false, 'bi-flag-fill') +
                trackerStep('Patient Arrived', ref.arrived_at, !!ref.arrived_at, !hasFollowUp, 'bi-person-check-fill');

            // The patient's journey continues past this hospital's own tracker: the
            // facility they arrived at referred them onward again (detected server-side
            // via the shared anonymized patient_code) -- surface it instead of going dark.
            if (onward) {
                let onwardLabel;
                if (onward.receiving_facility) {
                    onwardLabel = `Referred Onward to ${escapeHtml(onward.receiving_facility)}`;
                } else if (onward.status === 'CANCELLED') {
                    onwardLabel = 'Onward Referral Cancelled';
                } else {
                    onwardLabel = `Referred Onward by ${escapeHtml(ref.receiving_facility || 'Receiving Facility')} — Awaiting Response`;
                }
                stepsHtml += trackerStep(onwardLabel, onward.created_at, true, !ref.departed_at, 'bi-arrow-right-circle-fill');
            }

            // The receiving facility's episode of care ended -- discharged, transferred,
            // deceased, or left AMA. Distinct from "referred onward" (a new referral row).
            if (ref.departed_at) {
                const departureLabelMap = {
                    DISCHARGED: 'Patient Discharged',
                    TRANSFERRED: 'Patient Transferred to Another Facility',
                    DECEASED: 'Patient Deceased',
                    LEFT_AMA: 'Patient Left Against Medical Advice'
                };
                const departLabel = departureLabelMap[ref.departure_outcome] || 'Patient Departed';
                const remarksHtml = ref.departure_remarks
                    ? `<p class="text-xs text-slate-500 mt-1 italic">"${escapeHtml(ref.departure_remarks)}"</p>`
                    : '';
                stepsHtml += trackerStep(departLabel, ref.departed_at, true, true, 'bi-box-arrow-right', remarksHtml);
            }
        }

        const notifiedHtml = responses.length
            ? responses.map(function (r) {
                // A hospital that opened the referral but hasn't accepted/redirected yet is
                // still technically PENDING server-side -- show it as SEEN so the referring
                // doctor can tell "no one's looked at this" apart from "someone's reviewing it".
                const displayStatus = (r.response_status === 'PENDING' && r.seen_at) ? 'SEEN' : r.response_status;
                const statusBadge = REFERRAL_STATUS_BADGE_CLASS[displayStatus] || 'bg-slate-100 text-slate-700';
                const redirectReason = r.response_status === 'REDIRECTED'
                    ? (REDIRECT_REASONS[r.redirect_reason_code] || r.redirect_reason_code || 'Reason not recorded') + (r.redirect_reason_text ? `: ${r.redirect_reason_text}` : '')
                    : '';
                return `
                    <div class="flex items-start justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                        <div><p class="text-xs font-medium text-slate-700">${escapeHtml(r.hospital_name)}</p>${redirectReason ? `<p class="text-[10px] text-red-600 mt-0.5">${escapeHtml(redirectReason)}</p>` : ''}</div>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${statusBadge}">${escapeHtml(displayStatus)}</span>
                    </div>
                `;
            }).join('')
            : '<p class="text-xs text-slate-400 text-center py-3">No hospitals have been notified yet.</p>';

        Swal.fire({
            title: 'Track Referral',
            width: '56rem',
            html: `
                <div class="text-left flex gap-6">
                    <div class="flex-1 pt-2 pb-2">${stepsHtml}</div>
                    <div class="flex-1 pt-2 pb-2 border-l border-slate-200 pl-6">
                        <p class="text-xs font-bold text-slate-700 mb-2">Notified Hospitals (${responses.length})</p>
                        <div class="max-h-64 overflow-y-auto">${notifiedHtml}</div>
                        <p class="text-xs font-bold text-slate-700 mt-4 mb-2">Clinical Attachments</p>
                        <div id="trackerAttachments"><p class="text-xs text-slate-400">Loading attachments...</p></div>
                    </div>
                </div>
            `,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Close',
            confirmButtonColor: '#0d6efd',
            customClass: { popup: 'rounded-4 shadow-lg' },
            didOpen: function () {
                $.getJSON(`${API_BASE}/get_referral_attachments.php?referral_id=${encodeURIComponent(referralId)}`)
                    .done(items => $('#trackerAttachments').html(attachmentLinksHtml(referralId, items)))
                    .fail(() => $('#trackerAttachments').html('<p class="text-xs text-slate-400">Attachments could not be loaded.</p>'));
            }
        });
    });

    /**
     * Cancel a referral via PATCH /api/v1/referral/{id}/cancel — only shown while cancellable
     */
    $(document).on('click', '.btn-cancel-referral', function () {
        const referralId = $(this).data('ref-id');

        Swal.fire({
            icon: 'warning',
            title: 'Cancel this referral?',
            text: `Referral ${referralId} will be withdrawn from every hospital it was broadcast to.`,
            showCancelButton: true,
            confirmButtonText: '<i class="bi bi-x-circle me-1"></i> Yes, Cancel It',
            cancelButtonText: 'Keep Referral',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b',
            customClass: { popup: 'rounded-4 shadow-lg' }
        }).then(function (result) {
            if (!result.isConfirmed) return;

            $.ajax({
                url: `${API_BASE}/cancel_referral.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify({ referral_id: referralId }),
                dataType: 'json',
                success: function () {
                    showToast('success', 'Referral cancelled', 2000);
                    loadMyReferrals();
                },
                error: function (xhr) {
                    const status = xhr.status || 500;
                    const errData = xhr.responseJSON || {};
                    const rawMsg = errData.message || errData.detail || `HTTP ${status} Server Error`;
                    const errorMsg = escapeHtml(cleanErrorMessage(rawMsg, status));

                    Swal.fire({
                        icon: 'error',
                        title: `HTTP ${status} Error`,
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">Unable to cancel this referral.</p>
                            ${buildErrorNoteHtml(errorMsg, status)}
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                }
            });
        });
    });

    // Track which referral IDs have already surfaced as a notification, and pending polling state
    const notifiedReferralIds = new Set();
    const incomingNotifications = new Map(); // referral_id -> alert payload, backs the bell dropdown
    let isPollingInProgress = false;

    /**
     * Poll Incoming Referrals for active hospital session
     */
    function pollIncomingReferrals() {
        const isClinicalUser = currentUser && (currentUser.role === 'doctor' || currentUser.role === 'nurse');
        if (!currentHospital || !isClinicalUser || isPollingInProgress) return;

        isPollingInProgress = true;

        $.ajax({
            url: `${API_BASE}/get_incoming_referrals.php`,
            type: 'GET',
            dataType: 'json',
            success: function (res) {
                isPollingInProgress = false;
                let items = [];
                if (Array.isArray(res)) {
                    items = res;
                } else if (res && Array.isArray(res.referrals)) {
                    items = res.referrals;
                } else if (res && Array.isArray(res.data)) {
                    items = res.data;
                } else if (res && Array.isArray(res.incoming)) {
                    items = res.incoming;
                } else if (res && (res.referral_id || res.id)) {
                    items = [res];
                }

                let hasNewNotification = false;
                const stillPendingIds = new Set();

                items.forEach(item => {
                    const id = item.referral_id || item.id;
                    const respStatus = (item.response_status || item.status || '').toUpperCase();
                    if (!id || respStatus === 'ACCEPTED' || respStatus === 'REDIRECTED') return;

                    stillPendingIds.add(id);
                    // Always refresh with the latest server data (not just on first sight) so a
                    // stale/deleted-then-recreated referral never shows outdated info
                    incomingNotifications.set(id, item);

                    if (!notifiedReferralIds.has(id)) {
                        notifiedReferralIds.add(id);
                        hasNewNotification = true;
                    }
                });

                // Drop anything that's no longer PENDING server-side (accepted/redirected/
                // cancelled/deleted) so the bell and Pending Referrals page never show a
                // referral that's already been resolved out from under the doctor
                Array.from(incomingNotifications.keys()).forEach(id => {
                    if (!stillPendingIds.has(id)) {
                        incomingNotifications.delete(id);
                        notifiedReferralIds.delete(id);
                    }
                });

                renderNotificationBell();
                if (typeof renderPendingReferralsList === 'function') renderPendingReferralsList();

                if (hasNewNotification) {
                    showNewReferralToast();
                    playAlarmSound();
                }
            },
            error: function () {
                isPollingInProgress = false;
            }
        });
    }

    /**
     * Render the bell badge count and the dropdown list of pending referral notifications (sorted newest first)
     */
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

        // Sort notifications by created_at (newest first)
        const sorted = Array.from(incomingNotifications.entries()).sort((a, b) => {
            const dateA = new Date(a[1].created_at || 0);
            const dateB = new Date(b[1].created_at || 0);
            return dateB - dateA;
        });

        let html = '';
        sorted.forEach(([referralId, alert]) => {
            const referringFacility = alert.referring_facility || alert.referring_hospital || (alert.serviceProvider && alert.serviceProvider.display) || 'Unknown Hospital';
            html += `
                <div class="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                    <div class="w-9 h-9 rounded-full bg-red-50 text-red-600 flex items-center justify-center shrink-0">
                        <i class="bi bi-hospital"></i>
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-xs font-semibold text-slate-800">New referral from <span class="text-red-700">${escapeHtml(referringFacility)}</span></p>
                        <p class="text-[10px] text-slate-400 font-mono mt-0.5">${escapeHtml(String(referralId))}</p>
                        <button type="button" class="btn-view-referral-form mt-2 px-3 py-1 bg-yellow-600 hover:bg-red-700 text-white text-[11px] font-bold rounded-lg transition-all" data-ref-id="${escapeHtml(String(referralId))}">
                            <i class="bi bi-file-earmark-text-fill me-1"></i> View Form
                        </button>
                    </div>
                </div>
            `;
        });
        $list.html(html);
    }

    const PENDING_SEVERITY_LABEL = { 1: 'Mild', 2: 'Moderate', 3: 'Severe', 4: 'Critical', 5: 'Extreme' };

    /**
     * Waiting time, color-escalated to match the 15-30 minute ER turnaround window this
     * system already tracks elsewhere -- green while fresh, amber approaching it, red
     * once it's actually overdue. Plain text color, not a badge -- just a signal, not decor.
     */
    function formatWaitLabel(createdAt) {
        if (!createdAt) return { text: 'Unknown', cls: 'text-slate-500' };
        const mins = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
        const text = mins < 1 ? 'Just now' : mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
        const cls = mins < 5 ? 'text-emerald-700' : mins < 15 ? 'text-amber-700' : 'text-red-700 font-bold';
        return { text, cls };
    }

    /**
     * Renders the full-page Pending Referrals queue (triage view) from the same
     * `incomingNotifications` map the bell uses, sorted most-severe-first so a doctor
     * can see everything stacked up at once instead of only the last one that popped in.
     */
    function renderPendingReferralsList() {
        const $list = $('#pendingReferralsList');
        if ($list.length === 0) return;

        const items = Array.from(incomingNotifications.values());
        const count = items.length;
        const criticalCount = items.filter(i => (parseInt(i.disease_severity, 10) || 0) >= 4).length;

        $('#statPendingCount').text(count);
        $('#statCriticalPendingCount').text(criticalCount);
        $('#navPendingBadge').text(count > 9 ? '9+' : count).toggleClass('hidden', count === 0);

        if (count === 0) {
            $list.html('<div class="px-6 py-10 text-center text-xs text-slate-400"><i class="bi bi-check2-circle text-2xl text-slate-300 block mb-2"></i>No pending referrals right now.</div>');
            return;
        }

        const sorted = items.slice().sort(function (a, b) {
            const sevDiff = (parseInt(b.disease_severity, 10) || 0) - (parseInt(a.disease_severity, 10) || 0);
            if (sevDiff !== 0) return sevDiff;
            return new Date(b.created_at || 0) - new Date(a.created_at || 0); // newest first within same severity
        });

        $list.html(sorted.map(function (item) {
            const referralId = item.referral_id || item.id;
            const severity = parseInt(item.disease_severity, 10) || 0;
            const severityLabel = PENDING_SEVERITY_LABEL[severity] || String(item.disease_severity);
            const wait = formatWaitLabel(item.created_at);

            return `
                <div class="bg-white rounded-xl border border-slate-200/70 p-4">
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm text-slate-800"><span class="font-semibold">Referral from:</span> ${escapeHtml(item.referring_facility || 'Unknown Facility')}</p>
                            <p class="text-sm text-slate-800"><span class="font-semibold">Severity:</span> ${severity} &middot; ${escapeHtml(severityLabel)}</p>
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

    $(document).on('click', '.btn-review-pending-referral', function () {
        const referralId = $(this).data('ref-id');
        const incomingAlert = incomingNotifications.get(referralId);
        if (!incomingAlert) return;

        // Don't delete from the map just for opening it -- it should only disappear once
        // it's actually resolved (accepted/redirected), which the next poll picks up
        // naturally. Deleting here made it vanish for up to 12s if the doctor closed the
        // popup without deciding, which looked like a bug (and was reported as one).
        stopAlarmSound();
        markReferralSeen(referralId);
        showIncomingReferralDetail(incomingAlert);
    });

    let newReferralToastTimeout = null;

    /**
     * Briefly show a "New Referral" callout beside the bell and give it a shake
     */
    function showNewReferralToast() {
        const $toast = $('#newReferralToast');
        const $bell = $('#btnNotificationBell');

        $toast.removeClass('hidden');
        clearTimeout(newReferralToastTimeout);
        newReferralToastTimeout = setTimeout(() => {
            $toast.addClass('hidden');
        }, 4000);

        $bell.removeClass('animate-bell-shake');
        // Force reflow so the animation can restart if it's already mid-run
        void $bell[0].offsetWidth;
        $bell.addClass('animate-bell-shake');
    }

    /**
     * Play a short two-tone notification ring via the Web Audio API (no audio file needed)
     */
    function playNotificationSound() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!window._notificationAudioCtx) {
                window._notificationAudioCtx = new AudioCtx();
            }
            const ctx = window._notificationAudioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            [880, 1108].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.value = freq;

                const start = now + i * 0.15;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.4);
            });
        } catch (e) {
            // Autoplay restrictions or unsupported browser — fail silently
        }
    }

    let alarmIntervalId = null;
    let alarmStopTimeoutId = null;

    function playAlarmBeep() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;

            if (!window._notificationAudioCtx) {
                window._notificationAudioCtx = new AudioCtx();
            }
            const ctx = window._notificationAudioCtx;
            if (ctx.state === 'suspended') ctx.resume();

            const now = ctx.currentTime;
            [1046, 784].forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = freq;

                const start = now + i * 0.18;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);

                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(start);
                osc.stop(start + 0.35);
            });
        } catch (e) {
            // Autoplay restrictions or unsupported browser — fail silently
        }
    }

    /**
     * Urgent, repeating alarm for a brand-new incoming referral -- a single short chime
     * is too easy to miss in a busy ER. Repeats every ~0.9s for up to 20s as a safety cap,
     * but stops immediately the moment the doctor acknowledges it (opens the bell, opens
     * the referral from the Pending Referrals page, or switches to that page).
     */
    function playAlarmSound() {
        stopAlarmSound();
        playAlarmBeep();
        alarmIntervalId = setInterval(playAlarmBeep, 900);
        alarmStopTimeoutId = setTimeout(stopAlarmSound, 20000);
    }

    function stopAlarmSound() {
        if (alarmIntervalId) {
            clearInterval(alarmIntervalId);
            alarmIntervalId = null;
        }
        if (alarmStopTimeoutId) {
            clearTimeout(alarmStopTimeoutId);
            alarmStopTimeoutId = null;
        }
    }

    // Toggle the notification dropdown open/closed
    $(document).on('click', '#btnNotificationBell', function (e) {
        e.stopPropagation();
        $('#notificationDropdown').toggleClass('hidden');
        stopAlarmSound();
    });
    $(document).on('click', '#notificationDropdown', function (e) {
        e.stopPropagation();
    });
    $(document).on('click', function () {
        $('#notificationDropdown').addClass('hidden');
    });

    // "View Form" click inside the notification dropdown: mark seen, open the full detail modal
    $(document).on('click', '.btn-view-referral-form', function () {
        const referralId = $(this).data('ref-id');
        const incomingAlert = incomingNotifications.get(referralId);
        if (!incomingAlert) return;

        // Same fix as the Pending Referrals page: don't delete on open, only once resolved
        $('#notificationDropdown').addClass('hidden');
        stopAlarmSound();

        markReferralSeen(referralId);
        showIncomingReferralDetail(incomingAlert);
    });

    /**
     * PATCH /api/v1/referral/{referral_id}/seen — stamps when the facility opened the form
     */
    function markReferralSeen(referralId) {
        if (!currentHospital || !referralId) return;

        $.ajax({
            url: `${API_BASE}/mark_referral_seen.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ referral_id: referralId }),
            dataType: 'json',
            error: function (xhr) {
                // Silently fail - this is a non-blocking operation
                console.log('Failed to mark referral as seen: ' + (xhr.status || 'unknown error'));
            }
        });
    }

    /**
     * Show the full patient detail modal with Accept / Redirect decision buttons
     */
    function showIncomingReferralDetail(incomingAlert) {
        const referralId = incomingAlert.referral_id || incomingAlert.id || 'N/A';
        window.currentActiveReferralId = referralId;

        const referringFacility = incomingAlert.referring_facility || incomingAlert.referring_hospital || (incomingAlert.serviceProvider && incomingAlert.serviceProvider.display) || 'Unknown Hospital';
        const patientId = incomingAlert.patient_id || (incomingAlert.subject && incomingAlert.subject.reference) || 'N/A';
        const age = incomingAlert.patient_age !== undefined ? incomingAlert.patient_age : incomingAlert.age;
        const ageMonths = incomingAlert.patient_age_months !== undefined ? incomingAlert.patient_age_months : null;
        const ageDays = incomingAlert.patient_age_days !== undefined ? incomingAlert.patient_age_days : null;
        const ageDisplay = formatAgeDisplay(age, ageMonths, ageDays, true);
        const gender = incomingAlert.patient_gender || incomingAlert.gender || 'N/A';
        const patientInfo = `${ageDisplay} (${gender})`;
        const severity = incomingAlert.disease_severity !== undefined ? incomingAlert.disease_severity : (incomingAlert.severity !== undefined ? incomingAlert.severity : '3');
        const clinicalReason = referralReasonsText(incomingAlert);
        const diagnosis = incomingAlert.diagnosis || 'Not specified';
        const chiefComplaint = incomingAlert.chief_complaint || 'Not specified';

        // Patient status flags -- only ever shown if at least one applies, to avoid clutter
        const statusTags = [];
        if (incomingAlert.is_pwd) statusTags.push('PWD');
        if (incomingAlert.is_pregnant) statusTags.push('Pregnant');
        if (incomingAlert.is_senior_citizen) statusTags.push('Senior Citizen');
        const patientStatusText = statusTags.length > 0 ? statusTags.join(', ') : null;
        const allergyText = incomingAlert.has_allergy
            ? (incomingAlert.allergy_details ? incomingAlert.allergy_details : 'Yes (unspecified)')
            : null;

        // Extract patient coordinates (origin)
        const patientLat = incomingAlert.patient_latitude !== undefined && incomingAlert.patient_latitude !== null ? parseFloat(incomingAlert.patient_latitude) : (incomingAlert.patient_lat !== undefined && incomingAlert.patient_lat !== null ? parseFloat(incomingAlert.patient_lat) : (incomingAlert.patient && incomingAlert.patient.latitude !== undefined && incomingAlert.patient.latitude !== null ? parseFloat(incomingAlert.patient.latitude) : null));
        const patientLng = incomingAlert.patient_longitude !== undefined && incomingAlert.patient_longitude !== null ? parseFloat(incomingAlert.patient_longitude) : (incomingAlert.patient_lng !== undefined && incomingAlert.patient_lng !== null ? parseFloat(incomingAlert.patient_lng) : (incomingAlert.patient && incomingAlert.patient.longitude !== undefined && incomingAlert.patient.longitude !== null ? parseFloat(incomingAlert.patient.longitude) : null));

        // Extract hospital coordinates (destination) — this is OUR OWN hospital's location,
        // used only for the transfer-distance calc below, never for display as "referring
        // facility" (that's a different hospital entirely — see referring facility coords).
        const hospitalLat = incomingAlert.hospital_latitude !== undefined && incomingAlert.hospital_latitude !== null ? parseFloat(incomingAlert.hospital_latitude) : (incomingAlert.hospital_lat !== undefined && incomingAlert.hospital_lat !== null ? parseFloat(incomingAlert.hospital_lat) : (currentHospital && currentHospital.latitude !== undefined && currentHospital.latitude !== null ? parseFloat(currentHospital.latitude) : null));
        const hospitalLng = incomingAlert.hospital_longitude !== undefined && incomingAlert.hospital_longitude !== null ? parseFloat(incomingAlert.hospital_longitude) : (incomingAlert.hospital_lng !== undefined && incomingAlert.hospital_lng !== null ? parseFloat(incomingAlert.hospital_lng) : (currentHospital && currentHospital.longitude !== undefined && currentHospital.longitude !== null ? parseFloat(currentHospital.longitude) : null));

        // Extract the actual referring (sending) hospital's own coordinates, for display.
        const referringLat = incomingAlert.referring_facility_latitude !== undefined && incomingAlert.referring_facility_latitude !== null ? parseFloat(incomingAlert.referring_facility_latitude) : null;
        const referringLng = incomingAlert.referring_facility_longitude !== undefined && incomingAlert.referring_facility_longitude !== null ? parseFloat(incomingAlert.referring_facility_longitude) : null;

        // Calculate Haversine distance and transfer ETA
        let etaText = 'N/A';
        const hospLocationHtml = resolveLocationAddressHtml(referringLat, referringLng, 'modal-hospital-location');
        const patientLocationHtml = resolveLocationAddressHtml(patientLat, patientLng, 'modal-patient-location');

        // Transfer distance is referring hospital -> receiving hospital: that's the actual
        // ambulance route for an inter-facility transfer, not the patient's registered
        // origin barangay (which is a separate triage/routing field, unrelated to this trip).
        if (referringLat != null && referringLng != null && !isNaN(referringLat) && !isNaN(referringLng)) {
            if (hospitalLat != null && hospitalLng != null && !isNaN(hospitalLat) && !isNaN(hospitalLng)) {
                const R = 6371; // Earth radius in km
                const dLat = (hospitalLat - referringLat) * Math.PI / 180;
                const dLon = (hospitalLng - referringLng) * Math.PI / 180;
                const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                          Math.cos(referringLat * Math.PI / 180) * Math.cos(hospitalLat * Math.PI / 180) *
                          Math.sin(dLon / 2) * Math.sin(dLon / 2);
                const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                const distanceKm = R * c;

                // 40 km/h avg ambulance speed + 5 min prep time
                const estMinutes = Math.max(5, Math.round((distanceKm / 40) * 60));
                etaText = `${distanceKm.toFixed(1)} km (~${estMinutes} mins transfer ETA)`;
            }
        }

        // Update placeholder elements if present in DOM
        $('#modal-referring-hospital').text(referringFacility);
        $('#modal-patient-id').text(patientId);
        $('#modal-patient-age').text(ageDisplay);
        $('#modal-severity').text("Triage Category: " + severity);
        $('#modal-diagnosis').text(diagnosis);
        $('#modal-chief-complaint').text(chiefComplaint);
        $('#modal-reason').text(clinicalReason);

        // Builds one label/value row inside a grouped info card; `last` drops the divider.
        const infoRow = (label, valueHtml, opts = {}) => `
            <div class="flex flex-col sm:flex-row sm:justify-between ${opts.last ? '' : 'border-b border-slate-200/60'} pb-1.5 gap-0.5 sm:gap-2">
                <span class="text-slate-700 font-bold shrink-0">${label}:</span>
                <span class="${opts.valueClass || 'font-bold text-slate-800'} sm:text-right${opts.leading ? ' leading-relaxed' : ''}" ${opts.id ? `id="${opts.id}"` : ''}>${valueHtml}</span>
            </div>`;
        const infoCard = (title, rowsHtml, extraClass = '') => `
            <div class="${extraClass}">
                <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">${title}</p>
                <div class="bg-slate-50 rounded-xl border border-slate-200/70 p-3.5 space-y-1.5 text-xs">${rowsHtml}</div>
            </div>`;

        Swal.fire({
            title: '<div class="flex items-center justify-center gap-2 text-red-600"><i class="bi bi-hospital text-2xl"></i> <span>Incoming Patient Referral</span></div>',
            width: '60rem',
            html: `
                <div class="text-start space-y-3 p-2 text-sm text-slate-700">
                    <p class="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Hospital Referral Notification</p>

                    <div class="p-3 bg-red-50 rounded-xl border border-red-100 space-y-1">
                        <div class="flex justify-between items-center">
                            <span class="text-xs font-bold text-red-900 font-mono">Referral ID: ${escapeHtml(referralId)}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Pending Decision</span>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                        ${infoCard('Referring Hospital', `
                            ${infoRow('Referring Facility', escapeHtml(referringFacility), { id: 'modal-referring-hospital' })}
                            ${infoRow('Location', hospLocationHtml, { valueClass: 'font-normal text-slate-800', leading: true })}
                            ${infoRow('Transfer Distance & ETA', escapeHtml(etaText), { valueClass: 'font-bold text-red-700', id: 'modal-transfer-eta', last: true })}
                        `)}
                        ${infoCard('Patient Info', `
                            ${infoRow('Patient ID', escapeHtml(String(patientId)), { valueClass: 'font-bold text-slate-800 font-mono', id: 'modal-patient-id' })}
                            ${infoRow('Age', escapeHtml(ageDisplay), { valueClass: 'font-normal text-slate-800', id: 'modal-patient-age' })}
                            ${infoRow('Gender', escapeHtml(String(gender)), { valueClass: 'font-normal text-slate-800', id: 'modal-patient-gender' })}
                            ${infoRow('Location', patientLocationHtml, { valueClass: 'font-normal text-slate-800', leading: true, last: true })}
                        `)}
                    </div>

                    ${infoCard('Clinical Info', `
                        ${infoRow('Severity', 'Triage Category: ' + escapeHtml(String(severity)), { valueClass: 'font-bold text-amber-700', id: 'modal-severity' })}
                        ${infoRow('Diagnosis', escapeHtml(diagnosis), { id: 'modal-diagnosis' })}
                        ${infoRow('Chief Complaint', escapeHtml(chiefComplaint), { id: 'modal-chief-complaint' })}
                        ${patientStatusText ? infoRow('Patient Status', escapeHtml(patientStatusText)) : ''}
                        ${allergyText ? infoRow('Allergy', escapeHtml(allergyText), { valueClass: 'font-bold text-red-700' }) : ''}
                        ${infoRow('Consent', incomingAlert.consent_status === 'GRANTED' ? 'Paper consent recorded' : 'Not recorded', { valueClass: incomingAlert.consent_status === 'GRANTED' ? 'font-bold text-emerald-700' : 'font-bold text-red-700' })}
                        ${infoRow('Reason for Referral', escapeHtml(clinicalReason), { id: 'modal-reason', last: true })}
                    `, 'mt-3')}

                    <p class="text-xs text-slate-500 text-center mt-3">Please choose your decision for this incoming referral:</p>
                </div>
            `,
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: '<i class="bi bi-check-circle-fill me-1"></i> ACCEPT',
            confirmButtonColor: '#16a34a',
            denyButtonText: '<i class="bi bi-arrow-right-circle-fill me-1"></i> REDIRECTED',
            denyButtonColor: '#dc2626',
            cancelButtonText: '<i class="bi bi-x-lg me-1"></i> Close',
            cancelButtonColor: '#64748b',
            allowOutsideClick: false,
            allowEscapeKey: false,
            customClass: { popup: 'rounded-3xl shadow-2xl border' },
            didOpen: (popup) => {
                const confirmBtn = Swal.getConfirmButton();
                const denyBtn = Swal.getDenyButton();
                const cancelBtn = Swal.getCancelButton();

                if (confirmBtn) {
                    confirmBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        if (cancelBtn) cancelBtn.disabled = true;
                        const refId = window.currentActiveReferralId;
                        Swal.close();
                        submitReferralDecision(refId, 'ACCEPTED');
                    }, { capture: true });
                }

                if (denyBtn) {
                    denyBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        if (cancelBtn) cancelBtn.disabled = true;
                        const refId = window.currentActiveReferralId;
                        Swal.close();
                        promptRedirectReason(refId);
                    }, { capture: true });
                }

                if (cancelBtn) {
                    cancelBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (confirmBtn) confirmBtn.disabled = true;
                        if (denyBtn) denyBtn.disabled = true;
                        cancelBtn.disabled = true;
                        Swal.close();

                        // Keep this referral available in the notification bell so the
                        // hospital can reopen the form and decide later instead of losing it.
                        incomingNotifications.set(referralId, incomingAlert);
                        renderNotificationBell();
                    }, { capture: true });
                }

                // Referring Facility Location and Patient Location are already resolved
                // via resolveLocationAddressHtml() above, through the backend's reverse_geo.php
                // proxy (which has provider fallbacks) instead of calling Nominatim directly
                // from the browser — direct calls can't set the User-Agent header Nominatim's
                // usage policy requires, so they'd silently fail and leave raw coordinates shown.
            }
        });
    }

    let isSubmittingDecision = false;

    const REDIRECT_REASONS = {
        NO_AVAILABLE_BED: 'No available bed',
        SPECIALIST_UNAVAILABLE: 'Required specialist unavailable',
        SERVICE_UNAVAILABLE: 'Required service unavailable',
        EQUIPMENT_UNAVAILABLE: 'Required equipment unavailable',
        OUTSIDE_CAPABILITY: 'Case is outside facility capability',
        TEMPORARY_CLOSURE: 'Temporary closure or service interruption',
        OTHER: 'Other'
    };

    function promptRedirectReason(referralId) {
        const options = Object.entries(REDIRECT_REASONS).map(([code, label]) => `<option value="${code}">${escapeHtml(label)}</option>`).join('');
        Swal.fire({
            icon: 'warning',
            title: 'Reason for Redirecting',
            html: `<div class="text-start"><label class="block text-xs font-semibold text-slate-600 mb-1">Redirect reason <span class="text-red-600">*</span></label><select id="redirectReasonCode" class="w-full h-11 px-3 border border-slate-200 rounded-lg mb-3"><option value="">-- Select a reason --</option>${options}</select><div id="redirectReasonTextWrap" class="hidden"><label class="block text-xs font-semibold text-slate-600 mb-1">Please specify <span class="text-red-600">*</span></label><textarea id="redirectReasonText" maxlength="500" rows="3" class="w-full px-3 py-2 border border-slate-200 rounded-lg" placeholder="Explain why the referral is being redirected"></textarea></div></div>`,
            showCancelButton: true,
            confirmButtonText: 'Redirect Referral',
            confirmButtonColor: '#dc2626',
            didOpen: () => $('#redirectReasonCode').on('change', function () { $('#redirectReasonTextWrap').toggleClass('hidden', this.value !== 'OTHER'); }),
            preConfirm: () => {
                const code = $('#redirectReasonCode').val();
                const text = String($('#redirectReasonText').val() || '').trim();
                if (!code) return Swal.showValidationMessage('Choose a redirect reason.');
                if (code === 'OTHER' && !text) return Swal.showValidationMessage('Describe the other redirect reason.');
                return { redirect_reason_code: code, redirect_reason_text: text };
            }
        }).then(result => {
            if (result.isConfirmed) submitReferralDecision(referralId, 'REDIRECTED', result.value);
        });
    }

    /**
     * Submit Accept / Redirect decision to PATCH /api/v1/referral/{referral_id}/respond
     */
    function submitReferralDecision(referralId, decision, redirectReason) {
        if (!currentHospital || isSubmittingDecision) return;
        isSubmittingDecision = true;

        Swal.fire({
            title: 'Submitting Decision...',
            text: `Transmitting ${decision} decision to central IOL...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const payload = JSON.stringify(Object.assign({ referral_id: referralId, decision: decision }, redirectReason || {}));

        $.ajax({
            url: `${API_BASE}/respond_to_referral.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: payload,
            dataType: 'json',
            success: function (res) {
                isSubmittingDecision = false;
                Swal.fire({
                    icon: 'success',
                    title: `Referral ${decision}!`,
                    text: (res && res.message) || `Decision '${decision}' successfully submitted to central IOL.`,
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            },
            error: function (xhr) {
                isSubmittingDecision = false;
                const errData = xhr.responseJSON || {};
                const rawMsg = errData.message || errData.detail || `Failed to submit referral decision (${xhr.status}).`;

                Swal.fire({
                    icon: 'error',
                    title: 'Decision Submission Failed',
                    text: cleanErrorMessage(rawMsg, xhr.status),
                    confirmButtonColor: '#0d6efd',
                    customClass: { popup: 'rounded-4 shadow-lg' }
                });
            }
        });
    }

    // Returns to Patient Records without saving
    function cancelReferPatient() {
        $('#referralForm')[0].reset();
        $('#modalReasonSelect').empty().append('<option value="" selected disabled hidden>select a reason...</option>').prop('disabled', true);
        resetAdditionalReferralReasons();
        toggleAllergyDetails();
        switchTab('patients');
    }
    $('#btnCancelReferral, #btnCancelReferral2').on('click', cancelReferPatient);

    // Returns to Patient Records without saving
    function cancelAddPatient() {
        $('#patientForm')[0].reset();
        switchTab('patients');
    }

    /**
     * Lock Status Type / PhilHealth Number unless the patient is a PhilHealth member
     */
    function togglePhilhealthFields() {
        const isMember = $('#patPhilhealthMember').val() === 'Yes';
        $('#patPhilhealthStatus, #patPhilhealthNumber').prop('disabled', !isMember);
        if (!isMember) {
            $('#patPhilhealthStatus').val('');
            $('#patPhilhealthNumber').val('');
        }
    }
    $('#patPhilhealthMember').on('change', togglePhilhealthFields);

    /**
     * Navigate to the Register Patient page
     */
    $('#btnAddPatient').on('click', function () {
        $('#patientForm')[0].reset();
        togglePhilhealthFields();
        switchTab('addPatient');
    });

    $('#btnCancelAddPatient, #btnCancelAddPatient2').on('click', cancelAddPatient);

    /**
     * Handle Add Patient Form Submit
     */
    $('#patientForm').on('submit', function (e) {
        e.preventDefault();

        const $submitBtn = $('#btnSubmitPatient');
        const originalBtnHtml = $submitBtn.html();
        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Saving...').prop('disabled', true);

        const formData = {
            first_name: $('#patFirstName').val(),
            middle_name: $('#patMiddleName').val(),
            last_name: $('#patLastName').val(),
            suffix: $('#patSuffix').val(),
            dob: $('#patDob').val(),
            gender: $('#patGender').val(),
            civil_status: $('#patCivilStatus').val(),
            phone: $('#patPhone').val(),
            region: $('#patRegion').val(),
            province: $('#patProvince').val(),
            city_municipality: $('#patCity').val(),
            barangay: $('#patBarangay').val(),
            zip_code: $('#patZip').val(),
            philhealth_member: $('#patPhilhealthMember').val(),
            philhealth_number: $('#patPhilhealthNumber').val(),
            philhealth_status_type: $('#patPhilhealthStatus').val(),
            is_4ps_member: $('#pat4psMember').val()
        };

        submitPatientForm($submitBtn, originalBtnHtml, formData);
    });

    function submitPatientForm($submitBtn, originalBtnHtml, formData) {
        $.ajax({
            url: `${API_BASE}/save_patient.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success: function (response) {
                if (response.success) {
                    $submitBtn.html(originalBtnHtml).prop('disabled', false);
                    $('#patientForm')[0].reset();
                    switchTab('patients');
                    loadPatients();
                    showToast('success', response.data && response.data.linked ? 'Using existing patient record.' : 'Patient registered successfully.', 2500);
                } else if (response.possible_duplicate) {
                    $submitBtn.html(originalBtnHtml).prop('disabled', false);
                    const ep = response.existing_patient;
                    Swal.fire({
                        icon: 'warning',
                        title: 'Possible Existing Patient',
                        html: `<p class="text-sm text-slate-600 text-start">A patient named <strong>${ep.full_name}</strong> (DOB ${ep.dob}) is already on file at your facility, registered ${formatDateTime12h(ep.registered_at)}. Link to that record, or create a new one?</p>`,
                        showDenyButton: true,
                        showCancelButton: true,
                        confirmButtonText: 'Link to Existing',
                        denyButtonText: 'Create New Anyway',
                        cancelButtonText: 'Cancel',
                        confirmButtonColor: '#16a34a',
                        denyButtonColor: '#f59e0b',
                        reverseButtons: true
                    }).then(function (choice) {
                        if (choice.isConfirmed) {
                            $submitBtn.prop('disabled', true);
                            submitPatientForm($submitBtn, originalBtnHtml, Object.assign({}, formData, { duplicate_choice: 'link', link_patient_id: ep.id }));
                        } else if (choice.isDenied) {
                            $submitBtn.prop('disabled', true);
                            submitPatientForm($submitBtn, originalBtnHtml, Object.assign({}, formData, { duplicate_choice: 'new' }));
                        }
                    });
                } else {
                    $submitBtn.html(originalBtnHtml).prop('disabled', false);
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Register Patient',
                        text: response.message || 'Please check the form and try again.',
                        confirmButtonColor: '#dc3545'
                    });
                }
            },
            error: function (xhr) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: `Failed to register patient (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    }

    /**
     * Load facility staff accounts (Facility Admin only)
     */
    function loadUsers() {
        const $tableBody = $('#usersTableBody');
        $tableBody.html(`
            <tr>
                <td colspan="7" class="text-center py-4 text-muted">
                    <div class="spinner-border spinner-border-sm me-2 text-primary" role="status"></div>
                    Loading staff accounts...
                </td>
            </tr>
        `);

        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.success && Array.isArray(response.data)) {
                    renderUsersTable(response.data);
                } else {
                    $tableBody.html(`
                        <tr>
                            <td colspan="7" class="text-center py-4 text-danger">
                                ${response.message || 'Failed to load staff accounts.'}
                            </td>
                        </tr>
                    `);
                }
            },
            error: function (xhr, status, error) {
                $tableBody.html(`
                    <tr>
                        <td colspan="7" class="text-center py-4 text-danger">
                            Error connecting to backend API (${xhr.status} ${error}).
                        </td>
                    </tr>
                `);
            }
        });
    }

    const ROLE_LABELS = { facility_admin: 'Facility Admin', doctor: 'Doctor', nurse: 'Nurse' };

    function renderUsersTable(users) {
        const $tableBody = $('#usersTableBody');
        $tableBody.empty();

        if (users.length === 0) {
            $tableBody.html(`<tr><td colspan="7" class="text-center py-4 text-muted">No staff accounts yet.</td></tr>`);
            return;
        }

        users.forEach(function (user) {
            const statusBadge = user.is_active
                ? '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'
                : '<span class="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-500 border border-slate-200">Inactive</span>';
            const isSelf = currentUser && currentUser.id === user.id;

            const row = `
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-semibold text-slate-900 border-b border-slate-300/60">${escapeHtml(user.full_name)}${isSelf ? ' <span class="text-[10px] text-slate-400 font-normal">(you)</span>' : ''}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${escapeHtml(user.username)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(ROLE_LABELS[user.role] || user.role)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${user.license_number ? escapeHtml(user.license_number) : '<span class="text-slate-300">—</span>'}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60 max-w-[220px] truncate" title="${escapeHtml(user.trainings || '')}">${user.trainings ? escapeHtml(user.trainings) : '<span class="text-slate-300">—</span>'}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60">${statusBadge}</td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60">
                        <div class="flex items-center justify-end gap-2">
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-blue-600 border border-blue-300 text-xs font-medium rounded-lg shadow-sm transition-all btn-edit-user"
                                data-id="${user.id}" data-full-name="${escapeHtml(user.full_name)}" data-role="${escapeHtml(user.role)}"
                                data-license-number="${escapeHtml(user.license_number || '')}" data-trainings="${escapeHtml(user.trainings || '')}">
                                Edit
                            </button>
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm transition-all btn-toggle-user" data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                                ${user.is_active ? 'Deactivate' : 'Activate'}
                            </button>
                            <button class="px-3 py-1.5 bg-white/50 hover:bg-white text-red-600 border border-red-300 text-xs font-medium rounded-lg shadow-sm transition-all btn-delete-user" data-id="${user.id}" ${isSelf ? 'disabled' : ''}>
                                Delete
                            </button>
                        </div>
                    </td>
                </tr>
            `;
            $tableBody.append(row);
        });
    }

    $('#btnRefreshUsers').on('click', function () { loadUsers(); });

    // Clinical credentials (license number / trainings) only make sense for Doctor/Nurse
    function toggleUserClinicalFields() {
        const isClinical = $('#inputUserRole').val() !== 'facility_admin';
        $('#userClinicalFields').toggle(isClinical);
        if (!isClinical) {
            $('#inputUserLicenseNumber, #inputUserTrainings').val('');
        }
    }
    $('#inputUserRole').on('change', toggleUserClinicalFields);
    toggleUserClinicalFields();

    $('#btnGenerateUserPassword').on('click', function () {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let pwd = '';
        for (let i = 0; i < 8; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        $('#inputUserPassword').val(pwd).attr('type', 'text');
    });

    $('#addUserForm').on('submit', function (e) {
        e.preventDefault();

        const $submitBtn = $('#btnSubmitAddUser');
        const originalBtnHtml = $submitBtn.html();
        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Creating...').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'POST',
            data: {
                full_name: $('#inputUserFullName').val(),
                role: $('#inputUserRole').val(),
                username: $('#inputUserUsername').val(),
                password: $('#inputUserPassword').val(),
                license_number: $('#inputUserLicenseNumber').val(),
                trainings: $('#inputUserTrainings').val()
            },
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                if (response.success) {
                    $('#addUserForm')[0].reset();
                    toggleUserClinicalFields();
                    loadUsers();
                    showToast('success', 'Staff account created.', 2500);
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Create Account',
                        text: response.message || 'Please check the form and try again.',
                        confirmButtonColor: '#dc3545'
                    });
                }
            },
            error: function (xhr) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                const serverMsg = xhr.responseJSON && xhr.responseJSON.message;
                Swal.fire({
                    icon: 'error',
                    title: 'Could Not Create Account',
                    text: serverMsg || `Failed to create account (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    });

    /**
     * Lets a facility_admin edit one of their own facility's staff accounts --
     * full name, role, clinical credentials, and optionally a new password (left
     * blank to keep the current one). Scoped server-side to the admin's own
     * facility_id, same as every other manage_users.php action.
     */
    $(document).on('click', '.btn-edit-user', function () {
        const $btn = $(this);
        const userId = $btn.data('id');
        const currentFullName = $btn.data('full-name');
        const currentRole = $btn.data('role');
        const currentLicenseNumber = $btn.data('license-number');
        const currentTrainings = $btn.data('trainings');

        Swal.fire({
            title: 'Edit Staff Account',
            html: `
                <div class="text-start">
                    <label class="block text-xs font-semibold text-slate-500 mb-1">Full Name</label>
                    <input type="text" id="editUserFullName" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentFullName)}">

                    <label class="block text-xs font-semibold text-slate-500 mb-1">Role</label>
                    <select id="editUserRole" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3">
                        <option value="facility_admin" ${currentRole === 'facility_admin' ? 'selected' : ''}>Facility Admin</option>
                        <option value="doctor" ${currentRole === 'doctor' ? 'selected' : ''}>Doctor</option>
                        <option value="nurse" ${currentRole === 'nurse' ? 'selected' : ''}>Nurse</option>
                    </select>

                    <div id="editUserClinicalFields">
                        <label class="block text-xs font-semibold text-slate-500 mb-1">License Number</label>
                        <input type="text" id="editUserLicenseNumber" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentLicenseNumber)}">

                        <label class="block text-xs font-semibold text-slate-500 mb-1">Trainings</label>
                        <input type="text" id="editUserTrainings" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500 mb-3" value="${escapeHtml(currentTrainings)}">
                    </div>

                    <label class="block text-xs font-semibold text-slate-500 mb-1">New Password</label>
                    <input type="password" id="editUserNewPassword" class="w-full h-10 px-3 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500" placeholder="Leave blank to keep current password">
                </div>
            `,
            showCancelButton: true,
            confirmButtonText: 'Save Changes',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#2563eb',
            reverseButtons: true,
            focusConfirm: false,
            didOpen: function () {
                const toggleClinicalFields = function () {
                    $('#editUserClinicalFields').toggle($('#editUserRole').val() !== 'facility_admin');
                };
                $('#editUserRole').on('change', toggleClinicalFields);
                toggleClinicalFields();
            },
            preConfirm: function () {
                const fullName = $('#editUserFullName').val().trim();
                const role = $('#editUserRole').val();
                if (!fullName) {
                    Swal.showValidationMessage('Full name is required.');
                    return false;
                }
                const newPassword = $('#editUserNewPassword').val();
                if (newPassword && newPassword.length < 6) {
                    Swal.showValidationMessage('Password must be at least 6 characters.');
                    return false;
                }
                return {
                    full_name: fullName,
                    role: role,
                    license_number: $('#editUserLicenseNumber').val(),
                    trainings: $('#editUserTrainings').val(),
                    new_password: newPassword
                };
            }
        }).then(function (result) {
            if (!result.isConfirmed) return;

            $.ajax({
                url: `${API_BASE}/manage_users.php`,
                type: 'PATCH',
                contentType: 'application/json',
                data: JSON.stringify(Object.assign({ id: userId, action: 'edit' }, result.value)),
                dataType: 'json',
                success: function (response) {
                    if (response.success) {
                        showToast('success', response.message || 'Staff account updated.', 2500);
                        loadUsers();
                    } else {
                        Swal.fire({ icon: 'error', title: 'Could Not Update Account', text: response.message, confirmButtonColor: '#dc3545' });
                    }
                },
                error: function (xhr) {
                    const errData = xhr.responseJSON || {};
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Update Account',
                        text: errData.message || `Request failed (${xhr.status}).`,
                        confirmButtonColor: '#dc3545'
                    });
                }
            });
        });
    });

    $(document).on('click', '.btn-toggle-user', function () {
        const userId = $(this).data('id');
        $.ajax({
            url: `${API_BASE}/manage_users.php`,
            type: 'PATCH',
            contentType: 'application/json',
            data: JSON.stringify({ id: userId, action: 'toggle_active' }),
            dataType: 'json',
            success: function (response) {
                if (response.success) {
                    loadUsers();
                } else {
                    Swal.fire({ icon: 'error', title: 'Error', text: response.message || 'Could not update account.', confirmButtonColor: '#dc3545' });
                }
            }
        });
    });

    $(document).on('click', '.btn-delete-user', function () {
        const userId = $(this).data('id');
        Swal.fire({
            title: 'Remove this account?',
            text: 'This staff member will no longer be able to log in.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc3545',
            confirmButtonText: 'Yes, Remove'
        }).then((result) => {
            if (result.isConfirmed) {
                $.ajax({
                    url: `${API_BASE}/manage_users.php?id=${encodeURIComponent(userId)}`,
                    type: 'DELETE',
                    dataType: 'json',
                    success: function (response) {
                        if (response.success) {
                            loadUsers();
                        } else {
                            Swal.fire({ icon: 'error', title: 'Error', text: response.message || 'Could not remove account.', confirmButtonColor: '#dc3545' });
                        }
                    }
                });
            }
        });
    });

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

    /**
     * PSGC API (https://psgc.cloud/api) Cascading Location Selector.
     * Shared cache + fetch logic, instantiated per set of region/province/city/barangay
     * selects (referral modal has geocoding, patient modal is just the four dropdowns).
     */
    let psgcCache = {
        regions: null,
        provinces: {},
        cities: {},
        barangays: {}
    };

    // psgc.cloud occasionally returns unrelated entries appended to a province/region's
    // city list (observed: Sarangani's cities-municipalities response also includes every
    // Metro Manila city/sub-municipality -- codes starting "13" (NCR) under a "12"
    // (SOCCSKSARGEN) province). Filter by the outer 2-digit REGION prefix only, not the
    // deeper province-level block: a Highly Urbanized City like City of Davao is coded
    // outside any province's own numbering block (1130700000 vs Davao del Sur's
    // 1102400000) even though it's correctly still part of that region and legitimately
    // belongs in the dropdown -- filtering on the full province prefix wrongly excluded it.
    function filterCitiesToExpectedArea(cities, regionCode) {
        const regionPrefix = regionCode ? regionCode.substring(0, 2) : null;
        if (!regionPrefix) return cities;
        const filtered = cities.filter(c => c.code && c.code.substring(0, 2) === regionPrefix);
        return filtered.length > 0 ? filtered : cities;
    }

    /**
     * @param {{region:string, province:string, city:string, barangay:string}} sel jQuery selectors
     * @param {function(string,string,string,string):void} [onResolved] called with (region, province, city, barangay) after every cascade step
     */
    function createLocationCascade(sel, onResolved) {
        let eventsBound = false;
        // When set (via init(preferredTarget)), each dropdown prefers selecting this exact
        // value over the hardcoded Davao-area defaults below -- used to prefill a patient's
        // own registered address instead of always defaulting to Davao City.
        let preferredTarget = null;
        const hasPreferred = function (fieldName) {
            return !!(preferredTarget && preferredTarget[fieldName]);
        };
        const prefers = function (fieldName, optionName) {
            return hasPreferred(fieldName) &&
                optionName.trim().toLowerCase() === preferredTarget[fieldName].trim().toLowerCase();
        };

        function resolve() {
            if (onResolved) {
                onResolved($(sel.region).val(), $(sel.province).val(), $(sel.city).val(), $(sel.barangay).val());
            }
        }

        function loadRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append('<option value="">Loading regions...</option>');

            if (psgcCache.regions && psgcCache.regions.length > 0) {
                populateRegionDropdown(psgcCache.regions);
                return;
            }

            $.ajax({
                url: 'https://psgc.cloud/api/regions',
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data) && data.length > 0) {
                        psgcCache.regions = data;
                        populateRegionDropdown(data);
                    } else {
                        fallbackRegions();
                    }
                },
                error: function() {
                    fallbackRegions();
                }
            });
        }

        function populateRegionDropdown(regions) {
            const $regionSelect = $(sel.region);
            $regionSelect.empty();

            regions.forEach(region => {
                const option = $('<option>')
                    .attr('value', region.name)
                    .attr('data-code', region.code)
                    .text(region.name);

                // Prefer the patient's own registered region if we have one; otherwise
                // default to Region XI (Davao Region)
                if (hasPreferred('region') ? prefers('region', region.name) : (region.code === '1100000000' || region.name.includes('Davao'))) {
                    option.prop('selected', true);
                }

                $regionSelect.append(option);
            });

            if (!$regionSelect.val() && regions.length > 0) {
                $regionSelect.val(regions[0].name);
            }

            loadProvincesForSelectedRegion();
        }

        function fallbackRegions() {
            const $regionSelect = $(sel.region);
            $regionSelect.empty().append(`
                <option value="Region XI (Davao Region)" data-code="1100000000" selected>Region XI (Davao Region)</option>
                <option value="Region X (Northern Mindanao)" data-code="1000000000">Region X (Northern Mindanao)</option>
                <option value="Region IX (Zamboanga Peninsula)" data-code="0900000000">Region IX (Zamboanga Peninsula)</option>
                <option value="Region XII (SOCCSKSARGEN)" data-code="1200000000">Region XII (SOCCSKSARGEN)</option>
                <option value="Region XIII (Caraga)" data-code="1600000000">Region XIII (Caraga)</option>
                <option value="BARMM" data-code="1900000000">BARMM</option>
                <option value="NCR (Metro Manila)" data-code="1300000000">NCR (Metro Manila)</option>
            `);
            loadProvincesForSelectedRegion();
        }

        function loadProvincesForSelectedRegion() {
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append('<option value="">Loading provinces...</option>');

            if (!regionCode) {
                loadCitiesForSelectedProvince();
                return;
            }

            if (psgcCache.provinces[regionCode]) {
                populateProvinceDropdown(psgcCache.provinces[regionCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/regions/${regionCode}/provinces`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.provinces[regionCode] = data;
                        populateProvinceDropdown(data);
                    } else {
                        fallbackProvinces();
                    }
                },
                error: function() {
                    fallbackProvinces();
                }
            });
        }

        function populateProvinceDropdown(provinces) {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty();

            if (provinces.length === 0) {
                const regionName = $(sel.region).val();
                $provinceSelect.append(`<option value="${regionName}" data-code="N/A">${regionName}</option>`);
            } else {
                provinces.forEach(prov => {
                    const option = $('<option>')
                        .attr('value', prov.name)
                        .attr('data-code', prov.code)
                        .text(prov.name);

                    if (hasPreferred('province') ? prefers('province', prov.name) : prov.name.includes('Davao del Sur')) {
                        option.prop('selected', true);
                    }
                    $provinceSelect.append(option);
                });

                if (!$provinceSelect.val() && provinces.length > 0) {
                    $provinceSelect.val(provinces[0].name);
                }
            }

            loadCitiesForSelectedProvince();
        }

        function fallbackProvinces() {
            const $provinceSelect = $(sel.province);
            $provinceSelect.empty().append(`
                <option value="Davao del Sur" data-code="1102400000" selected>Davao del Sur</option>
                <option value="Davao del Norte" data-code="1102300000">Davao del Norte</option>
                <option value="Misamis Oriental" data-code="1004300000">Misamis Oriental</option>
                <option value="South Cotabato" data-code="1206300000">South Cotabato</option>
            `);
            loadCitiesForSelectedProvince();
        }

        function loadCitiesForSelectedProvince() {
            const provinceCode = $(sel.province).find('option:selected').attr('data-code');
            const regionCode = $(sel.region).find('option:selected').attr('data-code');
            const $citySelect = $(sel.city);
            $citySelect.empty().append('<option value="">Loading cities...</option>');

            const fetchUrl = (provinceCode && provinceCode !== 'N/A')
                ? `https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`
                : `https://psgc.cloud/api/regions/${regionCode}/cities-municipalities`;

            const cacheKey = (provinceCode && provinceCode !== 'N/A') ? provinceCode : `region_${regionCode}`;

            if (psgcCache.cities[cacheKey]) {
                populateCityDropdown(psgcCache.cities[cacheKey]);
                return;
            }

            $.ajax({
                url: fetchUrl,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        const cleanData = filterCitiesToExpectedArea(data, regionCode);
                        psgcCache.cities[cacheKey] = cleanData;
                        populateCityDropdown(cleanData);
                    } else {
                        fallbackCities();
                    }
                },
                error: function() {
                    fallbackCities();
                }
            });
        }

        function populateCityDropdown(cities) {
            const $citySelect = $(sel.city);
            $citySelect.empty();

            cities.forEach(city => {
                const option = $('<option>')
                    .attr('value', city.name)
                    .attr('data-code', city.code)
                    .text(city.name);

                if (hasPreferred('city') ? prefers('city', city.name) : city.name.includes('Davao')) {
                    option.prop('selected', true);
                }
                $citySelect.append(option);
            });

            if (!$citySelect.val() && cities.length > 0) {
                $citySelect.val(cities[0].name);
            }

            loadBarangaysForSelectedCity();
        }

        function fallbackCities() {
            const $citySelect = $(sel.city);
            $citySelect.empty().append(`
                <option value="City of Davao" data-code="1130700000" selected>City of Davao</option>
                <option value="City of Digos" data-code="1102403000">City of Digos</option>
                <option value="Santa Cruz" data-code="1102412000">Santa Cruz</option>
            `);
            loadBarangaysForSelectedCity();
        }

        function loadBarangaysForSelectedCity() {
            const cityCode = $(sel.city).find('option:selected').attr('data-code');
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append('<option value="">Loading barangays...</option>');

            if (!cityCode) {
                resolve();
                return;
            }

            if (psgcCache.barangays[cityCode]) {
                populateBarangayDropdown(psgcCache.barangays[cityCode]);
                return;
            }

            $.ajax({
                url: `https://psgc.cloud/api/cities-municipalities/${cityCode}/barangays`,
                type: 'GET',
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 5000,
                success: function(data) {
                    if (Array.isArray(data)) {
                        psgcCache.barangays[cityCode] = data;
                        populateBarangayDropdown(data);
                    } else {
                        fallbackBarangays();
                    }
                },
                error: function() {
                    fallbackBarangays();
                }
            });
        }

        function populateBarangayDropdown(barangays) {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty();

            if (barangays.length === 0) {
                $barangaySelect.append('<option value="Poblacion" data-code="N/A">Poblacion</option>');
            } else {
                barangays.forEach(brgy => {
                    const option = $('<option>')
                        .attr('value', brgy.name)
                        .attr('data-code', brgy.code)
                        .text(brgy.name);

                    if (hasPreferred('barangay') ? prefers('barangay', brgy.name) : (brgy.name.toLowerCase().includes('buhangin') || brgy.name.toLowerCase().includes('poblacion'))) {
                        option.prop('selected', true);
                    }
                    $barangaySelect.append(option);
                });

                if (!$barangaySelect.val() && barangays.length > 0) {
                    $barangaySelect.val(barangays[0].name);
                }
            }

            resolve();
        }

        function fallbackBarangays() {
            const $barangaySelect = $(sel.barangay);
            $barangaySelect.empty().append(`
                <option value="Buhangin" data-code="1130700100" selected>Buhangin</option>
                <option value="Poblacion" data-code="1130700200">Poblacion</option>
                <option value="Agdao" data-code="1130700300">Agdao</option>
            `);
            resolve();
        }

        return {
            /**
             * @param {{region:string, province:string, city:string, barangay:string}} [target]
             *   When given, each dropdown selects this exact address instead of the
             *   hardcoded Davao-area defaults -- e.g. a patient's own registered address.
             */
            init: function(target) {
                preferredTarget = target || null;
                if (!eventsBound) {
                    eventsBound = true;
                    $(sel.region).on('change', loadProvincesForSelectedRegion);
                    $(sel.province).on('change', loadCitiesForSelectedProvince);
                    $(sel.city).on('change', loadBarangaysForSelectedCity);
                    $(sel.barangay).on('change', resolve);
                }
                loadRegions();
            }
        };
    }

    let geocodeDebounceTimer = null;

    function applyCoordinates(lat, lng) {
        const latFormatted = parseFloat(lat).toFixed(6);
        const lngFormatted = parseFloat(lng).toFixed(6);

        $('#modalLatitude').val(latFormatted);
        $('#modalLongitude').val(lngFormatted);
        $('#displayLatLongText').text(`${latFormatted}, ${lngFormatted}`);
    }

    const referralLocationCascade = createLocationCascade({
        region: '#selectRegion', province: '#selectProvince', city: '#selectCity', barangay: '#selectBarangay'
    }, function(region, province, city, barangay) {
        const resolvedAddress = [barangay, city, province, region].filter(Boolean).join(', ');
        $('#displayResolvedAddress').text(resolvedAddress);

        let defaultLat = 7.1907;
        let defaultLng = 125.4553;

        if (city) {
            const cLower = city.toLowerCase();
            if (cLower.includes('cagayan de oro')) { defaultLat = 8.4542; defaultLng = 124.6319; }
            else if (cLower.includes('general santos')) { defaultLat = 6.1164; defaultLng = 125.1716; }
            else if (cLower.includes('zamboanga')) { defaultLat = 6.9214; defaultLng = 122.0790; }
            else if (cLower.includes('butuan')) { defaultLat = 8.9475; defaultLng = 125.5406; }
            else if (cLower.includes('digos')) { defaultLat = 6.7583; defaultLng = 125.3572; }
            else if (cLower.includes('cebu')) { defaultLat = 10.3157; defaultLng = 123.8854; }
            else if (cLower.includes('manila') || cLower.includes('quezon')) { defaultLat = 14.5995; defaultLng = 120.9842; }
        }

        applyCoordinates(defaultLat, defaultLng);

        if (geocodeDebounceTimer) clearTimeout(geocodeDebounceTimer);

        geocodeDebounceTimer = setTimeout(() => {
            const query = `${barangay ? barangay + ', ' : ''}${city}, ${province}, Philippines`;

            $.ajax({
                url: 'https://nominatim.openstreetmap.org/search',
                data: { format: 'json', q: query, limit: 1 },
                dataType: 'json',
                xhrFields: { withCredentials: false },
                timeout: 4000,
                success: function(results) {
                    if (results && results.length > 0) {
                        const lat = parseFloat(results[0].lat);
                        const lng = parseFloat(results[0].lon);
                        applyCoordinates(lat, lng);
                    }
                }
            });
        }, 400);
    });

    const patientLocationCascade = createLocationCascade({
        region: '#patRegion', province: '#patProvince', city: '#patCity', barangay: '#patBarangay'
    });

    // ============================================================
    // REAL-TIME REFERRAL UPDATES (WebSocket)
    // ============================================================
    // Pushes referral lifecycle events (new/seen/accepted/redirected/finalized/
    // not-selected/cancelled/arrived) instantly instead of waiting on a poll
    // timer. Browser WebSockets can't carry the RSA signature headers used by
    // every REST call, so a short-lived one-time ticket is fetched from the
    // PHP backend (which signs the ticket request) and passed as a query param.
    let referralSocket = null;
    let wsReconnectTimeout = null;
    let wsReconnectAttempts = 0;
    let wsManuallyClosed = false;

    /**
     * Routes a pushed WebSocket event to the existing REST refresh function that
     * already knows how to fetch and render the affected data -- the WS payload
     * itself only ever carries enough info to know *what* to refresh, not the
     * full record, keeping a single source of truth for rendering logic.
     */
    function handleWsMessage(msg) {
        if (!msg || !msg.type) return;

        switch (msg.type) {
            case 'NEW_REFERRAL':
            case 'REFERRAL_CANCELLED':
                pollIncomingReferrals();
                break;

            case 'REFERRAL_SEEN':
            case 'REFERRAL_ACCEPTED':
            case 'REFERRAL_REDIRECTED':
            case 'REFERRAL_FINALIZED_CONFIRMED':
                checkAndPollRecommendations();
                if ($('#tabReferralsContent').is(':visible')) loadMyReferrals();
                break;

            case 'REFERRAL_FINALIZED_TO_YOU':
                showToast('success', 'A referral has been finalized to your facility!', 4000);
                playNotificationSound();
                if ($('#tabIncomingContent').is(':visible')) loadAcceptedPatients();
                break;

            case 'REFERRAL_NOT_SELECTED':
                if ($('#tabIncomingContent').is(':visible')) loadAcceptedPatients();
                break;

            case 'PATIENT_ARRIVED':
            case 'PATIENT_DEPARTED':
                if ($('#tabReferralsContent').is(':visible')) loadMyReferrals();
                break;

            default:
                break;
        }
    }

    /**
     * Fetches a fresh one-time ticket and opens the real-time referral socket;
     * reconnects with capped exponential backoff on drop (network blip, IOL
     * restart) as long as the session is still active.
     */
    function connectReferralWebSocket() {
        if (!currentHospital || referralSocket) return;
        wsManuallyClosed = false;

        $.ajax({
            url: `${API_BASE}/get_ws_ticket.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (!response.success || !response.ws_url) {
                    scheduleWsReconnect();
                    return;
                }

                try {
                    referralSocket = new WebSocket(response.ws_url);
                } catch (e) {
                    referralSocket = null;
                    scheduleWsReconnect();
                    return;
                }

                referralSocket.onopen = function () {
                    wsReconnectAttempts = 0;
                };

                referralSocket.onmessage = function (event) {
                    try {
                        handleWsMessage(JSON.parse(event.data));
                    } catch (e) { /* ignore malformed frame */ }
                };

                referralSocket.onclose = function () {
                    referralSocket = null;
                    if (!wsManuallyClosed && currentHospital) scheduleWsReconnect();
                };

                referralSocket.onerror = function () {
                    if (referralSocket) referralSocket.close();
                };
            },
            error: function () {
                scheduleWsReconnect();
            }
        });
    }

    function scheduleWsReconnect() {
        clearTimeout(wsReconnectTimeout);
        wsReconnectAttempts++;
        const delay = Math.min(30000, 2000 * wsReconnectAttempts);
        wsReconnectTimeout = setTimeout(connectReferralWebSocket, delay);
    }

    function disconnectReferralWebSocket() {
        wsManuallyClosed = true;
        clearTimeout(wsReconnectTimeout);
        wsReconnectAttempts = 0;
        if (referralSocket) {
            referralSocket.onclose = null;
            referralSocket.close();
            referralSocket = null;
        }
    }

    // Slow fallback polling only -- WebSocket delivers real-time updates above,
    // this just guards against a missed push (e.g. reconnect race, backgrounded tab)
    setInterval(pollIncomingReferrals, 45000);
    setInterval(checkAndPollRecommendations, 30000);
    setInterval(loadAcceptedPatients, 45000);

    // Exposed so service_assessment.js (a separate script/closure) can navigate back
    // to the facility admin's home tab after a successful DOH Assessment submission,
    // and so any script can raise a toast in the shared design.
    window.switchTab = switchTab;
    window.showToast = showToast;

    // Initialize session check
    checkSession();
});
