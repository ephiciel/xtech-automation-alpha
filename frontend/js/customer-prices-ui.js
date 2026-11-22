"use strict";

(function registerCustomerPricesUi(global) {
    function createCustomerPricesUi(deps) {
        const { $, api, toast, esc, getCustomers, getProfile, confirm } = deps;

        const money = (cents) =>
            Number.isSafeInteger(cents) && cents >= 0
                ? "PHP " +
                  (cents / 100).toLocaleString("en-PH", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2
                  })
                : "Not set";

        async function manageCustomerPrices(customerID) {
            if (getProfile()?.role !== "admin") {
                toast("Only Admin can manage negotiated prices.");
                return;
            }

            const customer = getCustomers().find((item) => item.id === customerID);
            if (!customer) return toast("Customer not found.");

            const endpoint = `/api/customers/${encodeURIComponent(customerID)}/prices`;

            try {
                const [productData, priceData] = await Promise.all([
                    api("/api/products"),
                    api(endpoint)
                ]);

                const products = (productData.products || []).filter(
                    (item) => item && item.active !== false
                );
                let specials = Array.isArray(priceData.prices) ? priceData.prices : [];

                if (!products.length) return toast("No active products available.");

                const options = products
                    .map(
                        (product) =>
                            `<option value="${esc(product.productID)}">${esc(product.productName)} (${esc(product.productID)})</option>`
                    )
                    .join("");

                $("modalBody").innerHTML = `
                    <h2>Manage Prices — ${esc(customer.name)}</h2>
                    <p class="helper-text">Negotiated amounts apply only to this customer.</p>
                    <form id="customerPriceForm" class="form-grid">
                        <label>Product
                            <select id="customerPriceProduct" required>${options}</select>
                        </label>
                        <label>Negotiated amount (PHP)
                            <input id="customerPriceAmount" type="number"
                                min="0" max="9999999.99" step="0.01"
                                inputmode="decimal" required>
                        </label>
                        <p id="customerPriceCurrent" class="helper-text wide"></p>
                        <button id="customerPriceSave" class="primary wide"
                            type="submit">Save Negotiated Amount</button>
                    </form>
                    <h3>Current negotiated amounts</h3>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Product</th><th>Amount</th><th>Action</th></tr>
                            </thead>
                            <tbody id="customerPriceRows"></tbody>
                        </table>
                    </div>`;

                $("modal").classList.remove("hidden");

                const productFor = (id) => products.find((product) => product.productID === id);

                const specialFor = (id) =>
                    specials.find((item) => item.productID === id && item.active !== false);

                const itemEndpoint = (id) => `${endpoint}/${encodeURIComponent(id)}`;

                function renderRows() {
                    const rows = specials.filter((item) => item.active !== false);

                    $("customerPriceRows").innerHTML = rows.length
                        ? rows
                              .map(
                                  (item) => `
                            <tr>
                                <td>${esc(productFor(item.productID)?.productName || item.productID)}</td>
                                <td>${esc(money(item.priceCents))}</td>
                                <td>
                                    <button type="button" class="small-btn secondary"
                                        data-clear="${esc(item.productID)}">Clear</button>
                                </td>
                            </tr>`
                              )
                              .join("")
                        : '<tr><td colspan="3">No negotiated amounts saved.</td></tr>';
                }

                function syncSelection() {
                    const id = $("customerPriceProduct").value;
                    const product = productFor(id);
                    const special = specialFor(id);

                    $("customerPriceCurrent").textContent =
                        `Default: ${money(product?.basePriceCents)} · Customer: ${money(special?.priceCents)}`;

                    $("customerPriceAmount").value = Number.isSafeInteger(special?.priceCents)
                        ? (special.priceCents / 100).toFixed(2)
                        : "";
                }

                async function refresh() {
                    const result = await api(endpoint);
                    specials = Array.isArray(result.prices) ? result.prices : [];
                    renderRows();
                    syncSelection();
                }

                $("customerPriceProduct").addEventListener("change", syncSelection);

                $("customerPriceForm").addEventListener("submit", async (event) => {
                    event.preventDefault();

                    const id = $("customerPriceProduct").value;
                    const price = $("customerPriceAmount").value.trim();

                    if (!productFor(id) || !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(price)) {
                        return toast("Select a product and enter a valid PHP amount.");
                    }

                    const button = $("customerPriceSave");
                    button.disabled = true;

                    try {
                        await api(itemEndpoint(id), {
                            method: "PUT",
                            body: JSON.stringify({ price })
                        });
                        await refresh();
                        toast("Negotiated amount saved.");
                    } catch (error) {
                        toast(error.message || "Could not save negotiated amount.");
                    } finally {
                        button.disabled = false;
                    }
                });

                $("customerPriceRows").addEventListener("click", async (event) => {
                    const button = event.target.closest("button[data-clear]");
                    if (!button) return;

                    const id = button.dataset.clear;
                    if (!specialFor(id)) return;

                    if (!confirm("Clear the negotiated amount for this product?")) {
                        return;
                    }

                    button.disabled = true;
                    try {
                        await api(itemEndpoint(id), { method: "DELETE" });
                        await refresh();
                        toast("Negotiated amount cleared.");
                    } catch (error) {
                        toast(error.message || "Could not clear negotiated amount.");
                    } finally {
                        button.disabled = false;
                    }
                });

                renderRows();
                $("customerPriceProduct").value = products[0].productID;
                syncSelection();
            } catch (error) {
                toast(error.message || "Could not load negotiated amounts.");
            }
        }

        global.manageCustomerPrices = manageCustomerPrices;
        return Object.freeze({ manageCustomerPrices });
    }

    global.XTechCustomerPricesUi = Object.freeze({
        createCustomerPricesUi
    });
})(typeof window !== "undefined" ? window : globalThis);
