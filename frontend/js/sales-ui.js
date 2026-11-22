"use strict";
// Stage 4.37: sales-ui has no network or Firebase side effects at module load.
(function registerSalesUi(global) {
    function createSalesUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            esc,
            badge,
            within,
            fmtDateTime,
            customerNameFor,
            itemSummary,
            productById,
            getProfile,
            validatePositiveWholeNumber,
            mergeFormItem,
            validateText,
            updateCustomerSelectors,
            updateProductSelectors,
            loadInventory,
            loadTransactions,
            loadDashboard,
            ensureFormData,
            confirm,
            window
        } = deps;
        let sales = [];
        let saleFormItems = [];
        let customerPrices = new Map();
        let priceCustomerID = "";
        let pricesReady = true;
        let pricingRequest = 0;

        const isAdmin = () => getProfile?.()?.role === "admin";
        const validCents = (n) => Number.isSafeInteger(n) && n >= 0;
        const money = (cents) =>
            validCents(cents)
                ? "PHP " +
                  (cents / 100).toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                  })
                : "Not priced";

        function resolvedPreviewPrice(item) {
            if (Object.prototype.hasOwnProperty.call(item, "overridePrice")) {
                const value = String(item.overridePrice);
                if (/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(value)) {
                    const [p, c = ""] = value.split(".");
                    return Number(p) * 100 + Number(c.padEnd(2, "0"));
                }
                return null;
            }
            const customerID = $("saleCustomerID")?.value || "";
            // Only Admin can fetch confidential customer-specific prices.
            if (customerID && (!isAdmin() || !pricesReady || priceCustomerID !== customerID)) {
                return null;
            }
            if (customerID && customerPrices.has(item.productID)) {
                return customerPrices.get(item.productID);
            }
            const base = productById(item.productID)?.basePriceCents;
            return validCents(base) ? base : null;
        }

        function showOverrideField() {
            const wrapper = $("saleOverrideWrap");
            if (!wrapper) return;
            wrapper.hidden = !isAdmin();
            if (wrapper.style) wrapper.style.display = isAdmin() ? "" : "none";
        }

        async function loadCustomerPricePreview() {
            const requestId = ++pricingRequest;
            const customerID = $("saleCustomerID")?.value || "";
            priceCustomerID = customerID;
            customerPrices = new Map();
            pricesReady = !customerID;
            renderSaleFormItems();
            if (!customerID || !isAdmin()) return;
            try {
                const data = await api(
                    "/api/customers/" + encodeURIComponent(customerID) + "/prices"
                );
                if (!Array.isArray(data.prices)) throw Error("Invalid price response");
                if (requestId !== pricingRequest) return;
                customerPrices = new Map(
                    data.prices
                        .filter((p) => p?.active !== false && validCents(p?.priceCents))
                        .map((p) => [p.productID, p.priceCents])
                );
                pricesReady = true;
                renderSaleFormItems();
            } catch {
                if (requestId !== pricingRequest) return;
                pricesReady = false;
                renderSaleFormItems();
                toast(
                    "Customer price preview unavailable. The server will calculate the final amount."
                );
            }
        }

        function updatePricePreview() {
            const target = $("salePricePreview");
            if (!target) return;
            if (!saleFormItems.length) {
                target.textContent = "Add products to view an estimated total.";
                return;
            }
            let total = 0;
            for (const item of saleFormItems) {
                const unit = resolvedPreviewPrice(item);
                if (unit === null) {
                    target.textContent =
                        "Total unavailable: one or more prices are unconfigured or cannot be previewed. The server determines the final recorded amount.";
                    return;
                }
                total += unit * item.quantity;
                if (!Number.isSafeInteger(total)) {
                    target.textContent = "Estimated amount exceeds supported range.";
                    return;
                }
            }
            target.textContent =
                "Estimated total: " +
                money(total) +
                ". The server recalculates prices when recording the sale.";
        }
        // Displays products and quantities in the current sale
        function renderSaleFormItems() {
            const container = $("saleItemList");
            if (!container) return;
            container.innerHTML = saleFormItems.length
                ? saleFormItems
                      .map((item) => {
                          const product = productById(item.productID);
                          return `<div class="item-row">
            <div><strong>${esc(product?.productName || item.productID)}</strong><small>${esc(item.productID)} · Available: ${Number(product?.quantity ?? 0)} ${esc(product?.unit || "units")}</small></div>
            <span><strong>${Number(item.quantity)}</strong> ${esc(product?.unit || "units")}<small>${esc(resolvedPreviewPrice(item) === null ? "Price not available for preview" : money(resolvedPreviewPrice(item)) + " each (estimated)")}</small></span>
            <button type="button" class="small-btn ghost dark-ghost" onclick="removeSaleItem('${esc(item.productID)}')">Remove</button>
        </div>`;
                      })
                      .join("")
                : '<div class="empty-state">No products added to this sale yet.</div>';
            updatePricePreview();
        }

        // Handles sales records and sale details
        // Loads sales records from the backend
        async function loadSales() {
            try {
                const [saleData] = await Promise.all([
                    api("/api/sales"),
                    ensureFormData({ needCustomers: true })
                ]);
                sales = saleData.sales || [];
                showOverrideField();
                renderSaleFormItems();
                renderSales();
                await loadCustomerPricePreview();
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters and displays sales records
        function renderSales() {
            const search = $("saleSearch").value.trim().toLowerCase();
            const customerID = $("saleCustomerFilter").value;
            const status = $("saleStatusFilter").value;
            const start = $("saleFrom").value;
            const end = $("saleTo").value;
            const rows = sales.filter((sale) => {
                const productText = (sale.items || [])
                    .map((item) => `${item.productName} ${item.productID}`)
                    .join(" ");
                return (
                    (!search ||
                        `${sale.saleID} ${sale.customerName} ${productText} ${sale.notes || ""}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!customerID || sale.customerID === customerID) &&
                    (!status || sale.status === status) &&
                    within(sale.createdAt, start, end)
                );
            });
            $("saleTable").innerHTML = rows.length
                ? rows
                      .map(
                          (sale) =>
                              `<tr><td>${fmtDateTime(sale.createdAt)}</td><td><strong>${esc(sale.saleID)}</strong></td><td>${esc(sale.customerName || customerNameFor(sale.customerID))}</td><td>${badge(sale.status)}</td><td>${itemSummary(sale.items)}</td><td>${esc(isAdmin() ? (validCents(sale.totalCents) ? money(sale.totalCents) : "—") : "Restricted")}</td><td>${esc(sale.createdByName || "—")}</td><td><button class="small-btn secondary" onclick="viewSale('${esc(sale.id || sale.saleID)}')">View Details</button></td></tr>`
                      )
                      .join("")
                : '<tr><td colspan="8"><div class="table-empty">No sales transactions match the current filters.</div></td></tr>';
        }

        ["saleSearch", "saleCustomerFilter", "saleStatusFilter", "saleFrom", "saleTo"].forEach(
            (id) => $(id).addEventListener("input", renderSales)
        );

        $("addSaleItem").addEventListener("click", () => {
            const productID = $("saleProduct").value;
            const quantity = Number($("saleQuantity").value);
            const product = productById(productID);
            if (!product) return toast("Select a product first.");
            try {
                validatePositiveWholeNumber(quantity, "Sale quantity");
            } catch (error) {
                return toast(error.message);
            }
            const existing = saleFormItems.find((item) => item.productID === productID);
            if (quantity + (existing?.quantity || 0) > Number(product.quantity))
                return toast(
                    `Only ${product.quantity} ${product.unit || "units"} of ${product.productName} are currently available.`
                );
            const override = $("saleOverridePrice")?.value?.trim() || "";
            if (override) {
                if (!isAdmin()) return toast("Only Admin can override a sale price.");
                if (!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(override)) {
                    return toast("Enter a valid price with up to two decimal places.");
                }
                if (existing?.overridePrice !== undefined && existing.overridePrice !== override) {
                    return toast("Remove this item before changing its override price.");
                }
            }
            mergeFormItem(saleFormItems, productID, quantity);
            if (override) {
                saleFormItems.find((item) => item.productID === productID).overridePrice = override;
            }
            if ($("saleOverridePrice")) $("saleOverridePrice").value = "";
            $("saleQuantity").value = "1";
            renderSaleFormItems();
        });

        $("saleCustomerID").addEventListener("change", loadCustomerPricePreview);
        showOverrideField();

        // Removes a product from the current sale
        window.removeSaleItem = (productID) => {
            saleFormItems = saleFormItems.filter((item) => item.productID !== productID);
            renderSaleFormItems();
        };

        $("saleForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("saleMessage", "");
            if (!saleFormItems.length)
                return setMessage(
                    "saleMessage",
                    "Add at least one product before confirming the sale."
                );
            try {
                const notes = validateText($("saleNotes").value, "Sale notes", 500);
                if (
                    !confirm(
                        "Confirm this sale? Inventory will be deducted and final prices recalculated by the server."
                    )
                )
                    return;

                const data = await busy(
                    event.submitter,
                    () =>
                        api("/api/sales", {
                            method: "POST",
                            body: JSON.stringify({
                                customerID: $("saleCustomerID").value || null,
                                items: saleFormItems,
                                notes
                            })
                        }),
                    "Recording Sale…"
                );
                event.target.reset();
                saleFormItems = [];
                customerPrices = new Map();
                priceCustomerID = "";
                renderSaleFormItems();
                updateCustomerSelectors();
                updateProductSelectors();
                setMessage(
                    "saleMessage",
                    `Sale ${data.sale.saleID} recorded successfully.`,
                    "success"
                );
                await Promise.all([
                    loadSales(),
                    loadInventory(),
                    loadTransactions(),
                    loadDashboard()
                ]);
                toast("Sale recorded successfully");
            } catch (error) {
                setMessage("saleMessage", error.message);
            }
        });

        // Opens the details of a selected sale
        window.viewSale = (id) => {
            const sale = sales.find((item) => item.id === id || item.saleID === id);
            if (!sale) return;
            const rows = (sale.items || [])
                .map(
                    (item) =>
                        `<tr><td>${esc(item.productName)}</td><td>${esc(item.productID)}</td><td>${Number(item.quantity)}</td><td>${esc(isAdmin() ? money(item.unitPriceCents) : "Restricted")}</td><td>${esc(isAdmin() ? money(item.lineTotalCents) : "Restricted")}</td></tr>`
                )
                .join("");
            $("modalBody").innerHTML =
                `<h2>Sale Details</h2><div class="detail-grid"><div><span>Sale Reference</span><strong>${esc(sale.saleID)}</strong></div><div><span>Date & Time</span><strong>${fmtDateTime(sale.createdAt)}</strong></div><div><span>Customer</span><strong>${esc(sale.customerName || customerNameFor(sale.customerID))}</strong></div><div><span>Status</span><strong>${esc(sale.status)}</strong></div><div><span>Processed By</span><strong>${esc(sale.createdByName || "—")}</strong></div></div><h3>Products Sold</h3><div class="table-wrap"><table><thead><tr><th>Product</th><th>Product ID</th><th>Quantity</th><th>Unit Price</th><th>Line Total</th></tr></thead><tbody>${rows}</tbody></table></div><p><strong>Recorded total:</strong> ${esc(isAdmin() ? money(sale.totalCents) : "Restricted")}</p><h3>Notes</h3><p>${esc(sale.notes || "No notes recorded.")}</p>`;
            $("modal").classList.remove("hidden");
        };

        return Object.freeze({ loadSales, renderSales, renderSaleFormItems });
    }
    global.XTechSalesUi = Object.freeze({ createSalesUi });
})(typeof window !== "undefined" ? window : globalThis);
