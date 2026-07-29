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

    // API Base URL (auto-detect PhpStorm/IntelliJ built-in preview server on port 63343)
    const isIdeServer = location.port === '63343';
    const API_BASE = isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend';
    const API_V1_ME = isIdeServer ? 'http://localhost/mock_hospitals/api/v1/hospitals/me/inventory' : '../api/v1/hospitals/me/inventory';

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
            .removeClass('bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/20')
            .addClass('text-slate-400 hover:text-white hover:bg-slate-900');

        if (tabName === 'patients') {
            $('#navTabPatients')
                .removeClass('text-slate-400 hover:text-white hover:bg-slate-900')
                .addClass('bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/20');
            $('#mainHeaderTitle').text('Patient Records');
            $('#tabInventoryContent').hide();
            $('#tabPatientsContent').fadeIn(200);
        } else if (tabName === 'inventory') {
            $('#navTabInventory')
                .removeClass('text-slate-400 hover:text-white hover:bg-slate-900')
                .addClass('bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/20');
            $('#mainHeaderTitle').text('Inventory & Hospital Profile');
            $('#tabPatientsContent').hide();
            $('#tabInventoryContent').fadeIn(200);
            loadInventory();
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

    /**
     * Load Hospital Inventory via GET /api/v1/hospitals/me/inventory
     */
    function loadInventory() {
        if (!currentHospital) return;

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
                // Online mode: hide offline alert banner & enable submit button
                $('#serverOfflineAlert').slideUp(200);
                $('#btnSubmitInventory').prop('disabled', false).html('<i class="bi bi-cloud-arrow-up me-2"></i> Update Inventory');

                populateHospitalProfile(data);
            },
            error: function (xhr) {
                const cachedRaw = localStorage.getItem(cacheKey);

                if (cachedRaw) {
                    // Load and display cached data fetched before server went offline
                    try {
                        const cachedData = JSON.parse(cachedRaw);
                        populateHospitalProfile(cachedData, true);

                        // Show offline alert banner & disable submit button
                        $('#serverOfflineAlert').slideDown(200);
                        $('#btnSubmitInventory').prop('disabled', true).html('<i class="bi bi-wifi-off me-2"></i> Server Offline (Updates Disabled)');

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

                // If no cached data exists, display server connection notice
                const errData = xhr.responseJSON || {};
                const isConnectionErr = xhr.status === 503 || xhr.status === 0 || (errData.detail && errData.detail.includes("reach the server"));
                const errorTitle = isConnectionErr ? "Can't Reach Server" : "API Authorization Notice";
                const errorMsg = isConnectionErr 
                    ? "Can't reach the server, contact devs @ irdss.devs@up.edu.ph"
                    : (errData.detail || "Could not retrieve hospital profile from backend.");

                Swal.fire({
                    icon: 'error',
                    title: errorTitle,
                    text: errorMsg,
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
                $btn.html('<span>Sign In to System</span> <i class="bi bi-arrow-right"></i>').prop('disabled', false);

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
                $btn.html('<span>Sign In to System</span> <i class="bi bi-arrow-right"></i>').prop('disabled', false);
                
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
        $.ajax({
            url: `${API_BASE}/logout.php`,
            type: 'POST',
            dataType: 'json',
            success: function () {
                currentHospital = null;
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
     * Live System Clock Ticker
     */
    function updateSystemClock() {
        const now = new Date();
        const options = {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        };
        $('#systemClock').text(now.toLocaleString('en-US', options));
    }
    setInterval(updateSystemClock, 1000);
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
                <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100">
                    <td class="py-3.5 px-6 font-mono text-xs font-semibold text-slate-500">#${patient.id}</td>
                    <td class="py-3.5 px-6 font-semibold text-slate-900">${escapeHtml(patient.first_name)} ${escapeHtml(patient.last_name)}</td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs">${escapeHtml(patient.dob)}</td>
                    <td class="py-3.5 px-6"><span class="px-2.5 py-1 rounded-full text-xs font-medium ${genderBadgeClass}">${escapeHtml(patient.gender)}</span></td>
                    <td class="py-3.5 px-6 text-slate-600 text-xs font-mono">${escapeHtml(patient.phone)}</td>
                    <td class="py-3.5 px-6 text-right">
                        <button class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg shadow-sm hover:shadow active:scale-[0.98] transition-all btn-refer-patient flex items-center gap-1.5 ml-auto" data-id="${patient.id}">
                            <i class="bi bi-send-plus"></i> Refer Patient
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
        $('#badgeEmergencyEquip').html(data.emergency_equipment ? '<i class="bi bi-check-circle me-1"></i> Available' : '<i class="bi bi-x-circle me-1"></i> Unavailable')
            .attr('class', data.emergency_equipment ? 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700' : 'px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700');

        $('#badgeMedicalEquip').html(data.medical_equipment ? '<i class="bi bi-check-circle me-1"></i> Available' : '<i class="bi bi-x-circle me-1"></i> Unavailable')
            .attr('class', data.medical_equipment ? 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700' : 'px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700');

        $('#badgeCommSystems').html(data.communication_systems ? '<i class="bi bi-check-circle me-1"></i> Active' : '<i class="bi bi-x-circle me-1"></i> Inactive')
            .attr('class', data.communication_systems ? 'px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700' : 'px-3 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-700');

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
     * Submit Inventory Update via PATCH /api/v1/hospitals/me/inventory
     */
    $('#updateInventoryForm').on('submit', function (e) {
        e.preventDefault();

        if (!currentHospital) return;

        const apiKey = currentHospital.api_key || '';
        const $btn = $('#btnSubmitInventory');
        const originalText = $btn.html();

        $btn.html('<span class="spinner-border spinner-border-sm me-2"></span> Updating...').prop('disabled', true);

        const payload = JSON.stringify({
            available_beds: parseInt($('#inputBeds').val(), 10),
            medical_specialists_count: parseInt($('#inputSpecs').val(), 10),
            hospital_level: $('#inputLevel').val(),
            hospital_environment: $('#inputEnv').val(),
            latitude: parseFloat($('#inputLat').val()),
            longitude: parseFloat($('#inputLng').val()),
            emergency_equipment: $('#inputEmergencyEquip').is(':checked'),
            medical_equipment: $('#inputMedicalEquip').is(':checked'),
            communication_systems: $('#inputCommSystems').is(':checked')
        });

        function handlePatchSuccess(data) {
            $btn.html(originalText).prop('disabled', false);
            
            // Instantly trigger auto-refresh call to fetch fresh data from backend
            loadInventory();

            Swal.fire({
                toast: true,
                position: 'top-end',
                icon: 'success',
                title: 'Hospital Resource Profile Updated!',
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
            success: function (data) {
                handlePatchSuccess(data);
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
                    success: function (data) {
                        handlePatchSuccess(data);
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
                                : (errObj.detail || "Could not update inventory records."),
                            confirmButtonColor: '#0d6efd'
                        });
                    }
                });
            }
        });
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
                    $('#modalPatientName').text(`${patient.first_name} ${patient.last_name}`);
                    $('#modalPatientDob').text(patient.dob);
                    $('#modalPatientGender').text(patient.gender);
                    $('#modalPatientPhone').text(patient.phone || 'N/A');

                    $('#referralModal').fadeIn(200);
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
                    Swal.fire({
                        icon: 'success',
                        title: 'Referral Transmitted Successfully!',
                        html: `
                            <p class="mb-3 text-slate-600 text-sm">The referral payload has been successfully compiled and transmitted to the Interoperability Layer (IOL).</p>
                            <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #dbeafe; color: #1e3a8a; border-color: #bfdbfe;">
                                <div class="flex items-start gap-2.5">
                                    <i class="bi bi-info-circle-fill text-blue-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                                    <span class="text-xs font-semibold leading-relaxed">Please wait for the IOL to process the referral. We'll notify you once a receiving hospital accepts your referral.</span>
                                </div>
                            </div>
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> Got it',
                        confirmButtonColor: '#0d6efd',
                        customClass: { popup: 'rounded-4 shadow-lg' }
                    });
                } else {
                    const status = response.http_status || 500;
                    const errorTitle = `HTTP ${status} Error`;
                    const errorMsg = escapeHtml(cleanErrorMessage(response.message || "Referral process failed.", status));

                    Swal.fire({
                        icon: 'error',
                        title: errorTitle,
                        html: `
                            <p class="mb-3 text-slate-600 text-sm font-medium">${errorMsg}</p>
                            <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #fef2f2; color: #991b1b; border-color: #fecaca;">
                                <div class="flex items-start gap-2.5">
                                    <i class="bi bi-exclamation-triangle-fill text-red-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                                    <span class="text-xs font-semibold leading-relaxed">It seems like there is a problem with the server, contact developer at irdss.dev@upmin.edu.ph</span>
                                </div>
                            </div>
                        `,
                        confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
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
                const errorTitle = `HTTP ${status} Error`;

                Swal.fire({
                    icon: 'error',
                    title: errorTitle,
                    html: `
                        <p class="mb-3 text-slate-600 text-sm font-medium">${errorMsg}</p>
                        <div class="p-4 rounded-2xl text-start shadow-sm border" style="background-color: #fef2f2; color: #991b1b; border-color: #fecaca;">
                            <div class="flex items-start gap-2.5">
                                <i class="bi bi-exclamation-triangle-fill text-red-600 text-lg leading-none mt-0.5 flex-shrink-0"></i>
                                <span class="text-xs font-semibold leading-relaxed">It seems like there is a problem with the server, contact developer at irdss.dev@upmin.edu.ph</span>
                            </div>
                        </div>
                    `,
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
     * Refresh button event
     */
    $('#btnRefreshPatients').on('click', function () {
        loadPatients();
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
        if (clean.length > 180) {
            clean = clean.substring(0, 177) + '...';
        }
        return clean;
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

    // Initialize session check
    checkSession();
});
