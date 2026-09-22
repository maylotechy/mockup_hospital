// ========================================================
// DataTable loading skeletons.
// Renders plain placeholder rows straight into a table's <tbody> while its
// backing fetch is in flight -- never handed to DataTable() itself, only the
// real rows are (see each renderXTable() function), so a skeleton can never
// be mistaken for data, paginated, or searched.
// Matches the animate-pulse / bg-slate-200 bar style already used for the
// FHIR Receive detail panel's loading state (index.html #fhirReceiveDetailSkeleton).
// ========================================================

const TableSkeleton = (function () {
    /**
     * @param {string} tbodySelector jQuery selector for the table's <tbody>
     * @param {number} columnCount   Number of <td>s per row (match the <thead>)
     * @param {number} [rowCount]    How many placeholder rows to show
     */
    function renderRows(tbodySelector, columnCount, rowCount = 5) {
        const $tbody = $(tbodySelector);
        if (!$tbody.length) return;

        // Varies bar width per cell so a row reads as text of differing length,
        // not one solid gray block.
        const widths = ['w-4/5', 'w-1/2', 'w-full', 'w-2/3', 'w-3/4'];

        let rowsHtml = '';
        for (let r = 0; r < rowCount; r++) {
            let cellsHtml = '';
            for (let c = 0; c < columnCount; c++) {
                cellsHtml += `<td class="py-3.5 px-6 border-b border-slate-200/70"><div class="h-3.5 ${widths[(r + c) % widths.length]} bg-slate-200 rounded animate-pulse"></div></td>`;
            }
            rowsHtml += `<tr>${cellsHtml}</tr>`;
        }
        $tbody.html(rowsHtml);
    }

    return { renderRows };
})();

window.TableSkeleton = TableSkeleton;
