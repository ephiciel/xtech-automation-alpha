"use strict";
// Stage 4.36: browser-only UI module, initialized from app.js.
(function installUiModule(global) {
    function createPickupUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            esc,
            badge,
            todayYMD,
            within,
            fmtDateTime,
            fmtDate,
            validateFutureDate,
            validateText,
            validatePositiveWholeNumber,
            getProfile,
            productById,
            customerNameFor,
            itemSummary,
            ensureFormData,
            mergeFormItem,
            updateProductSelectors,
            updateCustomerSelectors,
            loadDashboard,
            loadInventory,
            loadTransactions,
            setProducts,
            getPickups,
            setPickups,
            getPickupFormItems,
            setPickupFormItems,
            confirm,
            window
        } = deps;

        // Customer prices stay separate from the shared inventory state.
        let customerPrices = new Map();
        const isCustomer = () => getProfile()?.role === "customer";
        const validCents = (value) => Number.isSafeInteger(value) && value >= 0;
        const money = (cents, fallback = "Price not available") =>
            validCents(cents)
                ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
                      cents / 100
                  )
                : fallback;
        const unitPrice = (id) => customerPrices.get(id) ?? null;
        function subtotal(id, quantity) {
            const cents = unitPrice(id);
            const total = cents * quantity;
            return validCents(cents) &&
                Number.isSafeInteger(quantity) &&
                quantity > 0 &&
                validCents(total)
                ? total
                : null;
        }
        function orderTotal() {
            let total = 0;
            for (const item of getPickupFormItems()) {
                const line = subtotal(item.productID, item.quantity);
                if (line === null || !validCents(total + line)) return null;
                total += line;
            }
            return total;
        }
        function priceSignature() {
            return JSON.stringify(
                getPickupFormItems().map((item) => [
                    item.productID,
                    item.quantity,
                    unitPrice(item.productID)
                ])
            );
        }
        function renderSelectedPrice() {
            const display = $("pickupSelectedPrice");
            if (!display) return;
            display.hidden = !isCustomer();
            const id = $("pickupProduct")?.value;
            const qty = Number($("pickupQuantity")?.value);
            display.textContent =
                isCustomer() && id
                    ? `Unit price: ${money(unitPrice(id))} · Subtotal: ${money(subtotal(id, qty))}`
                    : "";
        }
        async function refreshCustomerPrices() {
            customerPrices = new Map();
            if (!isCustomer()) return;
            const data = await api("/api/catalog/products", { silent: true });
            if (!Array.isArray(data.products))
                throw new Error("Unable to load current selling prices.");
            if (!isCustomer()) return;
            customerPrices = new Map(
                data.products.map((product) => [
                    product.productID,
                    validCents(product.sellingPriceCents) ? product.sellingPriceCents : null
                ])
            );
        }

        function pickupPhoto(product, size = 40) {
            const src = typeof product?.imageUrl === "string" ? product.imageUrl : "";
            if (!/^https:\/\//i.test(src)) return "";
            return `<img data-product-image alt="Product" referrerpolicy="no-referrer" src="${esc(src)}" width="${size}" height="${size}" loading="lazy" style="object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:8px">`;
        }

        // Displays the products added to a pickup request
        function renderPickupFormItems() {
            const container = $("pickupItemList");
            if (!container) return;
            container.innerHTML = getPickupFormItems().length
                ? getPickupFormItems()
                      .map((item) => {
                          const product = productById(item.productID);
                          return `<div class="item-row">
                    <div>${pickupPhoto(product)}<strong>${esc(product?.productName || item.productID)}</strong><small>${esc(item.productID)} · Available: ${Number(product?.quantity ?? 0)} ${esc(product?.unit || "units")}</small></div>
                    <span>Requested: <strong>${item.quantity}</strong>${isCustomer() ? `<small class="table-subtext">Unit price: ${esc(money(unitPrice(item.productID)))} · Subtotal: ${esc(money(subtotal(item.productID, item.quantity)))}</small>` : ""}</span>
                    <button type="button" class="small-btn ghost dark-ghost" onclick="removePickupItem('${esc(item.productID)}')">Remove</button>
                </div>`;
                      })
                      .join("")
                : '<div class="empty-state">No products added to this pickup request yet.</div>';
            const total = $("pickupOrderTotal");
            if (total) {
                total.hidden = !isCustomer();
                total.textContent = isCustomer() ? `Total price: ${money(orderTotal())}` : "";
            }
            renderSelectedPrice();
        }

        // Keeps pickup quantities synchronized with the same inventory values shown to admin users.
        function syncPickupQuantityLimit() {
            const select = $("pickupProduct");
            const input = $("pickupQuantity");
            const hint = $("pickupStockHint");
            if (!select || !input) return;

            const product = productById(select.value);
            const preview = $("pickupProductPreview");
            if (preview) preview.innerHTML = product ? pickupPhoto(product, 64) : "";
            if (!product) {
                input.max = "1";
                input.value = "1";
                input.disabled = true;
                if ($("addPickupItem")) $("addPickupItem").disabled = true;
                if (hint)
                    hint.textContent =
                        "Select a product to view the current admin inventory quantity.";
                renderSelectedPrice();
                return;
            }

            const alreadyAdded =
                getPickupFormItems().find((item) => item.productID === product.productID)
                    ?.quantity || 0;
            const adminStock = Math.max(0, Number(product.quantity || 0));
            const remaining = Math.max(0, adminStock - alreadyAdded);

            input.max = String(Math.max(1, remaining));
            input.disabled = remaining <= 0;
            if ($("addPickupItem")) $("addPickupItem").disabled = remaining <= 0;
            if (Number(input.value) > remaining || Number(input.value) < 1)
                input.value = remaining > 0 ? "1" : "";

            if (hint) {
                hint.textContent =
                    remaining > 0
                        ? `Admin inventory: ${adminStock} ${product.unit || "units"}. ${alreadyAdded} already added to this request; ${remaining} can still be added.`
                        : `Admin inventory: ${adminStock} ${product.unit || "units"}. No more can be added to this request.`;
            }
            renderSelectedPrice();
        }

        // Reloads the authoritative product stock used by the admin account.
        async function refreshPickupInventory() {
            const [data] = await Promise.all([
                api("/api/products", { silent: true }),
                refreshCustomerPrices()
            ]).catch((error) => {
                renderPickupFormItems();
                throw error;
            });
            setProducts(data.products || []);
            updateProductSelectors();
            renderPickupFormItems();
            syncPickupQuantityLimit();
        }

        // Handles pickup requests and pickup status changes
        // Loads pickup requests from the backend
        async function loadPickups() {
            try {
                $("pickupDate").min = todayYMD();
                const needCustomers = getProfile()?.role !== "customer";
                const [pickupData] = await Promise.all([
                    api("/api/pickups"),
                    ensureFormData({ needCustomers })
                ]);
                setPickups(pickupData.pickups || []);
                renderPickups();
                try {
                    await refreshCustomerPrices();
                } finally {
                    renderPickupFormItems();
                    syncPickupQuantityLimit();
                }
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters and displays pickup requests
        function renderPickups() {
            const search = $("pickupSearch").value.trim().toLowerCase();
            const status = $("pickupStatusFilter").value;
            const start = $("pickupFrom").value;
            const end = $("pickupTo").value;
            const rows = getPickups().filter((pickup) => {
                const productText = (pickup.items || [])
                    .map(
                        (item) =>
                            `${item.productID} ${productById(item.productID)?.productName || ""}`
                    )
                    .join(" ");
                return (
                    (!search ||
                        `${pickup.pickupID} ${pickup.customerName} ${productText} ${pickup.notes || ""}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!status || pickup.status === status) &&
                    within(pickup.requestedDate, start, end)
                );
            });

            const priceHeader = $("pickupTotalPriceHeader");
            if (priceHeader) priceHeader.hidden = !isCustomer();
            $("pickupTable").innerHTML = rows.length
                ? rows
                      .map((pickup) => {
                          let actions = "—";
                          if (getProfile()?.role === "customer" && pickup.status === "Pending") {
                              actions = `<button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel Request</button>`;
                          } else if (
                              getProfile()?.role !== "customer" &&
                              pickup.status === "Pending"
                          ) {
                              actions = `<button class="small-btn secondary" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Approved')">Approve</button><button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel</button>`;
                          } else if (
                              getProfile()?.role !== "customer" &&
                              pickup.status === "Approved"
                          ) {
                              actions = `<button class="small-btn primary" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Completed')">Complete Pickup</button><button class="small-btn ghost dark-ghost" onclick="setPickup('${esc(pickup.id || pickup.pickupID)}', 'Cancelled')">Cancel</button>`;
                          }
                          return `<tr><td>${fmtDateTime(pickup.createdAt)}</td><td><strong>${esc(pickup.pickupID)}</strong></td><td>${esc(pickup.customerName || customerNameFor(pickup.customerID, "Walk-in / No registered customer"))}</td><td>${fmtDate(pickup.requestedDate)}</td><td>${badge(pickup.status)}</td><td>${itemSummary(pickup.items)}<small class="table-subtext">Total ordered: ${Number(pickup.totalQuantity ?? (pickup.items || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0))}</small></td>${isCustomer() ? `<td><strong>${esc(money(pickup.totalCents, "Price not recorded"))}</strong></td>` : ""}<td class="wrap-cell">${esc(pickup.notes || "—")}</td><td>${actions}</td></tr>`;
                      })
                      .join("")
                : `<tr><td colspan="${isCustomer() ? 9 : 8}"><div class="table-empty">No pickup requests match the current filters.</div></td></tr>`;
        }

        ["pickupSearch", "pickupStatusFilter", "pickupFrom", "pickupTo"].forEach((id) =>
            $(id).addEventListener("input", renderPickups)
        );

        $("pickupProduct").addEventListener("change", syncPickupQuantityLimit);
        $("pickupQuantity").addEventListener("input", renderSelectedPrice);

        $("addPickupItem").addEventListener("click", async (event) => {
            try {
                // Refresh first so the customer is checked against the same current stock the admin account uses.
                await busy(event.currentTarget, refreshPickupInventory, "Checking Stock…");
                syncPickupQuantityLimit();

                const productID = $("pickupProduct").value;
                const quantity = Number($("pickupQuantity").value);
                const product = productById(productID);
                if (!product) return toast("Select a product first.");

                validatePositiveWholeNumber(quantity, "Pickup quantity");
                if (isCustomer() && subtotal(productID, quantity) === null)
                    return toast("Selling price is unavailable. Please contact AGB XTECH.");

                const existing = getPickupFormItems().find((item) => item.productID === productID);
                const requestedTotal = quantity + (existing?.quantity || 0);
                const adminStock = Number(product.quantity || 0);
                if (requestedTotal > adminStock) {
                    return toast(
                        `Order cannot proceed. Admin inventory shows only ${adminStock} ${product.unit || "units"} of ${product.productName}, but this request would total ${requestedTotal}.`
                    );
                }

                mergeFormItem(getPickupFormItems(), productID, quantity);
                $("pickupQuantity").value = "1";
                renderPickupFormItems();
                syncPickupQuantityLimit();
            } catch (error) {
                toast(error.message);
            }
        });

        // Removes a product from the current pickup request
        window.removePickupItem = (productID) => {
            setPickupFormItems(getPickupFormItems().filter((item) => item.productID !== productID));
            renderPickupFormItems();
            syncPickupQuantityLimit();
        };

        $("pickupForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("pickupMessage", "");
            if (!getPickupFormItems().length)
                return setMessage(
                    "pickupMessage",
                    "Add at least one product to the pickup request."
                );
            try {
                const requestedDate = validateFutureDate(
                    $("pickupDate").value,
                    "Requested pickup date"
                );
                const notes = validateText($("pickupNotes").value, "Pickup notes", 500);

                // Recheck immediately before submission so stale browser data cannot be used.
                const quotedPrices = isCustomer() ? priceSignature() : null;
                await refreshPickupInventory();
                for (const item of getPickupFormItems()) {
                    const product = productById(item.productID);
                    if (!product)
                        throw new Error(`Product ${item.productID} is no longer available.`);
                    const adminStock = Number(product.quantity || 0);
                    if (item.quantity > adminStock) {
                        throw new Error(
                            `Order cannot proceed. Admin inventory shows ${adminStock} ${product.unit || "units"} of ${product.productName}, but ${item.quantity} were ordered.`
                        );
                    }
                }

                const expectedTotalCents = isCustomer() ? orderTotal() : null;
                if (
                    isCustomer() &&
                    (expectedTotalCents === null || quotedPrices !== priceSignature())
                ) {
                    throw new Error(
                        "Pickup prices changed or are unavailable. Review the updated total and try again."
                    );
                }
                await busy(
                    event.submitter,
                    () =>
                        api("/api/pickups", {
                            method: "POST",
                            body: JSON.stringify({
                                customerID:
                                    getProfile()?.role === "customer"
                                        ? null
                                        : $("pickupCustomerID").value || null,
                                requestedDate,
                                notes,
                                items: getPickupFormItems(),
                                ...(isCustomer() ? { expectedTotalCents } : {})
                            })
                        }),
                    "Submitting Pickup…"
                );
                event.target.reset();
                $("pickupDate").min = todayYMD();
                setPickupFormItems([]);
                renderPickupFormItems();
                updateCustomerSelectors();
                updateProductSelectors();
                syncPickupQuantityLimit();
                setMessage("pickupMessage", "Pickup request submitted successfully.", "success");
                await Promise.all([
                    loadPickups(),
                    getProfile()?.role === "customer" ? Promise.resolve() : loadDashboard()
                ]);
                toast("Pickup request submitted");
            } catch (error) {
                if (isCustomer() && /prices changed or are unavailable/i.test(error.message)) {
                    try {
                        await refreshPickupInventory();
                    } catch {
                        /* Keep the original message. */
                    }
                }
                setMessage("pickupMessage", error.message);
            }
        });

        // Changes the status of a pickup request
        window.setPickup = async (id, status) => {
            const wording =
                status === "Completed"
                    ? "complete this pickup and deduct its products from inventory"
                    : status === "Cancelled"
                      ? "cancel this pickup request"
                      : "approve this pickup request";
            if (!confirm(`Are you sure you want to ${wording}?`)) return;
            try {
                await api(`/api/pickups/${encodeURIComponent(id)}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ status })
                });
                const reloads = [loadPickups()];
                if (getProfile()?.role !== "customer")
                    reloads.push(loadInventory(), loadTransactions(), loadDashboard());
                await Promise.all(reloads);
                toast(status === "Cancelled" ? "Pickup cancelled" : `Pickup marked ${status}`);
            } catch (error) {
                toast(error.message);
            }
        };

        return Object.freeze({
            loadPickups,
            renderPickups,
            renderPickupFormItems,
            syncPickupQuantityLimit,
            refreshPickupInventory
        });
    }
    global.XTechPickupUi = Object.freeze({ createPickupUi });
})(typeof window !== "undefined" ? window : globalThis);
