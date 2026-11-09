"use strict";
// Stage 4.36: browser-only UI module, initialized from app.js.
(function installUiModule(global) {
    function createCustomerUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            esc,
            badge,
            validateName,
            validateEmail,
            validatePhone,
            validateText,
            closeModal,
            loadDashboard,
            updateCustomerSelectors,
            itemSummary,
            fmtDateTime,
            fmtDate,
            getCustomers,
            setCustomers,
            confirm,
            document,
            window
        } = deps;

        // Handles customer records and customer history
        // Loads customer records from the backend
        async function loadCustomers() {
            try {
                const data = await api("/api/customers");
                setCustomers(data.customers || []);
                renderCustomers();
                updateCustomerSelectors();
            } catch (error) {
                toast(error.message);
            }
        }

        // Closes the customer action dropdown
        function closeCustomerActionMenu() {
            document.querySelector(".customer-action-menu")?.remove();
        }

        // Opens the customer action dropdown beside the menu button or mouse pointer
        function openCustomerActionMenu(customerID, anchor = null, point = null) {
            closeCustomerActionMenu();

            const customer = getCustomers().find((item) => item.id === customerID);
            if (!customer) return;

            const active = customer.active !== false;
            const menu = document.createElement("div");
            menu.className = "customer-action-menu";
            menu.setAttribute("role", "menu");

            menu.innerHTML = `
                <button type="button" data-action="edit" role="menuitem">Edit customer</button>
                <button type="button" data-action="history" role="menuitem">View history</button>
                <button type="button" class="${active ? "customer-menu-danger" : "customer-menu-activate"}" data-action="status" role="menuitem">
                    ${active ? "Deactivate" : "Activate"}
                </button>
            `;

            document.body.appendChild(menu);

            let left = point?.x ?? 0;
            let top = point?.y ?? 0;

            if (anchor) {
                const rect = anchor.getBoundingClientRect();
                left = rect.right - menu.offsetWidth;
                top = rect.bottom + 6;
            }

            const padding = 8;
            const maxLeft = window.innerWidth - menu.offsetWidth - padding;
            const maxTop = window.innerHeight - menu.offsetHeight - padding;

            left = Math.max(padding, Math.min(left, maxLeft));
            top = Math.max(padding, Math.min(top, maxTop));

            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;

            menu.addEventListener("click", (event) => {
                const button = event.target.closest("button[data-action]");
                if (!button) return;

                const action = button.dataset.action;
                closeCustomerActionMenu();

                if (action === "edit") window.editCustomer(customerID);
                if (action === "history") window.customerHistory(customerID);
                if (action === "status") window.setCustomerStatus(customerID, !active);
            });
        }

        // Filters and displays customer records
        function renderCustomers() {
            closeCustomerActionMenu();

            const search = $("customerSearch").value.trim().toLowerCase();
            const status = $("customerStatusFilter").value;
            const rows = getCustomers().filter((customer) => {
                const active = customer.active !== false;
                return (
                    (!search ||
                        `${customer.name} ${customer.email} ${customer.phone} ${customer.company}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!status || (status === "active" ? active : !active))
                );
            });

            $("customerTable").innerHTML = rows.length
                ? rows
                      .map((customer) => {
                          const active = customer.active !== false;

                          return `<tr class="customer-row" data-customer-id="${esc(customer.id)}">
                  <td><strong>${esc(customer.name)}</strong></td>
                  <td>${esc(customer.email)}</td>
                  <td>${esc(customer.phone || "—")}</td>
                  <td>${esc(customer.company || "—")}</td>
                  <td>${badge(active ? "Active" : "Inactive")}</td>
                  <td>${customer.userUID ? badge("Linked") : "No login account"}</td>
                  <td class="customer-action-cell">
                    <button
                      type="button"
                      class="customer-menu-btn"
                      data-customer-menu="${esc(customer.id)}"
                      aria-label="Open actions for ${esc(customer.name)}"
                      title="Customer actions"
                    >⋮</button>
                  </td>
                </tr>`;
                      })
                      .join("")
                : '<tr><td colspan="7"><div class="table-empty">No customers match the current filters.</div></td></tr>';

            // Opens the menu when the three-dot button is clicked
            document.querySelectorAll(".customer-menu-btn").forEach((button) => {
                button.addEventListener("click", (event) => {
                    event.stopPropagation();
                    openCustomerActionMenu(button.dataset.customerMenu, button);
                });
            });

            // Opens the same menu when a customer row is right-clicked
            document.querySelectorAll(".customer-row").forEach((row) => {
                row.addEventListener("contextmenu", (event) => {
                    if (event.target.closest("button, input, select, textarea, a")) return;
                    event.preventDefault();
                    openCustomerActionMenu(row.dataset.customerId, null, {
                        x: event.clientX,
                        y: event.clientY
                    });
                });
            });
        }

        ["customerSearch", "customerStatusFilter"].forEach((id) =>
            $(id).addEventListener("input", renderCustomers)
        );

        // Closes the customer action menu when clicking somewhere else
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".customer-action-menu, .customer-menu-btn"))
                closeCustomerActionMenu();
        });

        // Closes the customer action menu if the page moves
        window.addEventListener("resize", closeCustomerActionMenu);
        window.addEventListener("scroll", closeCustomerActionMenu, true);

        // Closes the customer action menu with the Escape key
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeCustomerActionMenu();
        });

        $("customerForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("customerMessage", "");
            try {
                const name = validateName($("customerName").value, "Customer name");
                const email = validateEmail($("customerEmail").value);
                const phone = validatePhone($("customerPhone").value);
                const company = validateText(
                    $("customerCompany").value,
                    "Company / Organization",
                    120
                );
                const address = validateText($("customerAddress").value, "Address", 250);

                await busy(
                    event.submitter,
                    () =>
                        api("/api/customers", {
                            method: "POST",
                            body: JSON.stringify({ name, email, phone, company, address })
                        }),
                    "Registering…"
                );
                event.target.reset();
                setMessage("customerMessage", "Customer registered successfully.", "success");
                await Promise.all([loadCustomers(), loadDashboard()]);
                toast("Customer registered");
            } catch (error) {
                setMessage("customerMessage", error.message);
            }
        });

        // Opens the form used to edit a customer
        window.editCustomer = (id) => {
            const customer = getCustomers().find((item) => item.id === id);
            if (!customer) return;
            $("modalBody").innerHTML =
                `<h2>Edit Customer</h2><form id="editCustomerForm" class="form-grid">
              <label>Customer Name<input id="editCustomerName" value="${esc(customer.name)}" maxlength="80" required></label>
              <label>Email Address<input id="editCustomerEmail" type="email" value="${esc(customer.email)}" maxlength="254" required></label>
              <label>Phone Number<input id="editCustomerPhone" type="tel" value="${esc(customer.phone || "")}" maxlength="18" inputmode="tel" placeholder="09171234567 or +639171234567"></label>
              <label>Company / Organization<input id="editCustomerCompany" value="${esc(customer.company || "")}" maxlength="120"></label>
              <label class="wide">Address<input id="editCustomerAddress" value="${esc(customer.address || "")}" maxlength="250"></label>
              <button class="primary wide">Save Customer Changes</button>
            </form>`;
            $("modal").classList.remove("hidden");
            $("editCustomerForm").addEventListener("submit", async (event) => {
                event.preventDefault();
                try {
                    const name = validateName($("editCustomerName").value, "Customer name");
                    const email = validateEmail($("editCustomerEmail").value);
                    const phone = validatePhone($("editCustomerPhone").value);
                    const company = validateText(
                        $("editCustomerCompany").value,
                        "Company / Organization",
                        120
                    );
                    const address = validateText($("editCustomerAddress").value, "Address", 250);

                    await busy(
                        event.submitter,
                        () =>
                            api(`/api/customers/${encodeURIComponent(id)}`, {
                                method: "PUT",
                                body: JSON.stringify({ name, email, phone, company, address })
                            }),
                        "Saving…"
                    );
                    closeModal();
                    await loadCustomers();
                    toast("Customer updated successfully");
                } catch (error) {
                    toast(error.message);
                }
            });
        };

        // Activates or deactivates a customer record
        window.setCustomerStatus = async (id, active) => {
            const customer = getCustomers().find((item) => item.id === id);
            const verb = active ? "activate" : "deactivate";
            if (
                !confirm(
                    `${verb[0].toUpperCase() + verb.slice(1)} ${customer?.name || "this customer"}?${!active && customer?.userUID ? " Their login account will also be disabled." : ""}`
                )
            )
                return;
            try {
                await api(`/api/customers/${encodeURIComponent(id)}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ active })
                });
                await Promise.all([loadCustomers(), loadDashboard()]);
                toast(`Customer ${active ? "activated" : "deactivated"}`);
            } catch (error) {
                toast(error.message);
            }
        };

        // Shows the selected customer's pickup and sales history
        window.customerHistory = async (id) => {
            try {
                const data = await api(`/api/customers/${encodeURIComponent(id)}/history`);
                const pickupRows = data.pickups.length
                    ? data.pickups
                          .map(
                              (item) =>
                                  `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(item.pickupID)}</td><td>${fmtDate(item.requestedDate)}</td><td>${badge(item.status)}</td><td>${itemSummary(item.items)}</td></tr>`
                          )
                          .join("")
                    : '<tr><td colspan="5">No pickup history.</td></tr>';
                const saleRows = data.sales.length
                    ? data.sales
                          .map(
                              (item) =>
                                  `<tr><td>${fmtDateTime(item.createdAt)}</td><td>${esc(item.saleID)}</td><td>${badge(item.status)}</td><td>${itemSummary(item.items)}</td></tr>`
                          )
                          .join("")
                    : '<tr><td colspan="4">No sales history.</td></tr>';
                $("modalBody").innerHTML =
                    `<h2>${esc(data.customer.name)} — Customer History</h2><div class="detail-grid"><div><span>Email</span><strong>${esc(data.customer.email)}</strong></div><div><span>Phone</span><strong>${esc(data.customer.phone || "—")}</strong></div><div><span>Company</span><strong>${esc(data.customer.company || "—")}</strong></div><div><span>Status</span><strong>${data.customer.active !== false ? "Active" : "Inactive"}</strong></div></div>
                  <h3>Pickup History (${data.pickups.length})</h3><div class="table-wrap"><table><thead><tr><th>Created</th><th>Pickup Reference</th><th>Pickup Date</th><th>Status</th><th>Products</th></tr></thead><tbody>${pickupRows}</tbody></table></div>
                  <h3>Sales History (${data.sales.length})</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Sale Reference</th><th>Status</th><th>Products</th></tr></thead><tbody>${saleRows}</tbody></table></div>`;
                $("modal").classList.remove("hidden");
            } catch (error) {
                toast(error.message);
            }
        };

        return Object.freeze({ loadCustomers, renderCustomers });
    }
    global.XTechCustomerUi = Object.freeze({ createCustomerUi });
})(typeof window !== "undefined" ? window : globalThis);
