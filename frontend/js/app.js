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
    const API_V1_ME = isIdeServer ? 'http://localhost/mock_hospitals/api/v1/hospitals/me/inventory' : '../api/v1/hospitals/me/inventory';
    const API_V1_REFERRAL = isIdeServer ? 'http://localhost/mock_hospitals/api/v1/referral' : '../api/v1/referral';

    // Active Hospital State
    let currentHospital = null;

    /**
     * Check active hospital session on page load
     */
    function checkSession() {
        $.ajax({
            url: `${API_BASE}/login.php`,
            type: 'GET',
            dataType: 'json',
            success: function (response) {
                if (response.authenticated && response.hospital) {
                    currentHospital = response.hospital;
                    showDashboardView(response.hospital);
                } else {
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
     * Show Dashboard View (Authenticated State)
     */
    function showDashboardView(hospital) {
        $('#loginView').hide();
        $('#dashboardView').fadeIn(200);

        $('#sidebarHospitalName, #headerHospitalName').text(hospital.name);
        $('#sidebarHospitalCode').text(hospital.code);

        // Default to Patients tab
        switchTab('patients');
        loadPatients();
        checkAndPollRecommendations();
    }

    /**
     * Show Login View (Unauthenticated State)
     */
    function showLoginView() {
        $('#dashboardView').hide();
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

        const $allTabs = $('#tabPatientsContent, #tabInventoryContent, #tabProfileContent, #tabReferralsContent, #tabOutcomesContent');

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
        } else if (tabName === 'inventory') {
            $('#navTabInventory')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconInventory')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Hospital Inventory');
            $allTabs.hide();
            $('#tabInventoryContent').fadeIn(200);
            loadInventory();
        } else if (tabName === 'profile') {
            $('#navTabProfile')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconProfile')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Facility Profile');
            $allTabs.hide();
            $('#tabProfileContent').fadeIn(200);
            loadInventory();
            initInventoryLocationDropdowns();
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
        } else if (tabName === 'outcomes') {
            $('#navTabOutcomes')
                .removeClass('text-slate-500 hover:bg-slate-200/80 active:bg-slate-300/70')
                .addClass('bg-red-600/20 text-red-600 font-semibold shadow shadow-red-600/10 hover:bg-red-600/40 active:bg-red-600/60');
            $('#navIconOutcomes')
                .removeClass('text-slate-500')
                .addClass('text-red-600');
            $('#mainHeaderTitle').text('Referral Outcomes');
            $allTabs.hide();
            $('#tabOutcomesContent').fadeIn(200);
            loadReferralOutcomes();
        }
    }

    $('#navTabPatients').on('click', function (e) {
        e.preventDefault();
        switchTab('patients');
    });

    $('#navTabInventory').on('click', function (e) {
        e.preventDefault();
        switchTab('inventory');
    });

    $('#navTabProfile').on('click', function (e) {
        e.preventDefault();
        switchTab('profile');
    });

    $('#navTabReferrals').on('click', function (e) {
        e.preventDefault();
        switchTab('referrals');
    });

    $('#navTabOutcomes').on('click', function (e) {
        e.preventDefault();
        switchTab('outcomes');
    });

    /**
     * Skeleton Loading Toggle for Inventory & Hospital Profile Tab
     */
    const INVENTORY_SKELETON_IDS = [
        'statAvailableBeds', 'statMedicalSpecs', 'statHospitalLevel', 'statHospitalEnv',
        'displayHospitalId', 'displayHospitalName', 'displayHospitalLevel', 'displayHospitalEnv', 'displayGpsCoords',
        'badgeEmergencyEquip', 'badgeMedicalEquip', 'badgeCommSystems'
    ];

    function showInventorySkeleton() {
        INVENTORY_SKELETON_IDS.forEach(function (id) {
            $(`#${id}Skeleton`).removeClass('hidden');
            $(`#${id}`).addClass('hidden');
        });
    }

    function hideInventorySkeleton() {
        INVENTORY_SKELETON_IDS.forEach(function (id) {
            $(`#${id}Skeleton`).addClass('hidden');
            $(`#${id}`).removeClass('hidden');
        });
    }

    /**
     * Enables/disables both the Inventory and Profile submit buttons together,
     * since a single GET (loadInventory) backs both split-out tabs.
     */
    function setHospitalFormsDisabled(disabled) {
        if (disabled) {
            $('#btnSubmitInventory, #btnSubmitProfile')
                .prop('disabled', true)
                .html('<i class="bi bi-wifi-off me-2"></i> Server Offline (Updates Disabled)');
        } else {
            $('#btnSubmitInventory').prop('disabled', false).html('<i class="bi bi-cloud-arrow-up me-2"></i> Update Inventory');
            $('#btnSubmitProfile').prop('disabled', false).html('<i class="bi bi-cloud-arrow-up me-2"></i> Update Facility Profile');
        }
    }

    /**
     * Load Hospital Inventory via GET /api/v1/hospitals/me/inventory
     */
    function loadInventory() {
        if (!currentHospital) return;

        showInventorySkeleton();

        const apiKey = currentHospital.api_key || '';
        const cacheKey = `cached_hospital_profile_${currentHospital.id}`;

        $.ajax({
            url: API_V1_ME,
            type: 'GET',
            headers: {
                'X-API-Key': apiKey
            },
            dataType: 'json',
            success: function (data) {
                // Online mode: hide offline/connection alert banners & enable submit buttons
                $('#serverOfflineAlert').slideUp(200);
                $('#serverConnectionAlert').slideUp(200);
                setHospitalFormsDisabled(false);

                populateHospitalProfile(data);
                hideInventorySkeleton();
            },
            error: function (xhr) {
                const cachedRaw = localStorage.getItem(cacheKey);

                if (cachedRaw) {
                    // Load and display cached data fetched before server went offline
                    try {
                        const cachedData = JSON.parse(cachedRaw);
                        populateHospitalProfile(cachedData, true);
                        hideInventorySkeleton();

                        // Show offline alert banner & disable submit buttons
                        $('#serverConnectionAlert').slideUp(200);
                        $('#serverOfflineAlert').slideDown(200);
                        setHospitalFormsDisabled(true);

                        Swal.fire({
                            toast: true,
                            position: 'top-end',
                            icon: 'warning',
                            title: 'Central Backend Offline — Showing Cached Profile',
                            showConfirmButton: false,
                            timer: 3500
                        });
                        return;
                    } catch (e) {}
                }

                // If no cached data exists, keep the skeleton pulsing — there's nothing real to show yet
                const errData = xhr.responseJSON || {};
                const isConnectionErr = xhr.status === 503 || xhr.status === 0 || (errData.detail && errData.detail.includes("reach the server"));

                if (isConnectionErr) {
                    // Inline banner instead of a blocking alert — server being unreachable is common/expected
                    $('#serverOfflineAlert').slideUp(200);
                    $('#serverConnectionAlert').slideDown(200);
                    setHospitalFormsDisabled(true);
                    return;
                }

                $('#serverConnectionAlert').slideUp(200);
                Swal.fire({
                    icon: 'error',
                    title: 'API Authorization Notice',
                    text: errData.detail || 'Could not retrieve hospital profile from backend.',
                    confirmButtonColor: '#0d6efd'
                });
            }
        });
    }

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

                if (response.success && response.hospital) {
                    currentHospital = response.hospital;
                    showDashboardView(response.hospital);
                    
                    Swal.fire({
                        toast: true,
                        position: 'top-end',
                        icon: 'success',
                        title: `Welcome back, ${response.hospital.name}!`,
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
    $(document).on('click', '#btnLogoutBtn', function () {
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
                        window.activeInitiatedReferralId = null;

                        // Clear referral notification state so the next login starts fresh
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
     * Populate Hospital Detail Schema into UI components and save to localStorage cache
     */
    function populateHospitalProfile(data, isCached = false) {
        if (!data) return;

        // Top widgets
        $('#statAvailableBeds').text(data.available_beds ?? 0);
        $('#statMedicalSpecs').text(data.medical_specialists_count ?? 0);
        $('#statHospitalLevel').text(data.hospital_level || 'Level 2');
        $('#statHospitalEnv').text(data.hospital_environment || 'Urban');

        // Detailed table
        $('#displayHospitalId').text(`#${data.id ?? (currentHospital ? currentHospital.id : 1)}`);
        $('#displayHospitalName').text(data.hospital_name || (currentHospital ? currentHospital.name : 'Hospital'));
        $('#displayHospitalLevel').text(data.hospital_level || 'Level 2');
        $('#displayHospitalEnv').text(data.hospital_environment || 'Urban');
        $('#displayGpsCoords').text(`${data.latitude ?? 0}, ${data.longitude ?? 0}`);

        // Badges
        const BADGE_BASE_CLASS = 'inline-flex items-center flex-shrink-0 whitespace-nowrap px-3 py-1 rounded-full text-xs font-semibold';

        $('#badgeEmergencyEquip').html(data.emergency_equipment ? '<i class="bi bi-check-circle me-1"></i> Available' : '<i class="bi bi-x-circle me-1"></i> Unavailable')
            .attr('class', `${BADGE_BASE_CLASS} ${data.emergency_equipment ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`);

        $('#badgeMedicalEquip').html(data.medical_equipment ? '<i class="bi bi-check-circle me-1"></i> Available' : '<i class="bi bi-x-circle me-1"></i> Unavailable')
            .attr('class', `${BADGE_BASE_CLASS} ${data.medical_equipment ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`);

        $('#badgeCommSystems').html(data.communication_systems ? '<i class="bi bi-check-circle me-1"></i> Active' : '<i class="bi bi-x-circle me-1"></i> Inactive')
            .attr('class', `${BADGE_BASE_CLASS} ${data.communication_systems ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}`);

        // Form inputs
        $('#inputBeds').val(data.available_beds ?? 0);
        $('#inputSpecs').val(data.medical_specialists_count ?? 0);
        $('#inputLevel').val(data.hospital_level || 'Level 2');
        $('#inputEnv').val(data.hospital_environment || 'Urban');
        $('#inputLat').val(data.latitude ?? 0);
        $('#inputLng').val(data.longitude ?? 0);

        $('#inputEmergencyEquip').prop('checked', !!data.emergency_equipment);
        $('#inputMedicalEquip').prop('checked', !!data.medical_equipment);
        $('#inputCommSystems').prop('checked', !!data.communication_systems);

        // Cache data locally for offline display if it came live from API
        if (!isCached && currentHospital) {
            try {
                localStorage.setItem(`cached_hospital_profile_${currentHospital.id}`, JSON.stringify(data));
            } catch (e) {}
        }
    }



    /**
     * Shared PATCH submitter for /api/v1/hospitals/me/inventory (partial payloads),
     * with a fallback to inventory_api.php, used by both the Inventory and Profile forms.
     */
    function submitHospitalPatch(fields, $btn, successTitle) {
        if (!currentHospital) return;

        const apiKey = currentHospital.api_key || '';
        const originalText = $btn.html();
        const payload = JSON.stringify(fields);

        $btn.html('<span class="spinner-border spinner-border-sm me-2"></span> Updating...').prop('disabled', true);

        function handlePatchSuccess() {
            $btn.html(originalText).prop('disabled', false);

            // Instantly trigger auto-refresh call to fetch fresh data from backend
            loadInventory();

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: successTitle,
                showConfirmButton: false,
                timer: 2000
            });
        }

        $.ajax({
            url: API_V1_ME,
            type: 'PATCH',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            data: payload,
            dataType: 'json',
            success: function () {
                handlePatchSuccess();
            },
            error: function () {
                $.ajax({
                    url: `${API_BASE}/inventory_api.php`,
                    type: 'POST',
                    headers: {
                        'X-API-Key': apiKey,
                        'Content-Type': 'application/json'
                    },
                    data: payload,
                    dataType: 'json',
                    success: function () {
                        handlePatchSuccess();
                    },
                    error: function (errXhr) {
                        $btn.html(originalText).prop('disabled', false);
                        const errObj = errXhr.responseJSON || {};
                        const isConnectionErr = errXhr.status === 503 || errXhr.status === 0 || (errObj.detail && errObj.detail.includes("reach the server"));

                        Swal.fire({
                            icon: 'error',
                            title: isConnectionErr ? "Can't Reach Server" : "Update Failed",
                            text: isConnectionErr
                                ? "Can't reach the server, contact devs @ irdss.devs@up.edu.ph"
                                : (errObj.detail || "Could not update hospital records."),
                            confirmButtonColor: '#0d6efd'
                        });
                    }
                });
            }
        });
    }

    /**
     * Submit Inventory Update (beds, specialists, equipment) via PATCH /api/v1/hospitals/me/inventory
     */
    $('#updateInventoryForm').on('submit', function (e) {
        e.preventDefault();
        submitHospitalPatch({
            available_beds: parseInt($('#inputBeds').val(), 10),
            medical_specialists_count: parseInt($('#inputSpecs').val(), 10),
            emergency_equipment: $('#inputEmergencyEquip').is(':checked'),
            medical_equipment: $('#inputMedicalEquip').is(':checked'),
            communication_systems: $('#inputCommSystems').is(':checked')
        }, $('#btnSubmitInventory'), 'Hospital Inventory Updated!');
    });

    /**
     * Submit Facility Profile Update (level, environment, location) via PATCH /api/v1/hospitals/me/inventory
     */
    $('#updateProfileForm').on('submit', function (e) {
        e.preventDefault();
        submitHospitalPatch({
            hospital_level: $('#inputLevel').val(),
            hospital_environment: $('#inputEnv').val(),
            latitude: parseFloat($('#inputLat').val()),
            longitude: parseFloat($('#inputLng').val())
        }, $('#btnSubmitProfile'), 'Facility Profile Updated!');
    });

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
                    $('#modalPatientIdBadge').text(`#${patient.id}`);
                    $('#modalPatientName').text(`${patient.first_name} ${patient.last_name}`);
                    $('#modalPatientDob').text(patient.dob);
                    $('#modalPatientGender').text(patient.gender);
                    $('#modalPatientPhone').text(patient.phone || 'N/A');

                    $('#referralModal').fadeIn(200, function() {
                        initLocationDropdowns();
                    });
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
            salary: parseFloat($('#modalSalary').val()) || 12000,
            severity: parseFloat($('#modalSeverity').val()) || 3,
            reason_text: $('#modalReasonText').val() || 'Severe Pneumonia',
            reason_code: '233604007',
            reason_display: 'Pneumonia'
        };

        $.ajax({
            url: `${API_BASE}/send_referral.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success: function (response) {
                $submitBtn.html(originalBtnHtml).prop('disabled', false);
                $('#referralModal').fadeOut(200);

                if (response.success) {
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
                $('#referralModal').fadeOut(200);

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

        if (!referralId) {
            $('#acceptedHospitalsCard').hide();
            return;
        }

        $('#acceptedHospitalsCard').fadeIn(200);
        $('#activeReferralIdText').text(referralId);
        $('#activeReferralPatientText').text(patientName);

        const apiKey = currentHospital.api_key || '';
        fetchRecommendationsForReferral(referralId, apiKey);
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

    function resolveLocationAddressHtml(lat, lng, elementId) {
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
            return 'Location N/A';
        }

        const cacheKey = `${lat.toFixed(4)}_${lng.toFixed(4)}`;
        if (locationGeoCache[cacheKey]) {
            return escapeHtml(locationGeoCache[cacheKey]);
        }

        const fallbackAddr = getClientLocationFallback(lat, lng);

        // Trigger asynchronous reverse geocode via PHP proxy backend
        setTimeout(() => {
            $.ajax({
                url: `${API_BASE}/reverse_geo.php`,
                data: { lat: lat, lng: lng },
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
                .text('Awaiting Acceptances...');

            $list.html(`
                <div class="col-span-full text-center py-8 px-4 text-slate-400 font-normal bg-slate-50/80 rounded-2xl border border-slate-200/60">
                    <i class="bi bi-clock text-2xl block mb-2 text-slate-400"></i>
                    <span class="text-xs font-medium">No hospital has accepted this referral yet. We will update automatically when a facility responds.</span>
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
                <div class="relative p-5 bg-slate-50/90 rounded-2xl border ${isBestMatch ? 'border-red-400 ring-2 ring-red-100' : 'border-slate-200'} shadow-xs space-y-4 hover:border-red-300 hover:shadow-md transition-all flex flex-col justify-between">
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

                    <button class="w-full py-2.5 px-4 bg-yellow-600 hover:bg-red-700 active:scale-[0.99] text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 btn-select-hospital"
                        data-hosp-name="${escapeHtml(hospName)}" data-ref-id="${escapeHtml(referralId)}">
                        <i class="bi bi-check2-circle text-base"></i>
                        <span>SELECT THIS HOSPITAL</span>
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
                        .text(`Finalized: ${selectedHosp}`);

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
                ? `<button class="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded-lg border border-red-200 transition-all btn-cancel-referral" data-ref-id="${escapeHtml(ref.referral_id)}">
                       <i class="bi bi-x-circle me-1"></i> Cancel
                   </button>`
                : '';

            const row = `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500">${escapeHtml(ref.referral_id)}</td>
                    <td class="py-3.5 px-6 text-slate-700 text-xs font-mono">${escapeHtml(ref.patient_id)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${escapeHtml(ref.disease_severity)}</td>
                    <td class="py-3.5 px-6"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}">${escapeHtml(ref.status)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${formatReferralTimestamp(ref.created_at)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${formatReferralTimestamp(ref.seen_at)}</td>
                    <td class="py-3.5 px-6 text-xs">
                        <button type="button" class="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium btn-view-referral-timeline" data-ref-id="${escapeHtml(ref.referral_id)}">
                            <i class="bi bi-clock-history me-1"></i> ${responses.length} notified
                        </button>
                    </td>
                    <td class="py-3.5 px-6 text-right">${cancelBtn}</td>
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
     * Show a small SweetAlert2 popup listing which hospitals saw/responded and when
     */
    $(document).on('click', '.btn-view-referral-timeline', function () {
        const referralId = $(this).data('ref-id');
        const referrals = $('#referralsTableBody').data('referrals') || [];
        const ref = referrals.find(function (r) { return r.referral_id === referralId; });
        const responses = (ref && Array.isArray(ref.responses)) ? ref.responses : [];

        const rowsHtml = responses.length
            ? responses.map(function (r) {
                const statusBadge = REFERRAL_STATUS_BADGE_CLASS[r.response_status] || 'bg-slate-100 text-slate-700';
                return `
                    <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0 text-left">
                        <div class="min-w-0 flex-1">
                            <p class="text-sm font-semibold text-slate-800">${escapeHtml(r.hospital_name)}</p>
                            <p class="text-xs text-slate-500">Seen: ${formatReferralTimestamp(r.seen_at)}${r.responded_at ? ` · Responded: ${formatReferralTimestamp(r.responded_at)}` : ''}</p>
                        </div>
                        <span class="px-2.5 py-1 rounded-full text-xs font-bold flex-shrink-0 whitespace-nowrap ${statusBadge}">${escapeHtml(r.response_status)}</span>
                    </div>
                `;
            }).join('')
            : '<p class="text-sm text-slate-400 text-center py-4">No hospitals have been notified yet.</p>';

        Swal.fire({
            title: 'Referral Timeline',
            html: `<div class="text-left">${rowsHtml}</div>`,
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

    // ============================================================
    // REFERRAL OUTCOMES PAGE (who chose us vs who bypassed us)
    // ============================================================
    let referralOutcomesCache = [];

    const OUTCOME_BADGE_CLASS = {
        CHOSEN: 'bg-emerald-100 text-emerald-800',
        BYPASSED: 'bg-amber-100 text-amber-800'
    };
    const OUTCOME_LABEL = {
        CHOSEN: 'Confirmed Transfer',
        BYPASSED: 'Bypassed Transfer'
    };

    /**
     * Load this hospital's accept outcomes via GET /api/v1/referral/outcomes
     */
    function loadReferralOutcomes() {
        if (!currentHospital) return;

        const apiKey = currentHospital.api_key || '';
        const $tableBody = $('#outcomesTableBody');

        $.ajax({
            url: `${API_V1_REFERRAL}/outcomes`,
            type: 'GET',
            headers: { 'X-API-Key': apiKey },
            dataType: 'json',
            success: function (data) {
                $('#outcomesConnectionAlert').slideUp(200);
                referralOutcomesCache = Array.isArray(data) ? data : [];

                const chosenCount = referralOutcomesCache.filter(o => o.outcome === 'CHOSEN').length;
                const bypassedCount = referralOutcomesCache.filter(o => o.outcome === 'BYPASSED').length;
                $('#statChoseUsCount').text(chosenCount);
                $('#statBypassedUsCount').text(bypassedCount);

                applyOutcomeFilters();
            },
            error: function (xhr) {
                const errData = xhr.responseJSON || {};
                const httpStatus = xhr.status || 500;
                const isConnectionErr = httpStatus === 503 || httpStatus === 0 || (errData.detail && errData.detail.includes("reach the server"));

                if (isConnectionErr) {
                    $('#outcomesConnectionAlert').slideDown(200);
                    $tableBody.html(`
                        <tr>
                            <td colspan="7" class="text-center py-8 text-slate-400 font-normal text-xs">
                                Can't reach the server — showing nothing to display.
                            </td>
                        </tr>
                    `);
                    return;
                }

                $('#outcomesConnectionAlert').slideUp(200);
                $tableBody.html(`
                    <tr>
                        <td colspan="7" class="text-center py-8 text-red-500 font-normal text-xs">
                            ${escapeHtml(cleanErrorMessage(errData.detail || 'Could not load referral outcomes.', httpStatus))}
                        </td>
                    </tr>
                `);
            }
        });
    }

    /**
     * Filter the cached outcomes list by type/search, then re-render
     */
    function applyOutcomeFilters() {
        const typeFilter = $('#outcomeFilterType').val();
        const search = ($('#outcomeFilterSearch').val() || '').trim().toLowerCase();

        const filtered = referralOutcomesCache.filter(function (o) {
            if (typeFilter && o.outcome !== typeFilter) return false;

            if (search) {
                const haystack = `${o.referral_id} ${o.patient_id} ${o.referring_facility}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }

            return true;
        });

        renderOutcomesTable(filtered);
    }

    /**
     * Render the "Referral Outcomes" DataTable from a (pre-filtered) list
     */
    function renderOutcomesTable(outcomes) {
        if ($.fn.DataTable.isDataTable('#outcomesTable')) {
            $('#outcomesTable').DataTable().destroy();
        }

        const $tableBody = $('#outcomesTableBody');
        $tableBody.empty();

        if (outcomes.length === 0) {
            $tableBody.html(`
                <tr>
                    <td colspan="7" class="text-center py-8 text-slate-400 font-normal">
                        No referral outcomes match the current filters.
                    </td>
                </tr>
            `);
            return;
        }

        outcomes.forEach(function (o) {
            const badgeClass = OUTCOME_BADGE_CLASS[o.outcome] || 'bg-slate-100 text-slate-700';
            const label = OUTCOME_LABEL[o.outcome] || o.outcome;
            const patientInfo = `${escapeHtml(String(o.patient_id))}${o.patient_age !== undefined && o.patient_age !== null ? ` · ${escapeHtml(String(o.patient_age))}y` : ''}${o.patient_gender ? ` · ${escapeHtml(o.patient_gender)}` : ''}`;
            const wentTo = o.outcome === 'BYPASSED'
                ? escapeHtml(o.receiving_facility || 'Another facility')
                : '<span class="text-slate-400">—</span>';

            const row = `
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500">${escapeHtml(o.referral_id)}</td>
                    <td class="py-3.5 px-6 text-slate-700 text-xs">${patientInfo}</td>
                    <td class="py-3.5 px-6 text-slate-700 text-xs font-semibold">${escapeHtml(o.referring_facility)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${escapeHtml(String(o.disease_severity))}</td>
                    <td class="py-3.5 px-6"><span class="px-2.5 py-1 rounded-full text-xs font-bold ${badgeClass}">${escapeHtml(label)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${formatReferralTimestamp(o.seen_at || o.responded_at)}</td>
                    <td class="py-3.5 px-6 text-xs">${wentTo}</td>
                </tr>
            `;
            $tableBody.append(row);
        });

        $('#outcomesTable').DataTable({
            paging: true,
            searching: false,
            ordering: true,
            info: true,
            responsive: true,
            pageLength: 10,
            lengthMenu: [5, 10, 25, 50],
            language: {
                lengthMenu: "Show _MENU_ records",
                info: "Showing _START_ to _END_ of _TOTAL_ outcomes",
                paginate: {
                    next: '<i class="bi bi-chevron-right"></i>',
                    previous: '<i class="bi bi-chevron-left"></i>'
                }
            }
        });
    }

    $('#btnRefreshOutcomes').on('click', function () {
        if (currentHospital) loadReferralOutcomes();
    });

    $('#outcomeFilterType').on('change', applyOutcomeFilters);
    $('#outcomeFilterSearch').on('input', applyOutcomeFilters);

    // Track which referral IDs have already surfaced as a notification, and pending polling state
    const notifiedReferralIds = new Set();
    const incomingNotifications = new Map(); // referral_id -> alert payload, backs the bell dropdown
    let isPollingInProgress = false;

    /**
     * Poll Incoming Referrals for active hospital session
     */
    function pollIncomingReferrals() {
        if (!currentHospital || isPollingInProgress) return;

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

                items.forEach(item => {
                    const id = item.referral_id || item.id;
                    const respStatus = (item.response_status || item.status || '').toUpperCase();
                    if (!id || notifiedReferralIds.has(id) || respStatus === 'ACCEPTED' || respStatus === 'REDIRECTED') return;

                    notifiedReferralIds.add(id);
                    incomingNotifications.set(id, item);
                    hasNewNotification = true;
                });

                if (hasNewNotification) {
                    renderNotificationBell();
                    showNewReferralToast();
                    playNotificationSound();
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

    // Toggle the notification dropdown open/closed
    $(document).on('click', '#btnNotificationBell', function (e) {
        console.log('clicked');
        e.stopPropagation();
        $('#notificationDropdown').toggleClass('hidden');
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

        incomingNotifications.delete(referralId);
        renderNotificationBell();
        $('#notificationDropdown').addClass('hidden');

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
        const gender = incomingAlert.patient_gender || incomingAlert.gender || 'N/A';
        const patientInfo = `${age} years old (${gender})`;
        const severity = incomingAlert.disease_severity !== undefined ? incomingAlert.disease_severity : (incomingAlert.severity !== undefined ? incomingAlert.severity : '3');
        const clinicalReason = incomingAlert.clinical_reason || incomingAlert.reason_text || incomingAlert.reason || 'Referral Request';

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
        $('#modal-patient-age').text(patientInfo);
        $('#modal-severity').text("Triage Category: " + severity);
        $('#modal-reason').text(clinicalReason);

        Swal.fire({
            title: '<div class="flex items-center justify-center gap-2 text-red-600"><i class="bi bi-hospital text-2xl"></i> <span>Incoming Patient Referral</span></div>',
            html: `
                <div class="text-start space-y-3 p-2 text-sm text-slate-700">
                    <p class="text-xs text-slate-500 uppercase font-semibold tracking-wider mb-2">Hospital Referral Notification</p>
                    
                    <div class="p-3 bg-red-50 rounded-xl border border-red-100 space-y-1">
                        <div class="flex justify-between items-center">
                            <span class="text-xs font-bold text-red-900 font-mono">Referral ID: ${escapeHtml(referralId)}</span>
                            <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">Pending Decision</span>
                        </div>
                    </div>

                    <div class="space-y-2 bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 text-xs">
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Referring Facility:</span>
                            <span class="font-bold text-slate-800 text-right" id="modal-referring-hospital">${escapeHtml(referringFacility)}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Referring Facility Location:</span>
                            <span class="font-normal text-slate-800 text-right leading-relaxed">${hospLocationHtml}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Patient ID:</span>
                            <span class="font-bold text-slate-800 font-mono text-right" id="modal-patient-id">${escapeHtml(String(patientId))}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Age:</span>
                            <span class="font-normal text-slate-800 text-right" id="modal-patient-age">${escapeHtml(String(age))}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Gender:</span>
                            <span class="font-normal text-slate-800 text-right" id="modal-patient-gender">${escapeHtml(String(gender))}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Patient Location:</span>
                            <span class="font-normal text-slate-800 text-right leading-relaxed">${patientLocationHtml}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Transfer Distance & ETA:</span>
                            <span class="font-bold text-red-700 text-right" id="modal-transfer-eta">${escapeHtml(etaText)}</span>
                        </div>
                        <div class="flex justify-between border-b border-slate-200/60 pb-1.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Severity:</span>
                            <span class="font-bold text-amber-700 text-right" id="modal-severity">Triage Category: ${escapeHtml(String(severity))}</span>
                        </div>
                        <div class="flex justify-between pt-0.5 gap-2">
                            <span class="text-slate-700 font-bold shrink-0">Clinical Reason:</span>
                            <span class="font-bold text-slate-800 text-right" id="modal-reason">${escapeHtml(clinicalReason)}</span>
                        </div>
                    </div>

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
    }    // Global function to close referral modal
    window.closeReferralModal = function() {
        $('#referralModal').fadeOut(200);
    };

    /**
     * PSGC API (https://psgc.cloud/api) Cascading Location Selector
     */
    let psgcCache = {
        regions: null,
        provinces: {},
        cities: {},
        barangays: {}
    };

    let geocodeDebounceTimer = null;
    let isLocationEventsBound = false;

    function setupLocationCascade() {
        if (isLocationEventsBound) return;
        isLocationEventsBound = true;

        $('#selectRegion').on('change', function() {
            loadProvincesForSelectedRegion();
        });

        $('#selectProvince').on('change', function() {
            loadCitiesForSelectedProvince();
        });

        $('#selectCity').on('change', function() {
            loadBarangaysForSelectedCity();
        });

        $('#selectBarangay').on('change', function() {
            triggerGeocodeResolution();
        });
    }

    function initLocationDropdowns() {
        setupLocationCascade();
        loadRegions();
    }

    function loadRegions() {
        const $regionSelect = $('#selectRegion');
        $regionSelect.empty().append('<option value="">Loading regions...</option>');

        if (psgcCache.regions && psgcCache.regions.length > 0) {
            populateRegionDropdown(psgcCache.regions);
            return;
        }

        $.ajax({
            url: 'https://psgc.cloud/api/regions',
            type: 'GET',
            dataType: 'json',
            xhrFields: {
                withCredentials: false
            },
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

    function populateRegionDropdown(regions) {
        const $regionSelect = $('#selectRegion');
        $regionSelect.empty();

        regions.forEach(region => {
            const option = $('<option>')
                .attr('value', region.name)
                .attr('data-code', region.code)
                .text(region.name);

            // Default to Region XI (Davao Region) or Mindanao if present
            if (region.code === '1100000000' || region.name.includes('Davao')) {
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
        const $regionSelect = $('#selectRegion');
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
        const $regionSelect = $('#selectRegion');
        const regionCode = $regionSelect.find('option:selected').attr('data-code');
        const $provinceSelect = $('#selectProvince');
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
            xhrFields: {
                withCredentials: false
            },
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
        const $provinceSelect = $('#selectProvince');
        $provinceSelect.empty();

        if (provinces.length === 0) {
            const regionName = $('#selectRegion').val();
            $provinceSelect.append(`<option value="${regionName}" data-code="N/A">${regionName}</option>`);
        } else {
            provinces.forEach(prov => {
                const option = $('<option>')
                    .attr('value', prov.name)
                    .attr('data-code', prov.code)
                    .text(prov.name);
                
                if (prov.name.includes('Davao del Sur')) {
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
        const $provinceSelect = $('#selectProvince');
        $provinceSelect.empty().append(`
            <option value="Davao del Sur" data-code="1102400000" selected>Davao del Sur</option>
            <option value="Davao del Norte" data-code="1102300000">Davao del Norte</option>
            <option value="Misamis Oriental" data-code="1004300000">Misamis Oriental</option>
            <option value="South Cotabato" data-code="1206300000">South Cotabato</option>
        `);
        loadCitiesForSelectedProvince();
    }

    function loadCitiesForSelectedProvince() {
        const $provinceSelect = $('#selectProvince');
        const provinceCode = $provinceSelect.find('option:selected').attr('data-code');
        const regionCode = $('#selectRegion option:selected').attr('data-code');
        const $citySelect = $('#selectCity');
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
            xhrFields: {
                withCredentials: false
            },
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
        const $citySelect = $('#selectCity');
        $citySelect.empty();

        cities.forEach(city => {
            const option = $('<option>')
                .attr('value', city.name)
                .attr('data-code', city.code)
                .text(city.name);

            if (city.name.includes('Davao')) {
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
        const $citySelect = $('#selectCity');
        $citySelect.empty().append(`
            <option value="City of Davao" data-code="1130700000" selected>City of Davao</option>
            <option value="City of Digos" data-code="1102403000">City of Digos</option>
            <option value="Santa Cruz" data-code="1102412000">Santa Cruz</option>
        `);
        loadBarangaysForSelectedCity();
    }

    function loadBarangaysForSelectedCity() {
        const $citySelect = $('#selectCity');
        const cityCode = $citySelect.find('option:selected').attr('data-code');
        const $barangaySelect = $('#selectBarangay');
        $barangaySelect.empty().append('<option value="">Loading barangays...</option>');

        if (!cityCode) {
            triggerGeocodeResolution();
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
            xhrFields: {
                withCredentials: false
            },
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
        const $barangaySelect = $('#selectBarangay');
        $barangaySelect.empty();

        if (barangays.length === 0) {
            $barangaySelect.append('<option value="Poblacion" data-code="N/A">Poblacion</option>');
        } else {
            barangays.forEach(brgy => {
                const option = $('<option>')
                    .attr('value', brgy.name)
                    .attr('data-code', brgy.code)
                    .text(brgy.name);
                
                if (brgy.name.toLowerCase().includes('buhangin') || brgy.name.toLowerCase().includes('poblacion')) {
                    option.prop('selected', true);
                }
                $barangaySelect.append(option);
            });

            if (!$barangaySelect.val() && barangays.length > 0) {
                $barangaySelect.val(barangays[0].name);
            }
        }

        triggerGeocodeResolution();
    }

    function fallbackBarangays() {
        const $barangaySelect = $('#selectBarangay');
        $barangaySelect.empty().append(`
            <option value="Buhangin" data-code="1130700100" selected>Buhangin</option>
            <option value="Poblacion" data-code="1130700200">Poblacion</option>
            <option value="Agdao" data-code="1130700300">Agdao</option>
        `);
        triggerGeocodeResolution();
    }

    function triggerGeocodeResolution() {
        const region = $('#selectRegion').val();
        const province = $('#selectProvince').val();
        const city = $('#selectCity').val();
        const barangay = $('#selectBarangay').val();

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
                data: {
                    format: 'json',
                    q: query,
                    limit: 1
                },
                dataType: 'json',
                xhrFields: {
                    withCredentials: false
                },
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
    }

    function applyCoordinates(lat, lng) {
        const latFormatted = parseFloat(lat).toFixed(6);
        const lngFormatted = parseFloat(lng).toFixed(6);

        $('#modalLatitude').val(latFormatted);
        $('#modalLongitude').val(lngFormatted);
        $('#displayLatLongText').text(`${latFormatted}, ${lngFormatted}`);
    }

    /**
     * Hospital Profile Inventory Location Selector
     */
    let invGeocodeDebounceTimer = null;
    let isInvLocationEventsBound = false;

    function setupInventoryLocationCascade() {
        if (isInvLocationEventsBound) return;
        isInvLocationEventsBound = true;

        $('#invSelectRegion').on('change', function() {
            loadInventoryProvinces();
        });

        $('#invSelectProvince').on('change', function() {
            loadInventoryCities();
        });

        $('#invSelectCity').on('change', function() {
            loadInventoryBarangays();
        });

        $('#invSelectBarangay').on('change', function() {
            triggerInventoryGeocodeResolution();
        });
    }

    function initInventoryLocationDropdowns() {
        setupInventoryLocationCascade();
        loadInventoryRegions();
    }

    function loadInventoryRegions() {
        const $regionSelect = $('#invSelectRegion');
        $regionSelect.empty().append('<option value="">Loading regions...</option>');

        if (psgcCache.regions && psgcCache.regions.length > 0) {
            populateInventoryRegionDropdown(psgcCache.regions);
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
                    populateInventoryRegionDropdown(data);
                } else {
                    fallbackInventoryRegions();
                }
            },
            error: function() {
                fallbackInventoryRegions();
            }
        });
    }

    function populateInventoryRegionDropdown(regions) {
        const $regionSelect = $('#invSelectRegion');
        $regionSelect.empty();

        regions.forEach(region => {
            const option = $('<option>')
                .attr('value', region.name)
                .attr('data-code', region.code)
                .text(region.name);

            if (region.code === '1100000000' || region.name.includes('Davao')) {
                option.prop('selected', true);
            }

            $regionSelect.append(option);
        });

        if (!$regionSelect.val() && regions.length > 0) {
            $regionSelect.val(regions[0].name);
        }

        loadInventoryProvinces();
    }

    function fallbackInventoryRegions() {
        const $regionSelect = $('#invSelectRegion');
        $regionSelect.empty().append(`
            <option value="Region XI (Davao Region)" data-code="1100000000" selected>Region XI (Davao Region)</option>
            <option value="Region X (Northern Mindanao)" data-code="1000000000">Region X (Northern Mindanao)</option>
            <option value="Region IX (Zamboanga Peninsula)" data-code="0900000000">Region IX (Zamboanga Peninsula)</option>
            <option value="Region XII (SOCCSKSARGEN)" data-code="1200000000">Region XII (SOCCSKSARGEN)</option>
            <option value="Region XIII (Caraga)" data-code="1600000000">Region XIII (Caraga)</option>
            <option value="BARMM" data-code="1900000000">BARMM</option>
            <option value="NCR (Metro Manila)" data-code="1300000000">NCR (Metro Manila)</option>
        `);
        loadInventoryProvinces();
    }

    function loadInventoryProvinces() {
        const $regionSelect = $('#invSelectRegion');
        const regionCode = $regionSelect.find('option:selected').attr('data-code');
        const $provinceSelect = $('#invSelectProvince');
        $provinceSelect.empty().append('<option value="">Loading provinces...</option>');

        if (!regionCode) {
            loadInventoryCities();
            return;
        }

        if (psgcCache.provinces[regionCode]) {
            populateInventoryProvinceDropdown(psgcCache.provinces[regionCode]);
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
                    populateInventoryProvinceDropdown(data);
                } else {
                    fallbackInventoryProvinces();
                }
            },
            error: function() {
                fallbackInventoryProvinces();
            }
        });
    }

    function populateInventoryProvinceDropdown(provinces) {
        const $provinceSelect = $('#invSelectProvince');
        $provinceSelect.empty();

        if (provinces.length === 0) {
            const regionName = $('#invSelectRegion').val();
            $provinceSelect.append(`<option value="${regionName}" data-code="N/A">${regionName}</option>`);
        } else {
            provinces.forEach(prov => {
                const option = $('<option>')
                    .attr('value', prov.name)
                    .attr('data-code', prov.code)
                    .text(prov.name);
                
                if (prov.name.includes('Davao del Sur')) {
                    option.prop('selected', true);
                }
                $provinceSelect.append(option);
            });

            if (!$provinceSelect.val() && provinces.length > 0) {
                $provinceSelect.val(provinces[0].name);
            }
        }

        loadInventoryCities();
    }

    function fallbackInventoryProvinces() {
        const $provinceSelect = $('#invSelectProvince');
        $provinceSelect.empty().append(`
            <option value="Davao del Sur" data-code="1102400000" selected>Davao del Sur</option>
            <option value="Davao del Norte" data-code="1102300000">Davao del Norte</option>
            <option value="Misamis Oriental" data-code="1004300000">Misamis Oriental</option>
        `);
        loadInventoryCities();
    }

    function loadInventoryCities() {
        const $provinceSelect = $('#invSelectProvince');
        const provinceCode = $provinceSelect.find('option:selected').attr('data-code');
        const regionCode = $('#invSelectRegion option:selected').attr('data-code');
        const $citySelect = $('#invSelectCity');
        $citySelect.empty().append('<option value="">Loading cities...</option>');

        const fetchUrl = (provinceCode && provinceCode !== 'N/A')
            ? `https://psgc.cloud/api/provinces/${provinceCode}/cities-municipalities`
            : `https://psgc.cloud/api/regions/${regionCode}/cities-municipalities`;

        const cacheKey = (provinceCode && provinceCode !== 'N/A') ? provinceCode : `region_${regionCode}`;

        if (psgcCache.cities[cacheKey]) {
            populateInventoryCityDropdown(psgcCache.cities[cacheKey]);
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
                    populateInventoryCityDropdown(cleanData);
                } else {
                    fallbackInventoryCities();
                }
            },
            error: function() {
                fallbackInventoryCities();
            }
        });
    }

    function populateInventoryCityDropdown(cities) {
        const $citySelect = $('#invSelectCity');
        $citySelect.empty();

        cities.forEach(city => {
            const option = $('<option>')
                .attr('value', city.name)
                .attr('data-code', city.code)
                .text(city.name);

            if (city.name.includes('Davao')) {
                option.prop('selected', true);
            }
            $citySelect.append(option);
        });

        if (!$citySelect.val() && cities.length > 0) {
            $citySelect.val(cities[0].name);
        }

        loadInventoryBarangays();
    }

    function fallbackInventoryCities() {
        const $citySelect = $('#invSelectCity');
        $citySelect.empty().append(`
            <option value="City of Davao" data-code="1130700000" selected>City of Davao</option>
            <option value="City of Digos" data-code="1102403000">City of Digos</option>
        `);
        loadInventoryBarangays();
    }

    function loadInventoryBarangays() {
        const $citySelect = $('#invSelectCity');
        const cityCode = $citySelect.find('option:selected').attr('data-code');
        const $barangaySelect = $('#invSelectBarangay');
        $barangaySelect.empty().append('<option value="">Loading barangays...</option>');

        if (!cityCode) {
            triggerInventoryGeocodeResolution();
            return;
        }

        if (psgcCache.barangays[cityCode]) {
            populateInventoryBarangayDropdown(psgcCache.barangays[cityCode]);
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
                    populateInventoryBarangayDropdown(data);
                } else {
                    fallbackInventoryBarangays();
                }
            },
            error: function() {
                fallbackInventoryBarangays();
            }
        });
    }

    function populateInventoryBarangayDropdown(barangays) {
        const $barangaySelect = $('#invSelectBarangay');
        $barangaySelect.empty();

        if (barangays.length === 0) {
            $barangaySelect.append('<option value="Poblacion" data-code="N/A">Poblacion</option>');
        } else {
            barangays.forEach(brgy => {
                const option = $('<option>')
                    .attr('value', brgy.name)
                    .attr('data-code', brgy.code)
                    .text(brgy.name);
                
                if (brgy.name.toLowerCase().includes('buhangin') || brgy.name.toLowerCase().includes('poblacion')) {
                    option.prop('selected', true);
                }
                $barangaySelect.append(option);
            });

            if (!$barangaySelect.val() && barangays.length > 0) {
                $barangaySelect.val(barangays[0].name);
            }
        }

        triggerInventoryGeocodeResolution();
    }

    function fallbackInventoryBarangays() {
        const $barangaySelect = $('#invSelectBarangay');
        $barangaySelect.empty().append(`
            <option value="Buhangin" data-code="1130700100" selected>Buhangin</option>
            <option value="Poblacion" data-code="1130700200">Poblacion</option>
        `);
        triggerInventoryGeocodeResolution();
    }

    function triggerInventoryGeocodeResolution() {
        const region = $('#invSelectRegion').val();
        const province = $('#invSelectProvince').val();
        const city = $('#invSelectCity').val();
        const barangay = $('#invSelectBarangay').val();

        const resolvedAddress = [barangay, city, province, region].filter(Boolean).join(', ');
        $('#invDisplayResolvedAddress').text(resolvedAddress);

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

        applyInventoryCoordinates(defaultLat, defaultLng);

        if (invGeocodeDebounceTimer) clearTimeout(invGeocodeDebounceTimer);

        invGeocodeDebounceTimer = setTimeout(() => {
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
                        applyInventoryCoordinates(lat, lng);
                    }
                }
            });
        }, 400);
    }

    function applyInventoryCoordinates(lat, lng) {
        const latFormatted = parseFloat(lat).toFixed(6);
        const lngFormatted = parseFloat(lng).toFixed(6);

        $('#inputLat').val(latFormatted);
        $('#inputLng').val(lngFormatted);
        $('#invDisplayLatLongText').text(`${latFormatted}, ${lngFormatted}`);
    }

    // Start incoming referral polling every 12 seconds
    setInterval(pollIncomingReferrals, 12000);

    // Start active referral recommendations polling every 4 seconds
    setInterval(checkAndPollRecommendations, 4000);

    // Initialize session check
    checkSession();
});
