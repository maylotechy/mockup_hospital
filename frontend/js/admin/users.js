(function initializeIrdssAdminUsers(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.admin = IRDSS.admin || {};

    const state = IRDSS.state;
    const { API_BASE } = IRDSS.config;
    const { escapeHtml } = IRDSS.formatters;
    const { showToast } = IRDSS.ui;
    let initialized = false;

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
            const isSelf = state.currentUser && state.currentUser.id === user.id;

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

    $('#btnRefreshUsers').off('click.adminUsers').on('click.adminUsers', function () { loadUsers(); });

    // Clinical credentials (license number / trainings) only make sense for Doctor/Nurse
    function toggleUserClinicalFields() {
        const isClinical = $('#inputUserRole').val() !== 'facility_admin';
        $('#userClinicalFields').toggle(isClinical);
        if (!isClinical) {
            $('#inputUserLicenseNumber, #inputUserTrainings').val('');
        }
    }
    $('#inputUserRole').off('change.adminUsers').on('change.adminUsers', toggleUserClinicalFields);
    toggleUserClinicalFields();

    $('#btnGenerateUserPassword').off('click.adminUsers').on('click.adminUsers', function () {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let pwd = '';
        for (let i = 0; i < 8; i++) {
            pwd += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        $('#inputUserPassword').val(pwd).attr('type', 'text');
    });

    $('#addUserForm').off('submit.adminUsers').on('submit.adminUsers', function (e) {
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
    $(document).off('click.adminUsersEdit', '.btn-edit-user').on('click.adminUsersEdit', '.btn-edit-user', function () {
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

    $(document).off('click.adminUsersToggle', '.btn-toggle-user').on('click.adminUsersToggle', '.btn-toggle-user', function () {
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

    $(document).off('click.adminUsersDelete', '.btn-delete-user').on('click.adminUsersDelete', '.btn-delete-user', function () {
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

    function init() {
        if (initialized) return;
        initialized = true;
        toggleUserClinicalFields();
    }

    IRDSS.admin.users = Object.freeze({
        init,
        load: loadUsers,
        render: renderUsersTable
    });
})(window, window.jQuery);
