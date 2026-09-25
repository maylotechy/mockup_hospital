(function initializeIrdssPatientForm(window, $) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    IRDSS.patients = IRDSS.patients || {};

    const { API_BASE } = IRDSS.config;
    const { formatDateTime12h } = IRDSS.formatters;
    const { showToast } = IRDSS.ui;
    const { switchTab } = IRDSS.navigation;
    let initialized = false;

    function cancel() {
        $('#patientForm')[0].reset();
        switchTab('patients');
    }

    function togglePhilhealthFields() {
        const isMember = $('#patPhilhealthMember').val() === 'Yes';
        $('#patPhilhealthStatus, #patPhilhealthNumber').prop('disabled', !isMember);
        if (!isMember) {
            $('#patPhilhealthStatus').val('');
            $('#patPhilhealthNumber').val('');
        }
    }

    function submit($submitButton, originalButtonHtml, formData) {
        $.ajax({
            url: `${API_BASE}/save_patient.php`,
            type: 'POST',
            data: formData,
            dataType: 'json',
            success(response) {
                if (response.success) {
                    $submitButton.html(originalButtonHtml).prop('disabled', false);
                    $('#patientForm')[0].reset();
                    switchTab('patients');
                    IRDSS.patients.list.load();
                    showToast('success', response.data && response.data.linked ? 'Using existing patient record.' : 'Patient registered successfully.', 2500);
                    return;
                }

                if (response.possible_duplicate) {
                    $submitButton.html(originalButtonHtml).prop('disabled', false);
                    const existingPatient = response.existing_patient;
                    window.Swal.fire({
                        icon: 'warning',
                        title: 'Possible Existing Patient',
                        html: `<p class="text-sm text-slate-600 text-start">A patient named <strong>${existingPatient.full_name}</strong> (DOB ${existingPatient.dob}) is already on file at your facility, registered ${formatDateTime12h(existingPatient.registered_at)}. Link to that record, or create a new one?</p>`,
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
                            $submitButton.prop('disabled', true);
                            submit($submitButton, originalButtonHtml, Object.assign({}, formData, { duplicate_choice: 'link', link_patient_id: existingPatient.id }));
                        } else if (choice.isDenied) {
                            $submitButton.prop('disabled', true);
                            submit($submitButton, originalButtonHtml, Object.assign({}, formData, { duplicate_choice: 'new' }));
                        }
                    });
                    return;
                }

                $submitButton.html(originalButtonHtml).prop('disabled', false);
                window.Swal.fire({
                    icon: 'error',
                    title: 'Could Not Register Patient',
                    text: response.message || 'Please check the form and try again.',
                    confirmButtonColor: '#dc3545'
                });
            },
            error(xhr) {
                $submitButton.html(originalButtonHtml).prop('disabled', false);
                window.Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: `Failed to register patient (${xhr.status}).`,
                    confirmButtonColor: '#dc3545'
                });
            }
        });
    }

    function init() {
        if (initialized) return;
        initialized = true;

        $('#patPhilhealthMember').on('change.patientForm', togglePhilhealthFields);
        $('#btnAddPatient').on('click.patientForm', function () {
            $('#patientForm')[0].reset();
            togglePhilhealthFields();
            switchTab('addPatient');
        });
        $('#btnCancelAddPatient, #btnCancelAddPatient2').on('click.patientForm', cancel);
        $('#patientForm').on('submit.patientForm', function (event) {
            event.preventDefault();
            const $submitButton = $('#btnSubmitPatient');
            const originalButtonHtml = $submitButton.html();
            $submitButton.html('<span class="inline-block animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent me-2"></span> Saving...').prop('disabled', true);

            submit($submitButton, originalButtonHtml, {
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
            });
        });
    }

    IRDSS.patients.form = Object.freeze({ init, cancel, togglePhilhealthFields, submit });
})(window, window.jQuery);
