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


    // Active Facility State (kept as `currentHospital` since referral/inventory/outcomes
    // code throughout this file already treats it as the logged-in facility's own record)
    let currentHospital = null;
    // Active Staff User State (role-based nav & assessment lockout)
    let currentUser = null;

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

        $('#hospitalLogo').attr('src', logo);
        console.log(hospitalCode)
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

        const $allTabs = $('#tabPatientsContent, #tabAddPatientContent, #tabReferPatientContent, #tabPendingContent, #tabReferralsContent, #tabIncomingContent, #tabUsersContent, #tabAssessmentContent');

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

                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: `Welcome back, ${response.user.full_name}!`,
                        showConfirmButton: false,
                        timer: 3000
                    });
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

                        Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'info',
                            title: 'Signed out successfully.',
                            showConfirmButton: false,
                            timer: 2500
                        });
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
                    <td colspan="6" class="text-center py-4 text-muted">
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

            const row = `
                <tr class="!bg-slate-200/40 hover:!bg-slate-300/40 transition-colors">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500 border-b border-slate-300/60">#${patient.id}</td>
                    <td class="py-3.5 px-6 font-semibold text-slate-900 border-b border-slate-300/60">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs border-b border-slate-300/60">${escapeHtml(patient.dob)}</td>
                    <td class="py-3.5 px-6 border-b border-slate-300/60"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${genderBadgeClass}">${escapeHtml(patient.gender)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono border-b border-slate-300/60">${escapeHtml(patient.phone)}</td>
                    <td class="py-3.5 px-6 text-right border-b border-slate-300/60">
                        <button class="px-3.5 py-1.5 bg-white/50 hover:bg-white text-slate-600 border border-slate-600/50 text-xs font-medium rounded-lg shadow-sm hover:shadow-lg hover:border-slate-700/60 hover:text-slate-700  active:scale-[0.98] transition-all btn-refer-patient flex items-center gap-1.5 ml-auto" data-id="${patient.id}">
                            <i class="bi bi-send-plus"></i> Refer
                        </button>
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
            }
        });
    }


    /**
     * Open Referral Modal for a specific patient
     */
    $(document).on('click', '.btn-refer-patient', function () {
        const patientId = $(this).data('id');
        const $btn = $(this);
        const originalText = $btn.html();

        $btn.html('<span class="spinner-border spinner-border-sm" role="status"></span>').prop('disabled', true);

        $.ajax({
            url: `${API_BASE}/get_patients.php`,
            type: 'GET',
            data: { id: patientId },
            dataType: 'json',
            success: function (response) {
                $btn.html(originalText).prop('disabled', false);

                if (response.success && response.data) {
                    const patient = response.data;

                    $('#modalPatientId').val(patient.id);
                    $('#modalPatientName').text(`${patient.first_name} ${patient.last_name}`);
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
                    toggleReferralReasonOther();
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
                $btn.html(originalText).prop('disabled', false);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: `Failed to fetch patient data (${xhr.status}).`,
                    confirmButtonColor: '#2563eb'
                });
            }
        });
    });

    /**
     * When "Others" is picked in the Referral Reason dropdown, reveal the free-text
     * field for the doctor to specify it; otherwise keep #modalReasonText (the field
     * actually submitted) synced to the selected dropdown option.
     */
    function toggleReferralReasonOther() {
        const selected = $('#modalReasonSelect').val();
        if (selected === 'Others') {
            $('#modalReasonText').removeClass('hidden').val('');
        } else {
            $('#modalReasonText').addClass('hidden').val(selected);
        }
    }
    $('#modalReasonSelect').on('change', toggleReferralReasonOther);

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

    /**
     * Handle Referral Form Submit
     */
    $('#referralForm').on('submit', function (e) {
        e.preventDefault();

        const $submitBtn = $('#btnSubmitReferral');
        const originalBtnHtml = $submitBtn.html();

        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Transmitting...').prop('disabled', true);

        const formData = {
            patient_id: parseInt($('#modalPatientId').val(), 10) || 1,
            latitude: parseFloat($('#modalLatitude').val()) || 7.1907,
            longitude: parseFloat($('#modalLongitude').val()) || 125.4553,
            severity: parseFloat($('#modalSeverity').val()) || 3,
            reason_text: $('#modalReasonText').val() || 'Severe Pneumonia',
            reason_code: '233604007',
            diagnosis: $('#modalDiagnosis').val() || 'Pneumonia',
            chief_complaint: $('#modalChiefComplaint').val() || '',
            vital_bp: $('#modalVitalBp').val() || '',
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
            allergy_details: $('#modalHasAllergy').is(':checked') ? ($('#modalAllergyDetails').val() || '') : ''
        };

        $.ajax({
            url: `${API_BASE}/send_referral.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                if (response.success) {
                    switchTab('patients');
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
                                    <span class="text-xs font-semibold leading-relaxed">Please wait for receiving hospitals to accept your referral. Accepting facilities will appear on the "My Referrals" page.</span>
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
            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'API Key copied to clipboard!',
                showConfirmButton: false,
                timer: 2000
            });
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
    function loadAcceptedPatients() {
        if (!currentHospital) return;

        const apiKey = currentHospital.api_key || '';
        const $list = $('#acceptedPatientsList');

        $.ajax({
            url: `${API_V1_REFERRAL}/outcomes`,
            type: 'GET',
            headers: { 'X-API-Key': apiKey },
            dataType: 'json',
            success: function (data) {
                const all = Array.isArray(data) ? data : [];
                const chosen = all.filter(o => o.outcome === 'CHOSEN');
                const bypassed = all.filter(o => o.outcome === 'BYPASSED');

                $('#statTransferredToUs').text(chosen.length);
                $('#statRedirectedElsewhere').text(bypassed.length);

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

                    return `
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4">
                            <div class="min-w-0 flex-1">
                                <p class="text-sm font-semibold text-slate-900">${escapeHtml(o.clinical_reason || 'Referral')}</p>
                                <p class="text-xs text-slate-500 mt-0.5 break-words">
                                    From <strong>${escapeHtml(o.referring_facility)}</strong> &middot;
                                    Severity ${escapeHtml(String(o.disease_severity))} &middot;
                                    ${formatReferralTimestamp(o.created_at)}
                                </p>
                            </div>
                            <div class="flex flex-wrap items-center gap-2 flex-shrink-0">
                                ${arrivalControl}
                                <button type="button" data-referral-id="${escapeHtml(o.referral_id)}"
                                    class="btn-view-patient-details inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-all">
                                    <i class="bi bi-person-lines-fill"></i> View Full Patient Details
                                </button>
                            </div>
                        </div>
                    `;
                }).join(''));
            },
            error: function () {
                $list.html('<div class="px-6 py-6 text-center text-xs text-red-500">Could not load finalized referrals.</div>');
            }
        });
    }

    $(document).on('click', '.btn-mark-arrived', function () {
        const $btn = $(this);
        const referralId = $btn.data('referral-id');
        const originalHtml = $btn.html();

        Swal.fire({
            icon: 'question',
            title: 'Mark Patient as Arrived?',
            text: 'This will confirm the patient has physically arrived at your facility and add them to your Patient Records.',
            showCancelButton: true,
            confirmButtonText: 'Yes, Mark as Arrived',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#f59e0b',
            reverseButtons: true
        }).then(function (result) {
            if (!result.isConfirmed) return;
            submitMarkArrived($btn, referralId, originalHtml);
        });
    });

    function submitMarkArrived($btn, referralId, originalHtml) {
        $btn.prop('disabled', true).html('<span class="inline-block animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></span> Marking...');

        $.ajax({
            url: `${API_BASE}/receive_transferred_patient.php`,
            type: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({ referral_id: referralId }),
            dataType: 'json',
            success: function (response) {
                if (response.success) {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: response.message || 'Patient marked as arrived.',
                        showConfirmButton: false,
                        timer: 3000
                    });
                    loadAcceptedPatients();
                    if (typeof loadPatients === 'function') loadPatients();
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

    $(document).on('click', '.btn-view-patient-details', function () {
        const referralId = $(this).data('referral-id');

        $.ajax({
            url: `${API_BASE}/get_transferred_patient_details.php?referral_id=${encodeURIComponent(referralId)}`,
            type: 'GET',
            dataType: 'json',
            success: function (d) {
                const vitalTile = function (label, value) {
                    return `
                        <div class="bg-slate-50 rounded-lg p-2.5 text-center">
                            <p class="text-[10px] uppercase tracking-wide text-slate-500">${label}</p>
                            <p class="font-semibold text-slate-900">${escapeHtml(value != null && value !== '' ? String(value) : '—')}</p>
                        </div>
                    `;
                };

                Swal.fire({
                    title: 'Patient Details',
                    width: '46rem',
                    html: `
                        <div class="text-start text-sm">
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pb-4 mb-4 border-b border-slate-200">
                                <p><strong>Full Name:</strong> ${escapeHtml(d.full_name || '—')}</p>
                                <p><strong>DOB:</strong> ${escapeHtml(d.date_of_birth || '—')}</p>
                                <p><strong>Age:</strong> ${d.age ?? '—'}</p>
                                <p><strong>Gender:</strong> ${escapeHtml(d.gender || '—')}</p>
                                <p><strong>Civil Status:</strong> ${escapeHtml(d.civil_status || '—')}</p>
                                <p><strong>Phone:</strong> ${escapeHtml(d.phone || '—')}</p>
                                <p><strong>PhilHealth:</strong> ${escapeHtml(d.philhealth_status || '—')} ${d.philhealth_number ? '(' + escapeHtml(d.philhealth_number) + ')' : ''}</p>
                                <p class="sm:col-span-2"><strong>Address:</strong> ${escapeHtml(d.address || '—')}</p>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 pb-4 mb-4 border-b border-slate-200">
                                <p><strong>Diagnosis:</strong> ${escapeHtml(d.diagnosis || '—')}</p>
                                <p><strong>Severity:</strong> ${escapeHtml(String(d.disease_severity ?? '—'))}</p>
                                <p class="sm:col-span-2"><strong>Chief Complaint:</strong> ${escapeHtml(d.chief_complaint || '—')}</p>
                                <p class="sm:col-span-2"><strong>Referral Reason:</strong> ${escapeHtml(d.reason_text || '—')}</p>
                                <p class="sm:col-span-2"><strong>Referring Facility:</strong> ${escapeHtml(d.referring_facility || '—')}</p>
                                ${(function () {
                                    const tags = [];
                                    if (d.is_pwd) tags.push('PWD');
                                    if (d.is_pregnant) tags.push('Pregnant');
                                    if (d.is_senior_citizen) tags.push('Senior Citizen');
                                    return tags.length > 0 ? `<p class="sm:col-span-2"><strong>Patient Status:</strong> ${escapeHtml(tags.join(', '))}</p>` : '';
                                })()}
                                ${d.has_allergy ? `<p class="sm:col-span-2"><strong>Allergy:</strong> <span class="text-red-700 font-semibold">${escapeHtml(d.allergy_details || 'Yes (unspecified)')}</span></p>` : ''}
                            </div>

                            <div>
                                <p class="font-semibold text-slate-800 mb-2">Vitals at Time of Referral</p>
                                <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                                    ${vitalTile('BP', d.vital_bp)}
                                    ${vitalTile('HR', d.vital_hr)}
                                    ${vitalTile('RR', d.vital_rr)}
                                    ${vitalTile('Temp °C', d.vital_temp_c)}
                                    ${vitalTile('O2 Sat %', d.vital_o2sat)}
                                    ${vitalTile('Height (cm)', d.vital_height_cm)}
                                    ${vitalTile('Weight (kg)', d.vital_weight_kg)}
                                </div>
                            </div>
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
            url: `${API_V1_REFERRAL}/mine`,
            type: 'GET',
            headers: { 'X-API-Key': currentHospital.api_key || '' },
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
        $.ajax({
            url: `${API_V1_REFERRAL}/${encodeURIComponent(referralId)}/recommendations`,
            type: 'GET',
            headers: {
                'X-API-Key': apiKey
            },
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
                url: `${API_V1_REFERRAL}/${encodeURIComponent(targetRefId)}/finalize`,
                type: 'PATCH',
                headers: {
                    'X-API-Key': apiKey,
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify({ hospital_name: selectedHosp }),
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
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
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

        const apiKey = currentHospital.api_key || '';
        const $tableBody = $('#referralsTableBody');

        $.ajax({
            url: `${API_V1_REFERRAL}/mine`,
            type: 'GET',
            headers: { 'X-API-Key': apiKey },
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
     * filled/checked when complete, hollow/gray when still pending.
     */
    function trackerStep(label, timestamp, completed, isLast) {
        const dotClasses = completed
            ? 'bg-emerald-500 text-white'
            : 'bg-white text-slate-300 border-2 border-slate-200';
        const labelClasses = completed ? 'text-slate-900' : 'text-slate-400';
        const icon = completed ? '<i class="bi bi-check-lg text-xs"></i>' : '';

        return `
            <div class="relative ${isLast ? '' : 'pb-6'} pl-9">
                ${isLast ? '' : `<div class="absolute left-[11px] top-6 bottom-0 w-0.5 ${completed ? 'bg-emerald-400' : 'bg-slate-200'}"></div>`}
                <div class="absolute left-0 top-0 w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${dotClasses}">${icon}</div>
                <p class="text-sm font-semibold ${labelClasses}">${label}</p>
                <p class="text-xs text-slate-500 mt-0.5">${timestamp ? formatReferralTimestamp(timestamp) : 'Pending'}</p>
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

        let stepsHtml;
        if (ref.status === 'CANCELLED') {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false) +
                trackerStep('Cancelled by Referring Facility', null, true, true);
        } else {
            stepsHtml =
                trackerStep('Referral Sent', ref.created_at, true, false) +
                trackerStep('Seen by a Facility', ref.seen_at, !!ref.seen_at, false) +
                trackerStep(ref.receiving_facility ? `Accepted by ${escapeHtml(ref.receiving_facility)}` : 'Accepted', ref.accepted_at, !!ref.accepted_at, false) +
                trackerStep(ref.receiving_facility ? `Finalized to ${escapeHtml(ref.receiving_facility)}` : 'Finalized', ref.finalized_at, !!ref.finalized_at, false) +
                trackerStep('Patient Arrived', ref.arrived_at, !!ref.arrived_at, true);
        }

        const notifiedHtml = responses.length
            ? responses.map(function (r) {
                const statusBadge = REFERRAL_STATUS_BADGE_CLASS[r.response_status] || 'bg-slate-100 text-slate-700';
                return `
                    <div class="flex items-center justify-between gap-3 py-2 border-b border-slate-100 last:border-0">
                        <p class="text-xs font-medium text-slate-700">${escapeHtml(r.hospital_name)}</p>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold flex-shrink-0 ${statusBadge}">${escapeHtml(r.response_status)}</span>
                    </div>
                `;
            }).join('')
            : '<p class="text-xs text-slate-400 text-center py-3">No hospitals have been notified yet.</p>';

        Swal.fire({
            title: 'Track Referral',
            width: '32rem',
            html: `
                <div class="text-left">
                    <div class="pt-2 pb-2">${stepsHtml}</div>
                    <div class="mt-2 pt-3 border-t border-slate-200">
                        <p class="text-xs font-bold text-slate-700 mb-1.5">Notified Hospitals (${responses.length})</p>
                        ${notifiedHtml}
                    </div>
                </div>
            `,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Close',
            confirmButtonColor: '#0d6efd',
            customClass: { popup: 'rounded-4 shadow-lg' }
        });
    });

    /**
     * Cancel a referral via PATCH /api/v1/referral/{id}/cancel — only shown while cancellable
     */
    $(document).on('click', '.btn-cancel-referral', function () {
        const referralId = $(this).data('ref-id');
        const apiKey = currentHospital ? (currentHospital.api_key || '') : '';

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
                url: `${API_V1_REFERRAL}/${referralId}/cancel`,
                type: 'PATCH',
                headers: { 'X-API-Key': apiKey },
                dataType: 'json',
                success: function () {
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'Referral cancelled',
                        showConfirmButton: false,
                        timer: 2000
                    });
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

        const apiKey = currentHospital.api_key || '';
        isPollingInProgress = true;

        $.ajax({
            url: `${API_V1_REFERRAL}/incoming`,
            type: 'GET',
            headers: {
                'X-API-Key': apiKey
            },
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
     * Render the bell badge count and the dropdown list of pending referral notifications
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

        let html = '';
        incomingNotifications.forEach((alert, referralId) => {
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
            return new Date(a.created_at || 0) - new Date(b.created_at || 0); // oldest first within same severity
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
        if (!currentHospital) return;
        const apiKey = currentHospital.api_key || '';

        $.ajax({
            url: `${API_V1_REFERRAL}/${encodeURIComponent(referralId)}/seen`,
            type: 'PATCH',
            headers: { 'X-API-Key': apiKey },
            dataType: 'json'
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
        const age = incomingAlert.patient_age !== undefined ? incomingAlert.patient_age : (incomingAlert.age !== undefined ? incomingAlert.age : 'N/A');
        const ageMonths = incomingAlert.patient_age_months !== undefined ? incomingAlert.patient_age_months : null;
        // Under a year old, "0 years old" is meaningless -- show months instead
        // (e.g. a 6-month-old baby reads as "6 months old", not "0 years old")
        const ageDisplay = (typeof age === 'number' && age < 1 && ageMonths !== null)
            ? `${ageMonths} month${ageMonths === 1 ? '' : 's'} old`
            : `${age} years old`;
        const gender = incomingAlert.patient_gender || incomingAlert.gender || 'N/A';
        const patientInfo = `${ageDisplay} (${gender})`;
        const severity = incomingAlert.disease_severity !== undefined ? incomingAlert.disease_severity : (incomingAlert.severity !== undefined ? incomingAlert.severity : '3');
        const clinicalReason = incomingAlert.clinical_reason || incomingAlert.reason_text || incomingAlert.reason || 'Referral Request';
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
                        submitReferralDecision(refId, 'REDIRECTED');
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

    /**
     * Submit Accept / Redirect decision to PATCH /api/v1/referral/{referral_id}/respond
     */
    function submitReferralDecision(referralId, decision) {
        if (!currentHospital || isSubmittingDecision) return;
        isSubmittingDecision = true;

        const apiKey = currentHospital.api_key || '';

        Swal.fire({
            title: 'Submitting Decision...',
            text: `Transmitting ${decision} decision to central IOL...`,
            allowOutsideClick: false,
            didOpen: () => { Swal.showLoading(); }
        });

        const payload = JSON.stringify({ status: decision, decision: decision, action: decision });

        $.ajax({
            url: `${API_V1_REFERRAL}/${encodeURIComponent(referralId)}/respond`,
            type: 'PATCH',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
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

        $.ajax({
            url: `${API_BASE}/save_patient.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                if (response.success) {
                    $('#patientForm')[0].reset();
                    switchTab('patients');
                    loadPatients();
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'Patient registered successfully.',
                        showConfirmButton: false,
                        timer: 2500
                    });
                } else {
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
    });

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
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: 'Staff account created.',
                        showConfirmButton: false,
                        timer: 2500
                    });
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
     * Load / populate the facility's Service Assessment (streamlined DOH HFP checklist)
     */
    const ASSESSMENT_BOOL_FIELDS = [
        'has_icu', 'has_nicu', 'has_er_trauma', 'has_delivery_room', 'has_hemodialysis',
        'has_blood_bank', 'has_ct_mri', 'has_cardiologist', 'has_obgyn', 'has_neurologist', 'has_general_surgeon'
    ];

    function loadServiceAssessment() {
        const doh = window.DOHAssessment || (typeof DOHAssessment !== 'undefined' ? DOHAssessment : null);
        if (doh && typeof doh.loadForm === 'function') {
            doh.loadForm();
        } else {
            console.error('DOHAssessment module not found on window object!');
        }
    }


    $('#assessmentForm').on('submit', function (e) {
        e.preventDefault();

        const $submitBtn = $('#btnSubmitAssessment');
        const originalBtnHtml = $submitBtn.html();
        $submitBtn.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Saving...').prop('disabled', true);

        const formData = {
            authorized_bed_capacity: $('#inputAuthorizedBeds').val(),
            functional_beds: $('#inputFunctionalBeds').val()
        };
        ASSESSMENT_BOOL_FIELDS.forEach(function (field) {
            formData[field] = $(`#assessmentForm [name="${field}"]`).is(':checked') ? 1 : 0;
        });

        $.ajax({
            url: `${API_BASE}/service_assessment.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);

                if (response.success) {
                    if (currentHospital) currentHospital.is_assessment_completed = true;
                    $('#assessmentLockBanner').addClass('hidden');
                    applyRoleBasedNav();

                    Swal.fire({
                        icon: 'success',
                        title: 'Assessment Submitted',
                        text: 'Your facility is now unlocked for staff to use the system.',
                        confirmButtonColor: '#dc3545'
                    }).then(function () {
                        switchTab('patients');
                        loadPatients();
                    });
                } else {
                    Swal.fire({
                        icon: 'error',
                        title: 'Could Not Save Assessment',
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
                    text: `Failed to save assessment (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    });

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
    // Metro Manila city/sub-municipality). PSGC codes are hierarchical — a real city under
    // a given province always shares that province's code prefix — so filter out anything
    // that doesn't, rather than trusting the third-party API's response as-is.
    function filterCitiesToExpectedArea(cities, provinceCode, regionCode) {
        const prefix = (provinceCode && provinceCode !== 'N/A')
            ? provinceCode.substring(0, 4)
            : (regionCode ? regionCode.substring(0, 2) : null);
        if (!prefix) return cities;
        const filtered = cities.filter(c => c.code && c.code.startsWith(prefix));
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
                        const cleanData = filterCitiesToExpectedArea(data, provinceCode, regionCode);
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

    // Start incoming referral polling every 12 seconds
    setInterval(pollIncomingReferrals, 12000);

    // Start active referral recommendations polling every 4 seconds
    setInterval(checkAndPollRecommendations, 4000);

    // Initialize session check
    checkSession();
});
