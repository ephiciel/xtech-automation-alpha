"use strict";
// Stage 4.41: regression coverage for navigation, role visibility, themes and shared modals.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const shellCode = read("frontend/js/app-shell-ui.js");
const appCode = read("frontend/js/app.js");
const html = read("frontend/index.html");
const names = [
    "dashboard",
    "inventory",
    "transactions",
    "customers",
    "pickups",
    "notifications",
    "sales",
    "users",
    "reports",
    "profile",
    "security"
];

function mockClassList() {
    const values = new Set();
    return {
        add(name) {
            values.add(name);
        },
        remove(name) {
            values.delete(name);
        },
        contains(name) {
            return values.has(name);
        },
        toggle(name, value) {
            const enabled = value === undefined ? !values.has(name) : Boolean(value);
            if (enabled) values.add(name);
            else values.delete(name);
            return enabled;
        }
    };
}
function element(id = "") {
    const callbacks = {};
    return {
        id,
        callbacks,
        classList: mockClassList(),
        style: { display: "" },
        dataset: {},
        textContent: "",
        value: "",
        attributes: {},
        setAttribute(name, value) {
            this.attributes[name] = value;
        },
        addEventListener(name, callback) {
            callbacks[name] = callback;
        },
        querySelector() {
            return null;
        }
    };
}
function fixture({
    role = "admin",
    token = "token",
    charts = false,
    storedTheme = null,
    prefersDark = false,
    brokenStorage = false
} = {}) {
    const elements = new Map();
    const byId = (id) => {
        if (!elements.has(id)) elements.set(id, element(id));
        return elements.get(id);
    };
    const navs = names.map((name) => Object.assign(element(), { dataset: { section: name } }));
    const sections = names.map((name) => element(name));
    const adminOnly = [element(), element()];
    const customerOnly = [element(), element()];
    const themeToggle = element("themeToggle");
    const themeLabel = element("label");
    const themeIcon = element("icon");
    themeToggle.querySelector = (selector) =>
        ({ ".theme-label": themeLabel, ".theme-icon": themeIcon })[selector] || null;
    const themeMeta = element("theme-meta");
    const body = Object.assign(element("body"), { offsetHeight: 42 });
    const documentCallbacks = {};
    const windowCallbacks = {};
    const animationFrames = [];
    const events = [];
    const profile = { role };
    let activeToken = token;
    let hasCharts = charts;
    let section = "dashboard";
    let themeInStorage = storedTheme;
    const localStorage = {
        getItem(name) {
            assert.equal(name, "xtech-theme");
            if (brokenStorage) throw Error("Storage blocked");
            return themeInStorage;
        },
        setItem(name, value) {
            assert.equal(name, "xtech-theme");
            if (brokenStorage) throw Error("Storage blocked");
            themeInStorage = value;
        }
    };
    const document = {
        body,
        addEventListener(name, callback) {
            documentCallbacks[name] = callback;
        },
        querySelector(selector) {
            const sectionMatch = selector.match(/^\.nav\[data-section="([^"]+)"\]$/);
            if (sectionMatch)
                return navs.find((item) => item.dataset.section === sectionMatch[1]) || null;
            if (selector === 'meta[name="theme-color"]') return themeMeta;
            return null;
        },
        querySelectorAll(selector) {
            return (
                {
                    ".section": sections,
                    ".nav": navs,
                    ".theme-toggle": [themeToggle],
                    ".admin-only, .admin-only-section": adminOnly,
                    ".customer-only, .customer-only-section": customerOnly
                }[selector] || []
            );
        }
    };
    const window = {
        addEventListener(name, callback) {
            windowCallbacks[name] = callback;
        },
        matchMedia: () => ({ matches: prefersDark })
    };
    const context = { window };
    vm.runInNewContext(shellCode, context, { filename: "app-shell-ui.js" });
    const deps = {
        $: byId,
        document,
        window,
        localStorage,
        requestAnimationFrame: (callback) => animationFrames.push(callback),
        getProfile: () => profile,
        getToken: () => activeToken,
        setCurrentSectionName: (value) => {
            section = value;
            events.push("section:" + value);
        },
        updateAiContextLabel: () => events.push("ai-context"),
        renderAiQuickActions: () => events.push("ai-actions"),
        hasDashboardCharts: () => hasCharts
    };
    for (const name of names) {
        const method = "load" + name[0].toUpperCase() + name.slice(1);
        // The live module uses singular method names derived from each page.
        deps[method] = () => events.push(name);
    }
    const ui = window.XTechAppShellUi.createAppShellUi(deps);
    return {
        ui,
        window,
        document,
        documentCallbacks,
        windowCallbacks,
        byId,
        body,
        navs,
        sections,
        adminOnly,
        customerOnly,
        themeToggle,
        themeIcon,
        themeLabel,
        themeMeta,
        animationFrames,
        events,
        profile,
        getSection: () => section,
        getStoredTheme: () => themeInStorage,
        setToken: (value) => {
            activeToken = value;
        },
        setCharts: (value) => {
            hasCharts = value;
        }
    };
}

test("app shell registers immutable factory and immutable interface", () => {
    const f = fixture();
    assert.equal(Object.isFrozen(f.window.XTechAppShellUi), true);
    assert.equal(Object.isFrozen(f.ui), true);
    for (const name of ["showSection", "applyRole", "applyTheme", "initTheme", "closeModal"])
        assert.equal(typeof f.ui[name], "function");
});
test("HTML loads shell after AI but before application", () => {
    const scripts = ["js/ai-assistant-ui.js", "js/app-shell-ui.js", "js/app.js"].map((p) =>
        html.indexOf(`<script src="${p}"></script>`)
    );
    assert.ok(scripts.every((pos, i) => pos >= 0 && (i === 0 || pos > scripts[i - 1])));
});
test("app retains session and API ownership and delegates shell methods", () => {
    assert.match(appCode, /const appShellUi = window\.XTechAppShellUi\.createAppShellUi/);
    assert.match(
        appCode,
        /function showSection\(name\)\s*\{\s*return appShellUi\.showSection\(name\);\s*\}/
    );
    assert.match(appCode, /function applyRole\(\)\s*\{\s*return appShellUi\.applyRole\(\);\s*\}/);
    assert.match(appCode, /function closeModal\(\)\s*\{\s*return appShellUi\.closeModal\(\);\s*\}/);
    assert.match(appCode, /async function finishSignedInUser/);
    assert.match(appCode, /function showSignedOutState/);
    assert.match(appCode, /async function boot/);
});
test("shows selected section, updates navigation and AI context before loading", () => {
    const f = fixture();
    f.ui.showSection("inventory");
    assert.equal(f.getSection(), "inventory");
    assert.equal(f.sections.find((s) => s.id === "inventory").classList.contains("active"), true);
    assert.equal(f.sections.find((s) => s.id === "dashboard").classList.contains("active"), false);
    assert.equal(
        f.navs.find((s) => s.dataset.section === "inventory").classList.contains("active"),
        true
    );
    assert.deepEqual(f.events.slice(-4), [
        "section:inventory",
        "ai-context",
        "ai-actions",
        "inventory"
    ]);
});
test("every supported page retains its previous section load callback", () => {
    const f = fixture();
    for (const name of names) {
        f.events.length = 0;
        f.ui.showSection(name);
        assert.equal(f.events.at(-1), name, name);
    }
});
test("notification navigation requests history without exposing staff endpoints", () => {
    const f = fixture({ role: "customer" });
    f.ui.showSection("notifications");
    assert.equal(f.events.at(-1), "notifications");
});
test("navigation ignores controls hidden by role enforcement", () => {
    const f = fixture({ role: "warehouse" });
    f.ui.applyRole();
    const users = f.navs.find((n) => n.dataset.section === "users");
    assert.equal(users.style.display, "none");
    f.ui.showSection("users");
    assert.equal(f.getSection(), "dashboard");
    assert.equal(f.events.length, 0);
});
test("registered navigation click invokes the same showSection routing", () => {
    const f = fixture();
    const nav = f.navs.find((n) => n.dataset.section === "sales");
    nav.callbacks.click();
    assert.equal(f.getSection(), "sales");
    assert.equal(f.events.at(-1), "sales");
});
test("admin sees staff, reports, inventory and security, not customer profile page", () => {
    const f = fixture({ role: "admin" });
    f.ui.applyRole();
    for (const name of ["users", "reports", "inventory", "security"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "");
    assert.equal(f.navs.find((n) => n.dataset.section === "profile").style.display, "none");
    assert.equal(f.adminOnly[0].style.display, "");
    assert.equal(f.customerOnly[0].style.display, "none");
    assert.equal(f.byId("notificationCenter").classList.contains("hidden"), true);
});
test("legacy owner role normalizes to admin without altering the permissions", () => {
    const f = fixture({ role: "owner" });
    f.ui.applyRole();
    assert.equal(f.profile.role, "admin");
    assert.equal(f.navs.find((n) => n.dataset.section === "users").style.display, "");
});
test("secretary cannot view inventory management, staff accounts or reports", () => {
    const f = fixture({ role: "secretary" });
    f.ui.applyRole();
    for (const name of ["inventory", "users", "reports", "notifications"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "none");
    for (const name of ["dashboard", "transactions", "customers", "pickups", "sales", "security"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "");
});
test("warehouse can access stock activity but not customers, sales or reports", () => {
    const f = fixture({ role: "warehouse" });
    f.ui.applyRole();
    for (const name of ["dashboard", "inventory", "transactions", "security"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "");
    for (const name of ["customers", "sales", "reports", "users", "profile"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "none");
});
test("customer sees only pickups, notifications, profile and security", () => {
    const f = fixture({ role: "customer" });
    f.ui.applyRole();
    for (const name of ["pickups", "notifications", "profile", "security"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "");
    for (const name of ["dashboard", "users", "reports", "inventory"])
        assert.equal(f.navs.find((n) => n.dataset.section === name).style.display, "none");
    assert.equal(f.customerOnly[0].style.display, "");
    assert.equal(f.adminOnly[0].style.display, "none");
    assert.equal(f.byId("notificationCenter").classList.contains("hidden"), false);
    assert.equal(f.byId("pickupCustomerField").style.display, "none");
    assert.match(f.byId("pickupCustomerHelp").textContent, /automatically be linked/);
});
test("staff pickup form retains customer selector and help text", () => {
    const f = fixture({ role: "admin" });
    f.ui.applyRole();
    assert.equal(f.byId("pickupCustomerField").style.display, "");
    assert.match(f.byId("pickupCustomerHelp").textContent, /registered customer/);
});
test("unrecognized role remains least-privilege for page navigation", () => {
    const f = fixture({ role: "unknown" });
    f.ui.applyRole();
    assert.ok(f.navs.every((nav) => nav.style.display === "none"));
});
test("theme is initialized by DOMContentLoaded and persisted theme wins over OS", () => {
    const f = fixture({ storedTheme: "dark", prefersDark: false });
    f.windowCallbacks.DOMContentLoaded();
    assert.equal(f.body.classList.contains("dark"), true);
    assert.equal(f.themeMeta.attributes.content, "#080d18");
    assert.equal(f.themeLabel.textContent, "Light mode");
    assert.equal(f.themeIcon.textContent, "☀");
    assert.equal(f.getStoredTheme(), "dark");
});
test("OS dark preference is respected when no stored theme exists", () => {
    const f = fixture({ prefersDark: true });
    f.ui.initTheme();
    assert.equal(f.body.classList.contains("dark"), true);
    assert.equal(f.getStoredTheme(), "dark");
});
test("theme falls back safely when localStorage is inaccessible", () => {
    const f = fixture({ prefersDark: false, brokenStorage: true });
    assert.doesNotThrow(() => f.ui.initTheme());
    assert.equal(f.body.classList.contains("dark"), false);
});
test("theme toggle updates appearance, accessibility text and storage", () => {
    const f = fixture({ storedTheme: "light" });
    f.ui.initTheme();
    f.themeToggle.callbacks.click();
    assert.equal(f.body.classList.contains("dark"), true);
    assert.equal(f.getStoredTheme(), "dark");
    assert.equal(f.themeToggle.attributes["aria-label"], "Switch to light mode");
    f.themeToggle.callbacks.click();
    assert.equal(f.body.classList.contains("dark"), false);
    assert.equal(f.getStoredTheme(), "light");
});
test("theme switches temporarily suppress transitions and then restore them", () => {
    const f = fixture();
    f.ui.applyTheme("dark");
    assert.equal(f.body.classList.contains("theme-switching"), true);
    assert.equal(f.animationFrames.length, 1);
    f.animationFrames.shift()();
    assert.equal(f.body.classList.contains("theme-switching"), false);
});
test("theme refreshes dashboard charts only for authenticated users with charts", () => {
    const f = fixture({ charts: true, token: "signed-in" });
    f.ui.applyTheme("dark");
    assert.equal(f.events.filter((x) => x === "dashboard").length, 1);
    f.setToken("");
    f.ui.applyTheme("light");
    assert.equal(f.events.filter((x) => x === "dashboard").length, 1);
    f.setToken("signed-in");
    f.setCharts(false);
    f.ui.applyTheme("dark");
    assert.equal(f.events.filter((x) => x === "dashboard").length, 1);
});
test("close modal button removes the hidden state", () => {
    const f = fixture();
    const modal = f.byId("modal");
    f.byId("modalClose").callbacks.click();
    assert.equal(modal.classList.contains("hidden"), true);
});
test("clicking the modal backdrop closes, but clicking inner content does not", () => {
    const f = fixture();
    const modal = f.byId("modal");
    modal.callbacks.click({ target: element("content") });
    assert.equal(modal.classList.contains("hidden"), false);
    modal.callbacks.click({ target: modal });
    assert.equal(modal.classList.contains("hidden"), true);
});
test("Escape closes the shared modal while other keys do not", () => {
    const f = fixture();
    const modal = f.byId("modal");
    f.documentCallbacks.keydown({ key: "Enter" });
    assert.equal(modal.classList.contains("hidden"), false);
    f.documentCallbacks.keydown({ key: "Escape" });
    assert.equal(modal.classList.contains("hidden"), true);
});
