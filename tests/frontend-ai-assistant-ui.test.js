"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const source = read("frontend/js/ai-assistant-ui.js");
const app = read("frontend/js/app.js");
const html = read("frontend/index.html");

function harness({
    uid = "u1",
    section = "dashboard",
    overrides = {},
    clipboardEnabled = true
} = {}) {
    const elements = new Map(),
        calls = [],
        toasts = [],
        copies = [],
        errors = [],
        timers = [];
    let currentUid = uid,
        currentSection = section,
        confirm = true;
    function classList() {
        const names = new Set(["hidden"]);
        return {
            add: (n) => names.add(n),
            remove: (n) => names.delete(n),
            contains: (n) => names.has(n),
            toggle(n, v) {
                const b = v === undefined ? !names.has(n) : Boolean(v);
                if (b) names.add(n);
                else names.delete(n);
                return b;
            }
        };
    }
    function createElement(tag = "div") {
        const handlers = {};
        let markup = "";
        return {
            tagName: tag.toUpperCase(),
            handlers,
            children: [],
            style: {},
            dataset: {},
            isConnected: true,
            className: "",
            textContent: "",
            value: "",
            type: "",
            disabled: false,
            scrollTop: 0,
            scrollHeight: 55,
            classList: classList(),
            get innerHTML() {
                return markup;
            },
            set innerHTML(s) {
                markup = String(s);
                this.children = [];
            },
            appendChild(child) {
                child.isConnected = true;
                child.parent = this;
                this.children.push(child);
                if (child.id) elements.set(child.id, child);
                return child;
            },
            addEventListener(name, cb) {
                handlers[name] = cb;
            },
            querySelectorAll() {
                return [];
            },
            setAttribute(k, v) {
                this[k] = v;
            },
            remove() {
                this.isConnected = false;
                if (this.parent) {
                    const index = this.parent.children.indexOf(this);
                    if (index >= 0) this.parent.children.splice(index, 1);
                }
                if (this.id) elements.delete(this.id);
            },
            focus() {
                this.focused = true;
            },
            select() {
                this.selected = true;
            },
            requestSubmit() {
                this.submitted = true;
            },
            async emit(type, opts = {}) {
                if (!handlers[type]) throw Error(`no ${type} on ${tag}`);
                return handlers[type]({
                    preventDefault() {},
                    stopPropagation() {},
                    key: "",
                    shiftKey: false,
                    ...opts
                });
            }
        };
    }
    const $ = (id) => {
        if (id === "aiTypingIndicator" && !elements.has(id)) return null;
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
    };
    const docHandlers = {};
    const document = {
        createElement,
        body: createElement("body"),
        querySelectorAll(q) {
            if (q === ".ai-suggestion-chip") return $("aiQuickActions").children;
            return [];
        },
        addEventListener(type, cb) {
            docHandlers[type] = cb;
        },
        execCommand(cmd) {
            copies.push(`fallback:${cmd}`);
            return true;
        }
    };
    const window = { confirm: () => confirm };
    const navigator = clipboardEnabled
        ? {
              clipboard: {
                  writeText: async (txt) => {
                      copies.push(txt);
                  }
              }
          }
        : {};
    const ctx = {
        window,
        document,
        navigator,
        setTimeout: (fn, ms) => {
            timers.push({ fn, ms });
            return 1;
        },
        console: { error: (...args) => errors.push(args) }
    };
    vm.runInNewContext(source, ctx, { filename: "ai-assistant-ui.js" });
    const factory = window.XTechAiAssistantUi.createAiAssistantUi;
    const ui = factory({
        $,
        document,
        window,
        navigator,
        setTimeout: ctx.setTimeout,
        console: ctx.console,
        api: async (url, options = {}) => {
            calls.push({ url, options });
            const hit = overrides[url];
            if (typeof hit === "function") return hit(url, options);
            if (hit instanceof Error) throw hit;
            if (hit !== undefined) return hit;
            if (url === "/api/chat/history") return { messages: [] };
            if (url === "/api/chat") return { reply: "Assistant reply" };
            return {};
        },
        toast: (s) => toasts.push(s),
        busy: async (_btn, fn) => fn(),
        getCurrentUser: () => (currentUid ? { uid: currentUid } : null),
        getCurrentSectionName: () => currentSection
    });
    return {
        ui,
        $,
        document,
        window,
        navigator,
        elements,
        calls,
        toasts,
        copies,
        errors,
        timers,
        docHandlers,
        setUid: (x) => (currentUid = x),
        setSection: (x) => (currentSection = x),
        setConfirm: (x) => (confirm = x),
        trigger: (id, type, opts) => $(id).emit(type, opts),
        triggerDocument: async (type, opts = {}) => docHandlers[type]({ key: "", ...opts })
    };
}

test("module creates frozen factory and isolated frozen interface", () => {
    const h = harness();
    assert.ok(Object.isFrozen(h.window.XTechAiAssistantUi));
    assert.ok(Object.isFrozen(h.ui));
    for (const method of [
        "renderAssistantMarkdown",
        "updateAiContextLabel",
        "renderAiQuickActions",
        "addChatMessage",
        "resetChatPanel",
        "loadChatHistory"
    ])
        assert.equal(typeof h.ui[method], "function");
});
test("original AI endpoint and all UI handlers remain", () => {
    assert.match(source, /\/api\/chat\/history/);
    assert.match(source, /\/api\/chat/);
    for (const id of ["aiBubble", "closeAiChat", "chatForm", "chatInput", "clearChat"])
        assert.match(source, new RegExp(id));
});
test("AI assistant loads between notification module and main application", () => {
    const indexes = ["js/notification-ui.js", "js/ai-assistant-ui.js", "js/app.js"].map((x) =>
        html.indexOf(`<script src="${x}"></script>`)
    );
    assert.ok(indexes.every((n, i) => n >= 0 && (!i || n > indexes[i - 1])));
});
test("main app preserves session ownership using fresh dependency getters", () => {
    assert.match(app, /XTechAiAssistantUi\.createAiAssistantUi/);
    assert.match(app, /getCurrentUser:\s*\(\)\s*=>\s*currentUser/);
    assert.match(app, /getCurrentSectionName:\s*\(\)\s*=>\s*currentSectionName/);
    assert.match(app, /aiAssistantUi\.resetChatPanel/);
    assert.doesNotMatch(app, /let chatHistoryLoadedForUid/);
});
test("context labels match the selected dashboard, pickup and unknown page", () => {
    const h = harness();
    h.ui.updateAiContextLabel();
    assert.match(h.$("aiContextLabel").textContent, /Dashboard/);
    h.setSection("pickups");
    h.ui.updateAiContextLabel();
    assert.match(h.$("aiContextLabel").textContent, /Pickup Services/);
    h.setSection("unavailable");
    h.ui.updateAiContextLabel();
    assert.match(h.$("aiContextLabel").textContent, /XTECH Automation/);
});
test("suggestions change when navigating between sections", () => {
    const h = harness();
    h.ui.renderAiQuickActions();
    assert.match(h.$("aiQuickActions").children[0].textContent, /dashboard/i);
    h.setSection("inventory");
    h.ui.renderAiQuickActions();
    assert.match(h.$("aiQuickActions").children[0].textContent, /product/i);
});
test("quick suggestion inserts prompt and submits original chat form", async () => {
    const h = harness();
    h.ui.renderAiQuickActions();
    await h.$("aiQuickActions").children[0].emit("click");
    assert.match(h.$("chatInput").value, /dashboard/i);
    assert.equal(h.$("chatForm").submitted, true);
});
test("Markdown escapes unsafe HTML, including script and attribute attacks", () => {
    const h = harness();
    const markup = h.ui.renderAssistantMarkdown(
        "<script>alert(1)</script> <img src=x onerror=bad>"
    );
    assert.ok(!markup.includes("<script>"));
    assert.ok(!markup.includes("<img "));
    assert.match(markup, /&lt;script&gt;/);
});
test("Markdown supports headings, ordered and unordered lists, inline formatting", () => {
    const m = harness().ui.renderAssistantMarkdown(
        "# Heading\n1. First\n2. Second\n\n- Third\n**Bold** and `code`"
    );
    assert.match(m, /<h2>Heading<\/h2>/);
    assert.match(m, /<ol>/);
    assert.match(m, /<ul>/);
    assert.match(m, /<strong>Bold<\/strong>/);
    assert.match(m, /<code>code<\/code>/);
});
test("Markdown highlights tips and separators without exposing HTML", () => {
    const m = harness().ui.renderAssistantMarkdown("Tip: **Be careful**\n---\nImportant: <unsafe>");
    assert.match(m, /class="ai-note"/);
    assert.match(m, /class="ai-divider"/);
    assert.match(m, /&lt;unsafe&gt;/);
});
test("user messages are text-only and never interpreted as HTML", () => {
    const h = harness();
    h.ui.addChatMessage("<img src=x>", "user");
    const row = h.$("chatMessages").children[0];
    assert.equal(row.children[0].children[1].textContent, "<img src=x>");
});
test("assistant messages render escaped Markdown and copy control", () => {
    const h = harness();
    h.ui.addChatMessage("**Hello** <script>", "assistant");
    const row = h.$("chatMessages").children[0];
    assert.match(row.children[1].children[1].innerHTML, /<strong>Hello<\/strong>/);
    assert.doesNotMatch(row.children[1].children[1].innerHTML, /<script>/);
    assert.equal(row.children[1].children[0].children[1].textContent, "Copy");
});
test("copy action uses clipboard only for the selected response", async () => {
    const h = harness();
    h.ui.addChatMessage("Copy this", "assistant");
    const button = h.$("chatMessages").children[0].children[1].children[0].children[1];
    await button.emit("click");
    assert.equal(h.copies[0], "Copy this");
    assert.equal(button.textContent, "Copied");
});
test("copy falls back to document command when clipboard API unavailable", async () => {
    const h = harness({ clipboardEnabled: false });
    h.ui.addChatMessage("fallback", "assistant");
    const button = h.$("chatMessages").children[0].children[1].children[0].children[1];
    await button.emit("click");
    assert.ok(h.copies.includes("fallback:copy"));
});
test("reset chat closes panel and restores greeting", () => {
    const h = harness();
    h.ui.addChatMessage("Old", "user");
    h.ui.resetChatPanel();
    assert.equal(h.$("aiChatPanel").classList.contains("hidden"), true);
    assert.equal(h.$("chatMessages").children.length, 1);
    assert.match(
        h.$("chatMessages").children[0].children[1].children[1].innerHTML,
        /XTECH Help Assistant/
    );
});
test("history load is scoped to signed-in user, preserves order and caches", async () => {
    const h = harness({
        overrides: {
            "/api/chat/history": {
                messages: [
                    { role: "user", text: "Question" },
                    { role: "assistant", text: "Reply" }
                ]
            }
        }
    });
    await h.ui.loadChatHistory();
    await h.ui.loadChatHistory();
    assert.equal(h.calls.filter((c) => c.url === "/api/chat/history").length, 1);
    assert.equal(h.$("chatMessages").children.length, 2);
    assert.equal(h.$("chatMessages").children[0].children[0].children[1].textContent, "Question");
});
test("switching users fetches the new user's chat history", async () => {
    const h = harness();
    await h.ui.loadChatHistory();
    h.setUid("u2");
    await h.ui.loadChatHistory();
    assert.equal(h.calls.filter((c) => c.url === "/api/chat/history").length, 2);
});
test("force-refresh history bypasses successful cache", async () => {
    const h = harness();
    await h.ui.loadChatHistory();
    await h.ui.loadChatHistory(true);
    assert.equal(h.calls.filter((c) => c.url === "/api/chat/history").length, 2);
});
test("signed-out visitors cannot request saved history", async () => {
    const h = harness({ uid: null });
    await h.ui.loadChatHistory();
    assert.equal(h.calls.length, 0);
});
test("history fetch failure shows a friendly message and does not throw", async () => {
    const h = harness({ overrides: { "/api/chat/history": new Error("Offline") } });
    await h.ui.loadChatHistory();
    assert.match(
        h.$("chatMessages").children.at(-1).children[1].children[1].innerHTML,
        /load your saved conversation history/
    );
    assert.equal(h.errors.length, 1);
});
test("opening assistant loads history and focuses input", async () => {
    const h = harness();
    await h.trigger("aiBubble", "click");
    assert.equal(h.$("aiChatPanel").classList.contains("hidden"), false);
    assert.equal(h.$("chatInput").focused, true);
    assert.ok(h.calls.some((c) => c.url === "/api/chat/history"));
});
test("assistant can close with button and Escape", async () => {
    const h = harness();
    await h.trigger("aiBubble", "click");
    await h.trigger("closeAiChat", "click");
    assert.equal(h.$("aiChatPanel").classList.contains("hidden"), true);
    await h.trigger("aiBubble", "click");
    await h.triggerDocument("keydown", { key: "Escape" });
    assert.equal(h.$("aiChatPanel").classList.contains("hidden"), true);
});
test("blank chat submission avoids network write", async () => {
    const h = harness();
    h.$("chatInput").value = "  ";
    await h.trigger("chatForm", "submit");
    assert.ok(!h.calls.some((c) => c.url === "/api/chat"));
});
test("chat submission uses current page context, renders both bubbles", async () => {
    const h = harness();
    h.setSection("inventory");
    h.$("chatInput").value = "How to stock in?";
    await h.trigger("chatForm", "submit");
    const req = h.calls.find((c) => c.url === "/api/chat");
    assert.equal(req.options.method, "POST");
    assert.deepEqual(JSON.parse(req.options.body), {
        message: "How to stock in?",
        section: "inventory"
    });
    assert.equal(h.$("chatMessages").children.length, 2);
    assert.equal(h.$("chatInput").value, "");
});
test("concurrent submissions are ignored while request remains pending", async () => {
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    const h = harness({ overrides: { "/api/chat": () => pending } });
    h.$("chatInput").value = "First";
    const a = h.trigger("chatForm", "submit");
    h.$("chatInput").value = "Second";
    await h.trigger("chatForm", "submit");
    resolve({ reply: "Done" });
    await a;
    assert.equal(h.calls.filter((c) => c.url === "/api/chat").length, 1);
});
test("chat API failure shows friendly fallback and releases typing state", async () => {
    const h = harness({ overrides: { "/api/chat": new Error("No quota") } });
    h.$("chatInput").value = "Hello";
    await h.trigger("chatForm", "submit");
    assert.match(h.$("chatMessages").children.at(-1).children[1].children[1].innerHTML, /No quota/);
    assert.equal(h.$("aiTypingIndicator"), null);
});
test("Enter submits chat but Shift+Enter inserts newline", async () => {
    const h = harness();
    let prevented = 0;
    await h.trigger("chatInput", "keydown", {
        key: "Enter",
        shiftKey: false,
        preventDefault() {
            prevented++;
        }
    });
    assert.equal(h.$("chatForm").submitted, true);
    assert.equal(prevented, 1);
    h.$("chatForm").submitted = false;
    await h.trigger("chatInput", "keydown", { key: "Enter", shiftKey: true });
    assert.equal(h.$("chatForm").submitted, false);
});
test("unsigned visitors cannot delete history", async () => {
    const h = harness({ uid: null });
    await h.trigger("clearChat", "click");
    assert.equal(h.calls.length, 0);
});
test("history deletion asks for confirmation and never deletes on cancel", async () => {
    const h = harness();
    h.setConfirm(false);
    await h.trigger("clearChat", "click");
    assert.ok(!h.calls.some((c) => c.options.method === "DELETE"));
});
test("confirmed history deletion preserves endpoint and clears UI", async () => {
    const h = harness();
    await h.trigger("clearChat", "click");
    const req = h.calls.find((c) => c.options.method === "DELETE");
    assert.equal(req.url, "/api/chat/history");
    assert.equal(h.$("aiChatPanel").classList.contains("hidden"), true);
    assert.ok(h.toasts.includes("Your AI chat history was cleared"));
});
test("history clear failure preserves chat and shows toast", async () => {
    const h = harness({ overrides: { "/api/chat/history": new Error("Cannot delete") } });
    await h.trigger("clearChat", "click");
    assert.ok(h.toasts.some((t) => /Cannot delete/.test(t)));
});
