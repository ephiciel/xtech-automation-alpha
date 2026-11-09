"use strict";
(function registerXTechStaffUi(global) {
    function createStaffUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            esc,
            badge,
            roleDisplayName,
            validateName,
            validateEmail,
            validatePassword,
            validationError,
            getCurrentUser,
            confirm,
            window
        } = deps;
        let users = [];
        // Handles staff accounts and account status
        // Loads staff accounts from the backend
        async function loadUsers() {
            try {
                const data = await api("/api/users");
                users = data.users || [];
                renderUsers();
            } catch (error) {
                toast(error.message);
            }
        }

        // Filters and displays staff accounts
        function renderUsers() {
            const currentUser = getCurrentUser();
            const search = $("userSearch").value.trim().toLowerCase();
            const status = $("userStatusFilter").value;
            const rows = users.filter((user) => {
                const active = user.active !== false;
                return (
                    (!search ||
                        `${user.name} ${user.email} ${roleDisplayName(user.role)}`
                            .toLowerCase()
                            .includes(search)) &&
                    (!status || (status === "active" ? active : !active))
                );
            });
            $("userTable").innerHTML = rows.length
                ? rows
                      .map((user) => {
                          const active = user.active !== false;
                          const isSelf = user.uid === currentUser?.uid;
                          return `<tr><td><strong>${esc(user.name || "—")}</strong></td><td>${esc(user.email || "—")}</td><td>${esc(roleDisplayName(user.role))}</td><td>${badge(active ? "Active" : "Inactive")}</td><td>${isSelf ? "Current account" : `<button class="small-btn ghost dark-ghost" onclick="setUserStatus('${esc(user.uid || user.id)}', ${!active})">${active ? "Deactivate" : "Activate"}</button>`}</td></tr>`;
                      })
                      .join("")
                : '<tr><td colspan="5"><div class="table-empty">No user accounts match the current filters.</div></td></tr>';
        }

        ["userSearch", "userStatusFilter"].forEach((id) =>
            $(id).addEventListener("input", renderUsers)
        );
        $("refreshUsers").addEventListener("click", loadUsers);

        $("userForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("userMessage", "");
            try {
                const name = validateName($("userName").value, "Staff name");
                const email = validateEmail($("userAccountEmail").value);
                const password = validatePassword($("userPassword").value);
                const role = $("userRole").value;
                if (!["secretary", "warehouse"].includes(role))
                    validationError("Select a valid staff role.");

                await busy(
                    event.submitter,
                    () =>
                        api("/api/users", {
                            method: "POST",
                            body: JSON.stringify({ name, email, password, role })
                        }),
                    "Creating Account…"
                );
                event.target.reset();
                setMessage("userMessage", "Staff account created successfully.", "success");
                await loadUsers();
                toast("Staff account created");
            } catch (error) {
                setMessage("userMessage", error.message);
            }
        });

        // Activates or deactivates a staff account
        window.setUserStatus = async (uid, active) => {
            if (!confirm(`${active ? "Activate" : "Deactivate"} this staff account?`)) return;
            try {
                await api(`/api/users/${encodeURIComponent(uid)}/status`, {
                    method: "PATCH",
                    body: JSON.stringify({ active })
                });
                await loadUsers();
                toast(`Account ${active ? "activated" : "deactivated"}`);
            } catch (error) {
                toast(error.message);
            }
        };

        return Object.freeze({ loadUsers, renderUsers });
    }
    global.XTechStaffUi = Object.freeze({ createStaffUi });
})(typeof window !== "undefined" ? window : globalThis);
