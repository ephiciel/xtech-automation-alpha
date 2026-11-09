"use strict";
// Stage 4.37: reports-ui has no network or Firebase side effects at module load.
(function registerReportsUi(global) {
    function createReportsUi(deps) {
        const {
            $,
            api,
            toast,
            esc,
            fmtDateTime,
            fmtDate,
            stockStatus,
            movementTypeLabel,
            getProfile,
            getCurrentUser,
            getToken,
            onPendingChange,
            document,
            fetch,
            URL,
            URLSearchParams,
            setTimeout
        } = deps;
        let reportCache = null;
        let reportCacheQuery = null;
        // Builds, displays, prints, and exports reports
        // Builds the selected report date range for API requests
        function reportQuery() {
            const start = $("reportStart").value;
            const end = $("reportEnd").value;
            if (start && end && start > end)
                throw new Error("Report start date cannot be after the end date.");
            const params = new URLSearchParams();
            if (start) params.set("start", start);
            if (end) params.set("end", end);
            return params.toString();
        }

        // Loads report data and summary totals
        async function loadReports() {
            try {
                const query = reportQuery();
                reportCache = await api(`/api/reports/summary${query ? `?${query}` : ""}`);
                reportCacheQuery = query;
                $("rProducts").textContent = reportCache.metrics.totalProducts;
                $("rLow").textContent = reportCache.metrics.lowStock;
                $("rCustomers").textContent = reportCache.metrics.activeCustomers;
                $("rSales").textContent = reportCache.metrics.sales;
                $("rUnitsSold").textContent = Number(
                    reportCache.metrics.unitsSold || 0
                ).toLocaleString();
                $("rPickups").textContent = reportCache.metrics.pickups;
                $("reportGeneratedAt").textContent =
                    `Generated ${fmtDateTime(reportCache.generatedAt)}`;
                const start = reportCache.period.start;
                const end = reportCache.period.end;
                $("reportPeriodLabel").textContent =
                    start || end
                        ? `Reporting period: ${start ? fmtDate(start) : "Beginning"} to ${end ? fmtDate(end) : "Present"}`
                        : "Reporting period: All available records / current inventory";
                renderReportTable();
                return reportCache;
            } catch (error) {
                toast(error.message);
                return null;
            }
        }

        // Reloads reports when the date filters changed after the last generation
        async function ensureCurrentReportData() {
            const query = reportQuery();
            if (!reportCache || reportCacheQuery !== query) {
                const loaded = await loadReports();
                if (!loaded) throw new Error("Generate the report before exporting or printing.");
            }
            return reportCache;
        }

        // Converts report data into table headings and rows
        function reportTableRows(type) {
            if (!reportCache) return { title: "Report", headers: [], rows: [] };
            if (type === "inventory")
                return {
                    title: "Inventory Report",
                    headers: [
                        "Product ID",
                        "Product Name",
                        "Category",
                        "Unit",
                        "Quantity",
                        "Reorder Level",
                        "Stock Status"
                    ],
                    rows: reportCache.inventory.map((item) => [
                        item.productID,
                        item.productName,
                        item.category,
                        item.unit || "—",
                        item.quantity,
                        item.reorderLevel,
                        stockStatus(item)
                    ])
                };
            if (type === "transactions")
                return {
                    title: "Stock Movement Report",
                    headers: [
                        "Date & Time",
                        "Movement Type",
                        "Product",
                        "Quantity Changed",
                        "Stock Before",
                        "Stock After",
                        "Reason / Reference",
                        "Performed By"
                    ],
                    rows: reportCache.transactions.map((item) => [
                        fmtDateTime(item.createdAt),
                        movementTypeLabel(item.type),
                        `${item.productName} (${item.productID})`,
                        `${["STOCK_IN", "INITIAL_STOCK"].includes(item.type) ? "+" : "−"}${item.quantity}`,
                        item.previousQuantity,
                        item.newQuantity,
                        item.reason || "—",
                        item.performedBy || "System"
                    ])
                };
            if (type === "sales")
                return {
                    title: "Sales Report",
                    headers: [
                        "Date & Time",
                        "Sale Reference",
                        "Customer",
                        "Status",
                        "Products / Quantity",
                        "Processed By"
                    ],
                    rows: reportCache.sales.map((item) => [
                        fmtDateTime(item.createdAt),
                        item.saleID,
                        item.customerName || "Walk-in / No registered customer",
                        item.status,
                        (item.items || [])
                            .map(
                                (product) =>
                                    `${product.productName || product.productID} × ${Number(product.quantity)}`
                            )
                            .join("; ") || "—",
                        item.createdByName || "—"
                    ])
                };
            return {
                title: "Pickup Report",
                headers: [
                    "Request Date & Time",
                    "Pickup Reference",
                    "Customer",
                    "Requested Pickup Date",
                    "Status",
                    "Notes"
                ],
                rows: reportCache.pickups.map((item) => [
                    fmtDateTime(item.createdAt),
                    item.pickupID,
                    item.customerName || "Walk-in / No registered customer",
                    fmtDate(item.requestedDate),
                    item.status,
                    item.notes || "—"
                ])
            };
        }

        // Displays the currently selected report table
        function renderReportTable() {
            const model = reportTableRows($("reportType").value);
            $("reportTableTitle").textContent = model.title;
            $("reportRowCount").textContent =
                `${model.rows.length.toLocaleString()} ${model.rows.length === 1 ? "row" : "rows"}`;
            $("reportTableHead").innerHTML =
                `<tr>${model.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr>`;
            $("reportTableBody").innerHTML = model.rows.length
                ? model.rows
                      .map(
                          (row) =>
                              `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`
                      )
                      .join("")
                : `<tr><td colspan="${model.headers.length || 1}"><div class="table-empty">No records are available for this report and date range.</div></td></tr>`;
        }

        // Builds summary values that are useful for the selected report
        function reportPrintSummary(type) {
            if (!reportCache) return [];

            if (type === "inventory") {
                const totalStock = reportCache.inventory.reduce(
                    (sum, item) => sum + Number(item.quantity || 0),
                    0
                );
                const categories = new Set(
                    reportCache.inventory.map((item) => item.category).filter(Boolean)
                ).size;
                return [
                    ["Active Products", reportCache.inventory.length.toLocaleString()],
                    ["Current Total Stock", totalStock.toLocaleString()],
                    ["Low / Out of Stock", reportCache.lowStock.length.toLocaleString()],
                    ["Categories", categories.toLocaleString()]
                ];
            }

            if (type === "transactions") {
                const addedTypes = new Set(["STOCK_IN", "INITIAL_STOCK"]);
                const removedTypes = new Set(["STOCK_OUT", "PICKUP_OUT", "SALE_OUT"]);
                const added = reportCache.transactions
                    .filter((item) => addedTypes.has(item.type))
                    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                const removed = reportCache.transactions
                    .filter((item) => removedTypes.has(item.type))
                    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
                return [
                    ["Movements", reportCache.transactions.length.toLocaleString()],
                    ["Stock Added", added.toLocaleString()],
                    ["Stock Removed", removed.toLocaleString()],
                    ["Net Change", (added - removed).toLocaleString()]
                ];
            }

            if (type === "sales") {
                const confirmed = reportCache.sales.filter((item) => item.status === "Confirmed");
                const unitsSold = confirmed.reduce(
                    (sum, sale) =>
                        sum +
                        (sale.items || []).reduce(
                            (itemSum, item) => itemSum + Number(item.quantity || 0),
                            0
                        ),
                    0
                );
                const productIDs = new Set(
                    confirmed
                        .flatMap((sale) => (sale.items || []).map((item) => item.productID))
                        .filter(Boolean)
                );
                return [
                    ["Sales Transactions", reportCache.sales.length.toLocaleString()],
                    ["Confirmed Sales", confirmed.length.toLocaleString()],
                    ["Units Sold", unitsSold.toLocaleString()],
                    ["Distinct Products Sold", productIDs.size.toLocaleString()]
                ];
            }

            const countStatus = (status) =>
                reportCache.pickups.filter((item) => item.status === status).length;
            return [
                ["Pickup Requests", reportCache.pickups.length.toLocaleString()],
                ["Pending", countStatus("Pending").toLocaleString()],
                ["Completed", countStatus("Completed").toLocaleString()],
                ["Cancelled", countStatus("Cancelled").toLocaleString()]
            ];
        }

        // Returns the date range text used by the clean print view
        function reportPrintPeriod(type) {
            if (type === "inventory") return "Current inventory snapshot";
            const start = reportCache?.period?.start;
            const end = reportCache?.period?.end;
            if (!start && !end) return "All available records";
            return `${start ? fmtDate(start) : "Beginning"} to ${end ? fmtDate(end) : "Present"}`;
        }

        // Opens a report-only print document so the browser can print it or save it as PDF
        function printCurrentReport() {
            const profile = getProfile();
            const currentUser = getCurrentUser();
            const type = $("reportType").value;
            const model = reportTableRows(type);
            const summary = reportPrintSummary(type);
            const generatedBy =
                profile?.name || currentUser?.displayName || currentUser?.email || "XTECH user";
            const generatedAt = fmtDateTime(reportCache?.generatedAt || new Date().toISOString());
            const period = reportPrintPeriod(type);
            const orientation = ["inventory", "transactions"].includes(type)
                ? "landscape"
                : "portrait";
            const safeTitle = `${model.title} - XTECH Automation`;
            const tableBody = model.rows.length
                ? model.rows
                      .map(
                          (row) =>
                              `<tr>${row.map((value) => `<td>${esc(value)}</td>`).join("")}</tr>`
                      )
                      .join("")
                : `<tr><td colspan="${model.headers.length || 1}" class="empty">No records are available for this report and date range.</td></tr>`;

            const frame = document.createElement("iframe");
            frame.className = "report-print-frame";
            frame.setAttribute("aria-hidden", "true");
            document.body.appendChild(frame);

            const printDocument = frame.contentDocument;
            printDocument.open();
            printDocument.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(safeTitle)}</title>
<style>
  @page { size: ${orientation}; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 10px; line-height: 1.4; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #2563eb; }
  .brand { margin: 0; font-size: 19px; font-weight: 800; }
  .brand span { color: #2563eb; }
  .company { margin: 3px 0 0; color: #4b5563; font-size: 10px; }
  .meta { min-width: 220px; text-align: right; color: #4b5563; font-size: 9px; }
  .meta strong { color: #111827; }
  .report-heading { margin: 18px 0 4px; font-size: 17px; }
  .period { margin: 0 0 13px; color: #4b5563; }
  .summary { display: grid; grid-template-columns: repeat(${Math.min(4, Math.max(1, summary.length))}, 1fr); gap: 8px; margin-bottom: 14px; }
  .summary-item { padding: 9px 10px; border: 1px solid #d1d5db; border-radius: 7px; background: #f9fafb; }
  .summary-item span { display: block; margin-bottom: 3px; color: #6b7280; font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
  .summary-item strong { font-size: 14px; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  th, td { padding: 6px 6px; border: 1px solid #d1d5db; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #eef2f7; font-size: 8.5px; text-align: left; font-weight: 800; }
  td { font-size: 8.5px; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  .empty { padding: 22px; text-align: center; color: #6b7280; }
  .footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid #d1d5db; display: flex; justify-content: space-between; gap: 16px; color: #6b7280; font-size: 8px; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="brand">XTECH <span>Automation</span></h1>
      <p class="company">AGB XTECH Industrial Sales</p>
    </div>
    <div class="meta">
      <div><strong>Generated:</strong> ${esc(generatedAt)}</div>
      <div><strong>Generated by:</strong> ${esc(generatedBy)}</div>
      <div><strong>Rows:</strong> ${model.rows.length.toLocaleString()}</div>
    </div>
  </div>
  <h2 class="report-heading">${esc(model.title)}</h2>
  <p class="period">${esc(period)}</p>
  <div class="summary">
    ${summary.map(([label, value]) => `<div class="summary-item"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`).join("")}
  </div>
  <table>
    <thead><tr>${model.headers.map((header) => `<th>${esc(header)}</th>`).join("")}</tr></thead>
    <tbody>${tableBody}</tbody>
  </table>
  <div class="footer">
    <span>Generated by XTECH Automation</span>
    <span>${esc(model.title)} - ${esc(period)}</span>
  </div>
</body>
</html>`);
            printDocument.close();

            const cleanup = () => setTimeout(() => frame.remove(), 500);
            frame.contentWindow.onafterprint = cleanup;
            setTimeout(() => {
                frame.contentWindow.focus();
                frame.contentWindow.print();
                setTimeout(() => {
                    if (frame.isConnected) frame.remove();
                }, 60000);
            }, 150);
        }

        $("refreshReports").addEventListener("click", loadReports);
        $("reportType").addEventListener("change", renderReportTable);
        $("clearReportDates").addEventListener("click", () => {
            $("reportStart").value = "";
            $("reportEnd").value = "";
            loadReports();
        });

        $("exportCurrentCsv").addEventListener("click", async () => {
            let loadingStarted = false;
            try {
                await ensureCurrentReportData();
                const type = $("reportType").value;
                const query = reportQuery();
                onPendingChange(1);
                loadingStarted = true;
                const response = await fetch(
                    `/api/reports/csv/${type}${query ? `?${query}` : ""}`,
                    { headers: { Authorization: `Bearer ${getToken()}` } }
                );
                if (!response.ok) {
                    const errorBody = await response.json().catch(() => null);
                    const message = errorBody?.message || "Export failed.";

                    throw new Error(message);
                }
                const blob = await response.blob();
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = `xtech-${type}-report.csv`;
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                toast("Current report exported as CSV");
            } catch (error) {
                toast(error.message);
            } finally {
                if (loadingStarted) onPendingChange(-1);
            }
        });

        $("printReport").addEventListener("click", async () => {
            try {
                await ensureCurrentReportData();
                printCurrentReport();
            } catch (error) {
                toast(error.message);
            }
        });

        return Object.freeze({
            loadReports,
            reportQuery,
            ensureCurrentReportData,
            reportTableRows,
            renderReportTable,
            reportPrintSummary,
            reportPrintPeriod,
            printCurrentReport
        });
    }
    global.XTechReportsUi = Object.freeze({ createReportsUi });
})(typeof window !== "undefined" ? window : globalThis);
