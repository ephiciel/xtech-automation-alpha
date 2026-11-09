"use strict";
// Stage 4.37: dashboard-ui has no network or Firebase side effects at module load.
(function registerDashboardUi(global) {
    function createDashboardUi(deps) {
        const { $, api, toast, esc, badge, stockStatus, document, makeChart } = deps;
        let charts = {};
        // Loads dashboard totals, low-stock products, and chart data
        async function loadDashboard() {
            try {
                const data = await api("/api/dashboard");
                $("mProducts").textContent = data.metrics.totalProducts;
                $("mLow").textContent = data.metrics.lowStock;
                $("mCustomers").textContent = data.metrics.customers;
                $("mPickups").textContent = data.metrics.pendingPickups;
                $("mSales").textContent = data.metrics.totalSales;
                $("mUnitsSold").textContent = Number(
                    data.metrics.totalUnitsSold || 0
                ).toLocaleString();
                drawCharts(data);

                $("dashboardLowStock").innerHTML = data.lowStockProducts.length
                    ? data.lowStockProducts
                          .map(
                              (product) =>
                                  `<tr><td>${esc(product.productName)}</td><td>${Number(product.quantity)} ${esc(product.unit || "")}</td><td>${Number(product.reorderLevel)}</td><td>${badge(stockStatus(product))}</td></tr>`
                          )
                          .join("")
                    : '<tr><td colspan="4">No low-stock products.</td></tr>';
            } catch (error) {
                toast(error.message);
            }
        }

        // Draws the inventory, pickup, and sales charts
        function drawCharts(data) {
            Object.values(charts).forEach((chart) => chart?.destroy());
            charts = {};

            const darkMode = document.body.classList.contains("dark");
            const textColor = darkMode ? "#cbd5e1" : "#475569";
            const gridColor = darkMode ? "rgba(148, 163, 184, 0.12)" : "rgba(148, 163, 184, 0.20)";
            const blue = darkMode ? "#60a5fa" : "#2563eb";
            const purple = darkMode ? "#a78bfa" : "#7c3aed";
            const green = darkMode ? "#4ade80" : "#16a34a";

            const commonScales = {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, maxRotation: 0, autoSkip: true }
                },
                y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor } }
            };
            const commonPlugins = {
                legend: { labels: { color: textColor, boxWidth: 12, usePointStyle: true } }
            };

            charts.inventory = makeChart($("inventoryChart"), {
                type: "bar",
                data: {
                    labels: data.inventory.map((item) => item.name),
                    datasets: [
                        {
                            label: "Quantity in Stock",
                            data: data.inventory.map((item) => item.quantity),
                            backgroundColor: darkMode
                                ? "rgba(96, 165, 250, 0.55)"
                                : "rgba(37, 99, 235, 0.72)",
                            borderColor: blue,
                            borderWidth: 1,
                            borderRadius: 6,
                            maxBarThickness: 42
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: commonPlugins,
                    scales: commonScales
                }
            });

            charts.pickups = makeChart($("pickupChart"), {
                type: "line",
                data: {
                    labels: data.weeklyPickups.map((item) => item.date),
                    datasets: [
                        {
                            label: "Pickup Requests",
                            data: data.weeklyPickups.map((item) => item.count),
                            borderColor: purple,
                            backgroundColor: darkMode
                                ? "rgba(167, 139, 250, 0.12)"
                                : "rgba(124, 58, 237, 0.10)",
                            pointBackgroundColor: purple,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            tension: 0.35,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: commonPlugins,
                    scales: {
                        x: commonScales.x,
                        y: { ...commonScales.y, ticks: { ...commonScales.y.ticks, precision: 0 } }
                    }
                }
            });

            charts.sales = makeChart($("salesChart"), {
                type: "line",
                data: {
                    labels: data.weeklySales.map((item) => item.date),
                    datasets: [
                        {
                            label: "Units Sold",
                            data: data.weeklySales.map((item) => item.unitsSold),
                            borderColor: green,
                            backgroundColor: darkMode
                                ? "rgba(74, 222, 128, 0.10)"
                                : "rgba(22, 163, 74, 0.09)",
                            pointBackgroundColor: green,
                            pointRadius: 3,
                            pointHoverRadius: 5,
                            tension: 0.35,
                            fill: true
                        }
                    ]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: commonPlugins,
                    scales: commonScales
                }
            });
        }

        $("refreshDashboard").addEventListener("click", loadDashboard);

        return Object.freeze({
            loadDashboard,
            drawCharts,
            hasCharts: () => Object.keys(charts).length > 0
        });
    }
    global.XTechDashboardUi = Object.freeze({ createDashboardUi });
})(typeof window !== "undefined" ? window : globalThis);
