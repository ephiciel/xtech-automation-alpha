"use strict";

// Stage 4.35: Inventory product, stock and transaction UI behaviors.
// Called from app.js after all shared helpers are ready; does not start Firebase.
(function registerInventoryUi(global) {
    function createInventoryUi(deps) {
        const {
            $,
            api,
            toast,
            busy,
            esc,
            badge,
            stockStatus,
            productById,
            updateProductSelectors,
            validateProductID,
            validateProductName,
            validateCategory,
            validateText,
            validatePositiveWholeNumber,
            validationError,
            closeModal,
            loadDashboard,
            ensureFormData,
            within,
            movementTypeLabel,
            fmtDateTime,
            getProducts,
            setProducts,
            getTransactions,
            setTransactions,
            getProfile,
            confirm
        } = deps;

        // Handles inventory products and stock actions
        // Loads active products from the backend
        async function loadInventory() {
            try {
                const data = await api("/api/products");
                setProducts(data.products || []);

                // Adds all active product quantities and shows the current total stock
                const totalCurrentStock = getProducts().reduce(
                    (total, product) => total + Number(product.quantity || 0),
                    0
                );
                if ($("inventoryCurrentStock"))
                    $("inventoryCurrentStock").textContent = totalCurrentStock.toLocaleString();

                renderProducts();
                updateProductSelectors();
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters products and displays them in the inventory table
        function renderProducts() {
            const search = $("productSearch").value.trim().toLowerCase();
            const category = $("categoryFilter").value;
            const status = $("statusFilter").value;
            const canManage = ["admin", "warehouse"].includes(getProfile()?.role);
            const rows = getProducts().filter(
                (product) =>
                    (!search ||
                        `${product.productID} ${product.productName}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!category || product.category === category) &&
                    (!status || stockStatus(product) === status)
            );

            $("productTable").innerHTML = rows.length
                ? rows
                      .map(
                          (product) => `<tr>
                <td><strong>${esc(product.productID)}</strong></td><td>${esc(product.productName)}</td><td>${esc(product.category)}</td>
                <td>${badge(stockStatus(product))}</td>
                <td>${canManage ? `<button class="small-btn secondary" onclick="editProduct('${esc(product.productID)}')">Edit</button><button class="small-btn ghost dark-ghost" onclick="archiveProduct('${esc(product.productID)}')">Archive</button>` : "—"}</td>
            </tr>`
                      )
                      .join("")
                : '<tr><td colspan="5"><div class="table-empty">No products match the current filters.</div></td></tr>';
        }

        ["productSearch", "categoryFilter", "statusFilter"].forEach((id) =>
            $(id).addEventListener("input", renderProducts)
        );

        $("productForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("productMessage", "");
            try {
                const productID = validateProductID($("productID").value);
                const productName = validateProductName($("productName").value);
                const category = validateCategory($("category").value);
                const description = validateText(
                    $("description").value,
                    "Product description",
                    500
                );

                await busy(
                    event.submitter,
                    () =>
                        api("/api/products", {
                            method: "POST",
                            body: JSON.stringify({
                                productID,
                                productName,
                                category,
                                unit: "",
                                quantity: 0,
                                reorderLevel: 0,
                                description
                            })
                        }),
                    "Adding Product…"
                );
                event.target.reset();
                setMessage("productMessage", "Product added successfully.", "success");
                await Promise.all([loadInventory(), loadDashboard()]);
                toast("Product added successfully");
            } catch (error) {
                setMessage("productMessage", error.message);
            }
        });

        // Opens the form used to edit a product
        window.editProduct = (id) => {
            const product = productById(id);
            if (!product) return;
            $("modalBody").innerHTML = `<h2>Edit Product</h2>
              <form id="editProductForm" class="form-grid">
                <label>Product Name<input id="editProductName" value="${esc(product.productName)}" required></label>
                <label>Category<select id="editProductCategory"><option ${product.category === "Industrial Chemical" ? "selected" : ""}>Industrial Chemical</option><option ${product.category === "Janitorial Chemical" ? "selected" : ""}>Janitorial Chemical</option><option ${product.category === "Cleaning Supply" ? "selected" : ""}>Cleaning Supply</option><option ${product.category === "Other" ? "selected" : ""}>Other</option></select></label>
                <label class="wide">Description<textarea id="editProductDescription">${esc(product.description || "")}</textarea></label>
                <button class="primary wide">Save Product Changes</button>
              </form>`;
            $("modal").classList.remove("hidden");
            $("editProductForm").addEventListener("submit", async (event) => {
                event.preventDefault();
                try {
                    const productName = validateProductName($("editProductName").value);
                    const category = validateCategory($("editProductCategory").value);
                    const description = validateText(
                        $("editProductDescription").value,
                        "Product description",
                        500
                    );

                    await busy(
                        event.submitter,
                        () =>
                            api(`/api/products/${encodeURIComponent(id)}`, {
                                method: "PUT",
                                body: JSON.stringify({
                                    productName,
                                    category,
                                    unit: product.unit || "",
                                    reorderLevel: Number(product.reorderLevel || 0),
                                    description
                                })
                            }),
                        "Saving…"
                    );
                    closeModal();
                    await loadInventory();
                    toast("Product updated successfully");
                } catch (error) {
                    toast(error.message);
                }
            });
        };

        // Archives a product so it cannot be used in transactions
        window.archiveProduct = async (id) => {
            if (
                !confirm(
                    `Archive product ${id}? It will no longer be available for stock, pickup, or sale transactions.`
                )
            )
                return;
            try {
                await api(`/api/products/${encodeURIComponent(id)}/archive`, { method: "PATCH" });
                await Promise.all([loadInventory(), loadDashboard()]);
                toast("Product archived");
            } catch (error) {
                toast(error.message);
            }
        };

        $("archiveBtn").addEventListener("click", async () => {
            try {
                const data = await api("/api/products/archived");
                const archived = data.products || [];
                $("modalBody").innerHTML =
                    `<h2>Archived Products</h2><div class="table-wrap"><table><thead><tr><th>Product ID</th><th>Product Name</th><th>Category</th><th>Action</th></tr></thead><tbody>${archived.length ? archived.map((product) => `<tr><td>${esc(product.productID)}</td><td>${esc(product.productName)}</td><td>${esc(product.category)}</td><td><button class="small-btn secondary" onclick="restoreProduct('${esc(product.productID)}')">Restore Product</button></td></tr>`).join("") : '<tr><td colspan="4"><div class="table-empty">There are no archived products.</div></td></tr>'}</tbody></table></div>`;
                $("modal").classList.remove("hidden");
            } catch (error) {
                toast(error.message);
            }
        });

        // Restores an archived product
        window.restoreProduct = async (id) => {
            try {
                await api(`/api/products/${encodeURIComponent(id)}/restore`, { method: "PATCH" });
                closeModal();
                await Promise.all([loadInventory(), loadDashboard()]);
                toast("Product restored");
            } catch (error) {
                toast(error.message);
            }
        };

        // Opens and processes the Stock In or Stock Out form
        async function stock(type) {
            try {
                const data = await api("/api/products");
                setProducts(data.products || []);
                if (!getProducts().length) return toast("No active products are available.");
                const options = getProducts()
                    .map(
                        (product) =>
                            `<option value="${esc(product.productID)}" ${type === "out" && Number(product.quantity) <= 0 ? "disabled" : ""}>${esc(product.productName)} (${esc(product.productID)}) — ${product.quantity} ${esc(product.unit || "units")} available</option>`
                    )
                    .join("");
                $("modalBody").innerHTML =
                    `<h2>${type === "in" ? "Stock In — Add Stock" : "Stock Out — Release Stock"}</h2>
                  <form id="stockForm" class="form-grid">
                    <label>Product<select id="stockProduct" required>${options}</select></label>
                    <label>Quantity to ${type === "in" ? "Add" : "Release"}<input id="stockQuantity" type="number" min="1" step="1" required></label>
                    <label class="wide">Reason / Reference<input id="stockReason" placeholder="${type === "in" ? "e.g. Supplier delivery / purchase received" : "e.g. Damaged stock / manual release"}" required></label>
                    <button class="primary wide">Confirm ${type === "in" ? "Stock In" : "Stock Out"}</button>
                  </form>`;
                $("modal").classList.remove("hidden");
                $("stockForm").addEventListener("submit", async (event) => {
                    event.preventDefault();
                    try {
                        const quantity = validatePositiveWholeNumber($("stockQuantity").value);
                        const reason = validateText(
                            $("stockReason").value,
                            "Reason / Reference",
                            200,
                            true
                        );
                        if (reason.length < 2)
                            validationError("Reason / Reference must be at least 2 characters.");

                        await busy(
                            event.submitter,
                            () =>
                                api(`/api/inventory/stock-${type}`, {
                                    method: "POST",
                                    body: JSON.stringify({
                                        productID: $("stockProduct").value,
                                        quantity,
                                        reason
                                    })
                                }),
                            "Updating Stock…"
                        );
                        closeModal();
                        await Promise.all([loadInventory(), loadTransactions(), loadDashboard()]);
                        toast(
                            type === "in"
                                ? "Stock added successfully"
                                : "Stock released successfully"
                        );
                    } catch (error) {
                        toast(error.message);
                    }
                });
            } catch (error) {
                toast(error.message);
            }
        }

        $("stockInBtn").addEventListener("click", () => stock("in"));
        $("stockOutBtn").addEventListener("click", () => stock("out"));

        // Loads and filters stock movement history
        // Loads stock movement records from the backend
        async function loadTransactions() {
            try {
                const [transactionData] = await Promise.all([
                    api("/api/inventory/transactions"),
                    ensureFormData({ needCustomers: false })
                ]);
                setTransactions(transactionData.transactions || []);
                renderTransactions();
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters and displays stock movement records
        function renderTransactions() {
            const search = $("transactionSearch").value.trim().toLowerCase();
            const type = $("transactionType").value;
            const productID = $("transactionProduct").value;
            const start = $("transactionFrom").value;
            const end = $("transactionTo").value;
            const rows = getTransactions().filter(
                (item) =>
                    (!search ||
                        `${item.productID} ${item.productName} ${item.reason} ${item.performedBy} ${movementTypeLabel(item.type)}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!type || item.type === type) &&
                    (!productID || item.productID === productID) &&
                    within(item.createdAt, start, end)
            );
            $("transactionTable").innerHTML = rows.length
                ? rows
                      .map((item) => {
                          const increase = ["STOCK_IN", "INITIAL_STOCK"].includes(item.type);
                          return `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(movementTypeLabel(item.type))}</td><td><strong>${esc(item.productName)}</strong><br><small>Product ID: ${esc(item.productID)}</small></td><td><strong>${increase ? "+" : "−"}${Number(item.quantity)}</strong></td><td>${Number(item.previousQuantity)}</td><td>${Number(item.newQuantity)}</td><td>${esc(item.reason || "—")}</td><td>${esc(item.performedBy || "System")}</td></tr>`;
                      })
                      .join("")
                : '<tr><td colspan="8"><div class="table-empty">No stock movements match the current filters.</div></td></tr>';
        }

        [
            "transactionSearch",
            "transactionType",
            "transactionProduct",
            "transactionFrom",
            "transactionTo"
        ].forEach((id) => $(id).addEventListener("input", renderTransactions));
        $("refreshTransactions").addEventListener("click", loadTransactions);
        $("clearTransactionFilters").addEventListener("click", () => {
            [
                "transactionSearch",
                "transactionType",
                "transactionProduct",
                "transactionFrom",
                "transactionTo"
            ].forEach((id) => ($(id).value = ""));
            renderTransactions();
        });

        return Object.freeze({
            loadInventory,
            renderProducts,
            loadTransactions,
            renderTransactions
        });
    }

    global.XTechInventoryUi = Object.freeze({ createInventoryUi });
})(typeof window !== "undefined" ? window : globalThis);
