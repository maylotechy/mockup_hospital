// ========================================================
// DOH Service Assessment Dynamic Form Renderer (Hospital, RHU, BHS)
// ========================================================

const isIdeServer = location.port === '63342' || location.port === '63343';
const API_BASE = window.API_BASE || (isIdeServer ? 'http://localhost/mock_hospitals/backend' : '../backend');

const DOHAssessment = (function () {
    let formContainerId = 'dohAssessmentFormContainer';
    let loadedFormData = null;

    async function loadForm() {

        const container = document.getElementById(formContainerId);
        if (!container) return;

        container.innerHTML = `
            <div class="p-8 text-center text-slate-500">
                <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-red-600 border-t-transparent mb-3"></div>
                <p class="text-xs font-semibold">Loading official DOH Service Assessment Instrument…</p>
            </div>
        `;

        try {
            const res = await fetch(`${API_BASE}/assessment.php?action=form`, { credentials: 'same-origin' });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Failed to load assessment form');
            }

            loadedFormData = await res.json();
            renderForm(loadedFormData);
        } catch (err) {
            container.innerHTML = `
                <div class="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs">
                    <strong>Error loading assessment:</strong> ${err.message}
                </div>
            `;
        }
    }

    function renderForm(data) {
        const container = document.getElementById(formContainerId);
        const form = data.form;
        const prev = data.previous_submission ? data.previous_submission.answers : {};

        let html = `
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
                <!-- Header -->
                <div class="bg-slate-900 text-white p-6 border-b border-slate-800">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <span class="inline-block px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-red-600 text-white mb-2">
                                ${data.facility_type} · ${data.facility_level || 'STANDARD'}
                            </span>
                            <h2 class="text-lg font-bold text-white leading-tight">${form.title}</h2>
                            <p class="text-xs text-slate-400 mt-1">${form.description}</p>
                        </div>
                        <div class="text-right">
                            <span class="text-xs text-slate-400">Facility Code:</span>
                            <div class="font-mono text-sm font-bold text-amber-400">${data.facility_code}</div>
                        </div>
                    </div>
                </div>

                ${data.previous_submission ? `
                    <div class="bg-emerald-50 border-b border-emerald-200 p-4 text-xs text-emerald-800 flex items-center justify-between">
                        <div>
                            <strong>Previously Submitted Assessment Loaded:</strong> Last submitted on ${new Date(data.previous_submission.submitted_at).toLocaleString()} by ${data.previous_submission.assessor_name || 'Facility Admin'}.
                        </div>
                    </div>
                ` : ''}

                <form id="dohServiceAssessmentForm" class="p-6 space-y-8">
        `;

        form.sections.forEach((sec, sIdx) => {
            html += `
                <div class="border border-slate-200 rounded-xl overflow-hidden bg-white">
                    <div class="bg-slate-50 border-b border-slate-200 px-5 py-3.5 flex items-center justify-between">
                        <h3 class="text-sm font-bold text-slate-900">${sec.title}</h3>
                        ${sec.description ? `<span class="text-xs text-slate-500">${sec.description}</span>` : ''}
                    </div>
                    <div class="p-5">
            `;

            if (sec.type === 'metadata') {
                html += renderMetadataFields(sec.fields, data.previous_submission);
            } else if (sec.type === 'services' || sec.type === 'services_simple') {
                html += renderServicesSection(sec, prev);
            } else if (sec.type === 'compliance') {
                html += renderComplianceSection(sec, prev);
            } else if (sec.type === 'infrastructure') {
                html += renderInfrastructureSection(sec, prev);
            } else if (sec.type === 'counts' || sec.type === 'bhs_personnel') {
                html += renderCountsSection(sec, prev);
            } else if (sec.type === 'equipment') {
                html += renderEquipmentSection(sec, prev);
            } else if (sec.type === 'minor_surgery') {
                html += renderMinorSurgerySection(sec, prev);
            }

            html += `
                    </div>
                </div>
            `;
        });

        html += `
                    <div class="pt-4 flex items-center justify-end gap-3">
                        <button type="button" onclick="DOHAssessment.loadForm()" class="px-5 py-2.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition">
                            Reset Form
                        </button>
                        <button type="submit" class="px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-md transition">
                            Submit
                        </button>
                    </div>
                </form>
            </div>
        `;

        container.innerHTML = html;

        // Attach Submit Event
        document.getElementById('dohServiceAssessmentForm').addEventListener('submit', handleSubmit);
    }

    function renderMetadataFields(fields, prevSub) {
        let html = `<div class="grid gap-4 sm:grid-cols-2">`;
        fields.forEach(f => {
            let val = prevSub ? (prevSub[f.item_code] || '') : '';
            if (f.item_code === 'assessment_type' && prevSub) val = prevSub.assessment_type || 'Monitoring';
            if (f.item_code === 'assessment_date' && prevSub) val = prevSub.assessment_date || new Date().toISOString().slice(0,10);
            if (f.item_code === 'assessment_period' && prevSub) val = prevSub.assessment_period || '';
            if (f.item_code === 'assessor_name' && prevSub) val = prevSub.assessor_name || '';
            if (f.item_code === 'general_remarks' && prevSub) val = prevSub.general_remarks || '';

            if (f.type === 'select') {
                html += `
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">${f.label}</label>
                        <select name="meta_${f.item_code}" class="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs text-slate-800">
                            ${f.options.map(opt => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                `;
            } else if (f.type === 'textarea') {
                html += `
                    <div class="sm:col-span-2">
                        <label class="block text-xs font-semibold text-slate-700 mb-1">${f.label}</label>
                        <textarea name="meta_${f.item_code}" rows="2" class="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-800" placeholder="Optional notes…">${val}</textarea>
                    </div>
                `;
            } else {
                html += `
                    <div>
                        <label class="block text-xs font-semibold text-slate-700 mb-1">${f.label}</label>
                        <input type="${f.type}" name="meta_${f.item_code}" value="${val}" class="w-full h-10 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs text-slate-800" placeholder="${f.placeholder || ''}" ${f.required ? 'required' : ''} />
                    </div>
                `;
            }
        });
        html += `</div>`;
        return html;
    }

    function renderServicesSection(sec, prev) {
        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50">
                            <th class="py-2.5 px-3">Service Name</th>
                            <th class="py-2.5 px-3 text-center">Available</th>
                            <th class="py-2.5 px-3 text-center">Operational</th>
                            <th class="py-2.5 px-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
        `;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const avail = p.available !== undefined ? p.available : true;
            const oper = p.operational !== undefined ? p.operational : true;
            const remarks = p.remarks || '';

            html += `
                <tr class="hover:bg-slate-50">
                    <td class="py-3 px-3 font-semibold text-slate-800">${item.label}</td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="avail_${sec.section_id}_${item.item_code}" ${avail ? 'checked' : ''} class="w-4 h-4 text-red-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="oper_${sec.section_id}_${item.item_code}" ${oper ? 'checked' : ''} class="w-4 h-4 text-emerald-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3">
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="w-full h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs" />
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    function renderComplianceSection(sec, prev) {
        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50">
                            <th class="py-2.5 px-3">Evaluation Item / Area</th>
                            <th class="py-2.5 px-3 text-center">Compliance</th>
                            <th class="py-2.5 px-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
        `;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const comp = p.compliance || 'COMPLIANT';
            const remarks = p.remarks || '';

            html += `
                <tr class="hover:bg-slate-50">
                    <td class="py-3 px-3 font-semibold text-slate-800">${item.label}</td>
                    <td class="py-3 px-3 text-center">
                        <select name="comp_${sec.section_id}_${item.item_code}" class="h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs">
                            <option value="COMPLIANT" ${comp === 'COMPLIANT' ? 'selected' : ''}>Compliant</option>
                            <option value="NON_COMPLIANT" ${comp === 'NON_COMPLIANT' ? 'selected' : ''}>Non-compliant</option>
                            <option value="NA" ${comp === 'NA' ? 'selected' : ''}>N/A</option>
                        </select>
                    </td>
                    <td class="py-3 px-3">
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="w-full h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs" />
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    function renderInfrastructureSection(sec, prev) {
        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50">
                            <th class="py-2.5 px-3">Area / Infrastructure</th>
                            <th class="py-2.5 px-3 text-center">Available</th>
                            <th class="py-2.5 px-3 text-center">Adequate / Functional</th>
                            <th class="py-2.5 px-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
        `;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const avail = p.available !== undefined ? p.available : true;
            const ade = p.adequate !== undefined ? p.adequate : true;
            const remarks = p.remarks || '';

            html += `
                <tr class="hover:bg-slate-50">
                    <td class="py-3 px-3 font-semibold text-slate-800">${item.label}</td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="avail_${sec.section_id}_${item.item_code}" ${avail ? 'checked' : ''} class="w-4 h-4 text-red-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="ade_${sec.section_id}_${item.item_code}" ${ade ? 'checked' : ''} class="w-4 h-4 text-blue-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3">
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="w-full h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs" />
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    function renderCountsSection(sec, prev) {
        let html = `<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">`;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const cnt = p.count !== undefined ? p.count : 0;
            const remarks = p.remarks || '';

            html += `
                <div class="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                    <label class="block text-xs font-bold text-slate-800 mb-1.5">${item.label}</label>
                    <div class="flex items-center gap-2">
                        <input type="number" min="0" name="count_${sec.section_id}_${item.item_code}" value="${cnt}" class="w-24 h-9 bg-white border border-slate-300 rounded font-bold text-center text-xs text-slate-900" />
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="flex-1 h-9 bg-white border border-slate-300 rounded px-2 text-xs" />
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        return html;
    }

    function renderEquipmentSection(sec, prev) {
        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50">
                            <th class="py-2.5 px-3">Equipment Name</th>
                            <th class="py-2.5 px-3 text-center">Quantity</th>
                            <th class="py-2.5 px-3 text-center">Available</th>
                            <th class="py-2.5 px-3 text-center">Functional</th>
                            <th class="py-2.5 px-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
        `;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const qty = p.count !== undefined ? p.count : 1;
            const avail = p.available !== undefined ? p.available : true;
            const func = p.operational !== undefined ? p.operational : true;
            const remarks = p.remarks || '';

            html += `
                <tr class="hover:bg-slate-50">
                    <td class="py-3 px-3 font-semibold text-slate-800">${item.label}</td>
                    <td class="py-3 px-3 text-center">
                        <input type="number" min="0" name="count_${sec.section_id}_${item.item_code}" value="${qty}" class="w-16 h-8 bg-slate-50 border border-slate-200 rounded text-center text-xs" />
                    </td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="avail_${sec.section_id}_${item.item_code}" ${avail ? 'checked' : ''} class="w-4 h-4 text-red-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="oper_${sec.section_id}_${item.item_code}" ${func ? 'checked' : ''} class="w-4 h-4 text-emerald-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3">
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="w-full h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs" />
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    function renderMinorSurgerySection(sec, prev) {
        let html = `
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead>
                        <tr class="border-b border-slate-200 text-slate-500 font-semibold bg-slate-50">
                            <th class="py-2.5 px-3">Minor Surgical Procedure</th>
                            <th class="py-2.5 px-3 text-center">Available</th>
                            <th class="py-2.5 px-3">Remarks</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100">
        `;
        sec.items.forEach(item => {
            const p = prev[item.item_code] || {};
            const avail = p.available !== undefined ? p.available : true;
            const remarks = p.remarks || '';

            html += `
                <tr class="hover:bg-slate-50">
                    <td class="py-3 px-3 font-semibold text-slate-800">${item.label}</td>
                    <td class="py-3 px-3 text-center">
                        <input type="checkbox" name="avail_${sec.section_id}_${item.item_code}" ${avail ? 'checked' : ''} class="w-4 h-4 text-red-600 rounded border-slate-300" />
                    </td>
                    <td class="py-3 px-3">
                        <input type="text" name="rem_${sec.section_id}_${item.item_code}" value="${remarks}" placeholder="Remarks" class="w-full h-8 bg-slate-50 border border-slate-200 rounded px-2 text-xs" />
                    </td>
                </tr>
            `;
        });
        html += `</tbody></table></div>`;
        return html;
    }

    async function handleSubmit(e) {
        e.preventDefault();
        const formEl = e.target;
        const formData = new FormData(formEl);

        const answers = [];
        const form = loadedFormData.form;

        form.sections.forEach(sec => {
            if (sec.type === 'metadata') return;

            sec.items.forEach(item => {
                const availInput = formEl.querySelector(`[name="avail_${sec.section_id}_${item.item_code}"]`);
                const operInput = formEl.querySelector(`[name="oper_${sec.section_id}_${item.item_code}"]`);
                const adeInput = formEl.querySelector(`[name="ade_${sec.section_id}_${item.item_code}"]`);
                const compInput = formEl.querySelector(`[name="comp_${sec.section_id}_${item.item_code}"]`);
                const countInput = formEl.querySelector(`[name="count_${sec.section_id}_${item.item_code}"]`);
                const remInput = formEl.querySelector(`[name="rem_${sec.section_id}_${item.item_code}"]`);

                answers.push({
                    category: sec.section_id,
                    item_code: item.item_code,
                    item_label: item.label,
                    available: availInput ? availInput.checked : null,
                    operational: operInput ? operInput.checked : null,
                    adequate: adeInput ? adeInput.checked : null,
                    compliance: compInput ? compInput.value : null,
                    count: countInput ? parseInt(countInput.value, 10) : null,
                    remarks: remInput ? remInput.value : null
                });
            });
        });

        const metaType = formEl.querySelector('[name="meta_assessment_type"]');
        const metaDate = formEl.querySelector('[name="meta_assessment_date"]');
        const metaPeriod = formEl.querySelector('[name="meta_assessment_period"]');
        const metaAssessor = formEl.querySelector('[name="meta_assessor_name"]');
        const metaRemarks = formEl.querySelector('[name="meta_general_remarks"]');

        const payload = {
            facility_id: loadedFormData.facility_id,
            assessment_type: metaType ? metaType.value : 'Monitoring',
            assessment_date: metaDate ? metaDate.value : new Date().toISOString().slice(0,10),
            assessment_period: metaPeriod ? metaPeriod.value : 'CY 2026',
            assessor_name: metaAssessor ? metaAssessor.value : 'Facility Admin',
            general_remarks: metaRemarks ? metaRemarks.value : '',
            answers: answers
        };

        const btn = formEl.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = 'Submitting…';

        try {
            const res = await fetch(`${API_BASE}/assessment.php?action=submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'same-origin'
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Submission failed');
            }

            const result = await res.json();
            const lockBanner = document.getElementById('assessmentLockBanner');
            if (lockBanner) lockBanner.classList.add('hidden');

            Swal.fire({
                icon: 'success',
                title: 'Assessment Submitted!',
                text: result.message,
                confirmButtonColor: '#0d6efd'
            }).then(function () {
                // Send the facility admin back to their home tab instead of
                // reloading this form -- the assessment is done, nothing left to fix here.
                if (typeof window.switchTab === 'function') {
                    window.switchTab('users');
                } else {
                    loadForm();
                }
            });

        } catch (err) {
            Swal.fire({
                icon: 'error',
                title: 'Submission Error',
                text: err.message,
                confirmButtonColor: '#0d6efd'
            });
        } finally {
            btn.disabled = false;
            btn.innerHTML = 'Submit DOH Assessment';
        }
    }

    return {
        loadForm: loadForm
    };
})();

window.DOHAssessment = DOHAssessment;

