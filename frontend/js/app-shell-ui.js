"use strict";
// Stage 4.41: page navigation, role visibility, themes and the shared modal.
(function registerAppShell(global) {
    function createAppShellUi(deps) {
        const {
            $,
            document,
            window,
            localStorage,
            requestAnimationFrame,
            getProfile,
            getToken,
            setCurrentSectionName,
            updateAiContextLabel,
            renderAiQuickActions,
            hasDashboardCharts,
            loadDashboard,
            loadInventory,
            loadTransactions,
            loadCustomers,
            loadPickups,
            loadNotifications,
            loadSales,
            loadUsers,
            loadReports,
            loadProfile,
            loadSecurity
        } = deps;

        // Changes the visible page section and loads its data
        function showSection(name) {
            const nav = document.querySelector(`.nav[data-section="${name}"]`);
            if (nav && nav.style.display === "none") return;
            document
                .querySelectorAll(".section")
                .forEach((section) => section.classList.toggle("active", section.id === name));
            document
                .querySelectorAll(".nav")
                .forEach((item) => item.classList.toggle("active", item.dataset.section === name));

            setCurrentSectionName(name);
            updateAiContextLabel();
            renderAiQuickActions();

            if (name === "dashboard") loadDashboard();
            if (name === "inventory") loadInventory();
            if (name === "transactions") loadTransactions();
            if (name === "customers") loadCustomers();
            if (name === "pickups") loadPickups();
            if (name === "notifications") loadNotifications({ silent: true });
            if (name === "sales") loadSales();
            if (name === "users") loadUsers();
            if (name === "reports") loadReports();
            if (name === "profile") loadProfile();
            if (name === "security") loadSecurity();
        }

        // Shows only the pages and controls allowed for the current role
        function applyRole() {
            const profile = getProfile();
            const role = profile?.role === "owner" ? "admin" : profile?.role || "customer";
            profile.role = role;
            const allowedSections = {
                admin: [
                    "dashboard",
                    "inventory",
                    "transactions",
                    "customers",
                    "pickups",
                    "sales",
                    "users",
                    "reports",
                    "security"
                ],
                secretary: [
                    "dashboard",
                    "transactions",
                    "customers",
                    "pickups",
                    "sales",
                    "security"
                ],
                warehouse: ["dashboard", "inventory", "transactions", "security"],
                customer: ["pickups", "notifications", "profile", "security"]
            };
            const allowed = new Set(allowedSections[role] || []);
            document
                .querySelectorAll(".nav")
                .forEach(
                    (nav) => (nav.style.display = allowed.has(nav.dataset.section) ? "" : "none")
                );
            document
                .querySelectorAll(".admin-only, .admin-only-section")
                .forEach((element) => (element.style.display = role === "admin" ? "" : "none"));
            document
                .querySelectorAll(".customer-only, .customer-only-section")
                .forEach((element) => (element.style.display = role === "customer" ? "" : "none"));
            $("notificationCenter")?.classList.toggle("hidden", role !== "customer");

            if ($("pickupCustomerField"))
                $("pickupCustomerField").style.display = role === "customer" ? "none" : "";
            if ($("pickupCustomerHelp")) {
                $("pickupCustomerHelp").textContent =
                    role === "customer"
                        ? "This request will automatically be linked to your customer profile."
                        : "Select a registered customer when applicable. Walk-in requests can use “Walk-in / No registered customer”.";
            }
        }

        // Applies light or dark mode instantly and saves the choice
        function applyTheme(themeName = "light") {
            const darkMode = themeName === "dark";

            // Temporarily disables transitions while the theme changes
            document.body.classList.add("theme-switching");

            document.body.classList.toggle("dark", darkMode);

            document.querySelectorAll(".theme-toggle").forEach((toggle) => {
                const label = toggle.querySelector(".theme-label");
                const icon = toggle.querySelector(".theme-icon");
                if (label) label.textContent = darkMode ? "Light mode" : "Dark mode";
                if (icon) icon.textContent = darkMode ? "☀" : "☾";
                toggle.setAttribute(
                    "aria-label",
                    darkMode ? "Switch to light mode" : "Switch to dark mode"
                );
            });

            const themeMeta = document.querySelector('meta[name="theme-color"]');
            if (themeMeta) themeMeta.setAttribute("content", darkMode ? "#080d18" : "#f5f7fb");

            try {
                localStorage.setItem("xtech-theme", darkMode ? "dark" : "light");
            } catch {
                // Ignores storage errors if the browser blocks local storage.
            }

            // Forces the new theme to render before transitions are enabled again
            void document.body.offsetHeight;

            requestAnimationFrame(() => {
                document.body.classList.remove("theme-switching");
            });

            // Redraws the charts after the theme changes
            if (getToken() && hasDashboardCharts()) loadDashboard();
        }

        // Loads the saved theme and connects the theme buttons
        function initTheme() {
            document.querySelectorAll(".theme-toggle").forEach((toggle) => {
                toggle.addEventListener("click", () => {
                    const darkMode = !document.body.classList.contains("dark");
                    applyTheme(darkMode ? "dark" : "light");
                });
            });

            try {
                const storedTheme = localStorage.getItem("xtech-theme");
                if (storedTheme === "dark" || storedTheme === "light") {
                    applyTheme(storedTheme);
                    return;
                }
            } catch {
                // Ignores storage errors if the browser blocks local storage.
            }

            const prefersDark =
                window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
            applyTheme(prefersDark ? "dark" : "light");
        }

        // Opens and closes popup windows
        // Hides the open popup window
        function closeModal() {
            $("modal").classList.add("hidden");
        }
        $("modalClose").addEventListener("click", closeModal);
        $("modal").addEventListener("click", (event) => {
            if (event.target === $("modal")) closeModal();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeModal();
        });

        // Register once. Other feature modules remain responsible for their own handlers.
        window.addEventListener("DOMContentLoaded", initTheme);
        document
            .querySelectorAll(".nav")
            .forEach((nav) =>
                nav.addEventListener("click", () => showSection(nav.dataset.section))
            );

        return Object.freeze({ showSection, applyRole, applyTheme, initTheme, closeModal });
    }
    global.XTechAppShellUi = Object.freeze({ createAppShellUi });
})(window);
