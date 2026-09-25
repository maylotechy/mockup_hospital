(function initializeIrdssUi(window) {
    'use strict';

    const IRDSS = window.IRDSS = window.IRDSS || {};
    const TOAST_STYLE = {
        success: { bg: '#5cb85c', bar: '#4a9440', title: 'Success' },
        info: { bg: '#4a9fc4', bar: '#3d84a3', title: 'Info' },
        warning: { bg: '#f0a030', bar: '#cf8620', title: 'Warning' },
        error: { bg: '#c0504d', bar: '#a4423f', title: 'Error' }
    };

    function showToast(type, message, duration) {
        const style = TOAST_STYLE[type] || TOAST_STYLE.info;

        window.Swal.fire({
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
                    <div style="font-size: 0.82rem; opacity: 0.95; line-height: 1.3;">${IRDSS.formatters.escapeHtml(message)}</div>
                </div>
            `,
            customClass: { popup: 'toast-notification-popup' },
            didOpen: (toastEl) => {
                const bar = toastEl.querySelector('.swal2-timer-progress-bar');
                if (bar) bar.style.backgroundColor = style.bar;
                toastEl.onmouseenter = window.Swal.stopTimer;
                toastEl.onmouseleave = window.Swal.resumeTimer;
            }
        });
    }

    function showAlert(type, title, message) {
        const swalIcon = type === 'success' ? 'success' : (type === 'warning' ? 'warning' : 'error');

        window.Swal.fire({
            icon: swalIcon,
            title,
            text: message,
            confirmButtonText: '<i class="bi bi-check-lg me-1"></i> OK',
            confirmButtonColor: '#0d6efd',
            customClass: { popup: 'rounded-4 shadow-lg' }
        });
    }

    function cleanErrorMessage(msg, statusCode) {
        const containsInternalDetail = typeof msg === 'string'
            && (msg.includes('SQL')
                || msg.includes('violates')
                || msg.includes('constraint')
                || msg.includes('psycopg2')
                || msg.includes('NotNullViolation'));

        if (statusCode >= 500 || containsInternalDetail) {
            return 'An internal server error occurred while processing the request.';
        }
        if (!msg || typeof msg !== 'string') return 'An unexpected error occurred.';

        let clean = msg;
        if (clean.includes('[SQL:')) clean = clean.split('[SQL:')[0];
        if (clean.includes('DETAIL:')) clean = clean.split('DETAIL:')[0];
        clean = clean.replace(/\s*\([^)]*psycopg2[^)]*\)/gi, '').trim();
        return clean.length > 400 ? `${clean.substring(0, 397)}...` : clean;
    }

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

    IRDSS.ui = Object.freeze({
        showToast,
        showAlert,
        cleanErrorMessage,
        buildErrorNoteHtml
    });
})(window);
