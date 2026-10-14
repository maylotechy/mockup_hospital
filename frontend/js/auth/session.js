(function initializeIrdssSession(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.auth = IRDSS.auth || {};
    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { showToast } = IRDSS.ui;
    let actions = {};
    let initialized = false;

    function configure(nextActions) {
        actions = { ...actions, ...nextActions };
    }

    function runAction(name) {
        if (typeof actions[name] === 'function') actions[name]();
    }

    function clearSessionState() {
        state.currentHospital = null;
        state.currentUser = null;
        state.currentReferralPatient = null;
        state.activeInitiatedReferralId = null;
        state.activeInitiatedReferralNumber = null;
        state.currentActiveReferralId = null;
    }

    function checkSession() {
        $.ajax({
            url: `${API_BASE}/login.php`,
            type: 'GET',
            dataType: 'json',
            success(response) {
                if (response.authenticated && response.user && response.facility) {
                    state.currentUser = response.user;
                    state.currentHospital = response.facility;
                    IRDSS.navigation.showDashboardView();
                    return;
                }
                clearSessionState();
                IRDSS.navigation.showLoginView();
            },
            error() {
                clearSessionState();
                IRDSS.navigation.showLoginView();
            }
        });
    }

    function bindLogin() {
        $('#loginForm').on('submit.session', function (event) {
            event.preventDefault();
            const $button = $('#btnLoginSubmit');
            $button.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Signing In...').prop('disabled', true);

            $.ajax({
                url: `${API_BASE}/login.php`,
                type: 'POST',
                data: {
                    username: $('#loginUsername').val(),
                    password: $('#loginPassword').val()
                },
                dataType: 'json',
                complete() {
                    $button.html('<span>Sign In</span> <i class="bi bi-arrow-right"></i>').prop('disabled', false);
                },
                success(response) {
                    if (response.success && response.user && response.facility) {
                        state.currentUser = response.user;
                        state.currentHospital = response.facility;
                        IRDSS.navigation.showDashboardView();
                        showToast('success', `Welcome back, ${response.user.full_name}!`, 3000);
                        return;
                    }
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Authentication Failed',
                        text: response.message || 'Invalid credentials.',
                        confirmButtonColor: '#0d6efd'
                    });
                },
                error(xhr) {
                    const message = xhr.responseJSON?.message || 'Failed to connect to authentication server.';
                    window.Swal.fire({
                        icon: 'error',
                        title: 'Login Error',
                        text: message,
                        confirmButtonColor: '#0d6efd'
                    });
                }
            });
        });
    }

    function bindLogout() {
        $(document).on('click.session', '#btnLogoutBtn, #btnLockedLogout', function () {
            window.Swal.fire({
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
                if (!result.isConfirmed) return;
                $.ajax({
                    url: `${API_BASE}/logout.php`,
                    type: 'POST',
                    dataType: 'json',
                    success() {
                        clearSessionState();
                        runAction('clearReferralNotifications');
                        try {
                            window.localStorage.removeItem('active_initiated_referral');
                            window.localStorage.clear();
                        } catch (error) {
                            // Storage can be unavailable in strict privacy modes.
                        }
                        IRDSS.navigation.showLoginView();
                        showToast('info', 'Signed out successfully.', 2500);
                    }
                });
            });
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;
        bindLogin();
        bindLogout();
        checkSession();
    }

    IRDSS.auth.session = Object.freeze({ configure, init, checkSession, clearSessionState });
})(window, window.jQuery);
