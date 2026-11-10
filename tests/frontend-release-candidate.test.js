"use strict";
// Stages 4.45–4.50: read-only, browser-neutral regression and release-candidate contracts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("frontend/js/app.js");
const html = read("frontend/index.html");
const pkg = JSON.parse(read("package.json"));
function factory(name, exported) {
    const sandbox = { window: {}, setTimeout, clearTimeout };
    vm.runInNewContext(read(`frontend/js/${name}`), sandbox, { filename: name });
    return sandbox.window[exported];
}
const { createUiFeedback } = factory("ui-feedback.js", "XTechUiFeedback");
const { createApiClient } = factory("api-client.js", "XTechApiClient");
const { createAppState } = factory("app-state.js", "XTechAppState");
const { createAppLifecycle } = factory("app-lifecycle.js", "XTechAppLifecycle");
function element() {
    const styles = new Set();
    return {
        textContent: "Original",
        disabled: false,
        classList: {
            add: (name) => styles.add(name),
            remove: (name) => styles.delete(name),
            toggle: (name, enabled) => (enabled ? styles.add(name) : styles.delete(name)),
            contains: (name) => styles.has(name)
        }
    };
}
function feedbackFixture() {
    const elements = { toast: element(), message: element() };
    const timers = [];
    const cancelled = [];
    const ui = createUiFeedback({
        getElement: (id) => elements[id],
        setTimeoutFn: (callback, ms) => {
            timers.push({ callback, ms });
            return timers.length;
        },
        clearTimeoutFn: (timer) => cancelled.push(timer)
    });
    return { elements, timers, cancelled, ui };
}
function response(status = 200, body = { ok: true }) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("4.45 feedback factory exports a frozen interface", () => {
    assert.equal(Object.isFrozen(createUiFeedback({ getElement: () => null })), true);
});
test("4.45 feedback requires an explicit element lookup dependency", () => {
    assert.throws(() => createUiFeedback(), /element lookup/);
});
test("4.45 toast never uses HTML injection", () => {
    const f = feedbackFixture();
    f.ui.toast('<img src=x onerror="alert(1)">');
    assert.equal(f.elements.toast.textContent, '<img src=x onerror="alert(1)">');
});
test("4.45 toast sets visible class", () => {
    const f = feedbackFixture();
    f.ui.toast("Saved");
    assert.equal(f.elements.toast.classList.contains("show"), true);
});
test("4.45 toast timeout retains original duration", () => {
    const f = feedbackFixture();
    f.ui.toast("Saved");
    assert.equal(f.timers[0].ms, 2800);
});
test("4.45 repeated toast cancels previous removal", () => {
    const f = feedbackFixture();
    f.ui.toast("one");
    f.ui.toast("two");
    assert.equal(f.cancelled.includes(1), true);
});
test("4.45 timeout hides current toast", () => {
    const f = feedbackFixture();
    f.ui.toast("Saved");
    f.timers[0].callback();
    assert.equal(f.elements.toast.classList.contains("show"), false);
});
test("4.45 toast tolerates a missing optional element", () => {
    assert.doesNotThrow(() => createUiFeedback({ getElement: () => null }).toast("hi"));
});
test("4.45 message defaults to error presentation", () => {
    const f = feedbackFixture();
    f.ui.setMessage("message", "Oops");
    assert.equal(f.elements.message.textContent, "Oops");
    assert.equal(f.elements.message.classList.contains("success"), false);
});
test("4.45 message uses success style only when requested", () => {
    const f = feedbackFixture();
    f.ui.setMessage("message", "Done", "success");
    assert.equal(f.elements.message.classList.contains("success"), true);
});
test("4.45 message clears stale success formatting", () => {
    const f = feedbackFixture();
    f.ui.setMessage("message", "Done", "success");
    f.ui.setMessage("message", "Oops");
    assert.equal(f.elements.message.classList.contains("success"), false);
});
test("4.45 null message clears the field", () => {
    const f = feedbackFixture();
    f.ui.setMessage("message", null);
    assert.equal(f.elements.message.textContent, "");
});
test("4.45 optional form message node can be absent", () => {
    const f = feedbackFixture();
    assert.doesNotThrow(() => f.ui.setMessage("missing", "text"));
});
test("4.45 busy restores text and button availability on success", async () => {
    const f = feedbackFixture();
    const button = element();
    const promise = f.ui.busy(button, async () => "result", "Saving…");
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "Saving…");
    assert.equal(await promise, "result");
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Original");
});
test("4.45 busy restores controls after failed submission", async () => {
    const f = feedbackFixture();
    const button = element();
    await assert.rejects(
        f.ui.busy(button, () => Promise.reject(new Error("fail"))),
        /fail/
    );
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Original");
});
test("4.45 busy without a button still executes its work", async () => {
    const f = feedbackFixture();
    assert.equal(await f.ui.busy(null, async () => 42), 42);
});
test("4.45 independent apps do not share toast timers", () => {
    const a = feedbackFixture();
    const b = feedbackFixture();
    a.ui.toast("a");
    b.ui.toast("b");
    assert.equal(b.cancelled.includes(1), false);
});

test("4.46 transport failures preserve original network message", async () => {
    const api = createApiClient({
        fetchFn: async () => {
            throw new Error("Network unavailable");
        }
    });
    await assert.rejects(api("/api/products"), /Network unavailable/);
});
test("4.46 transport failures receive status 0 and NETWORK_ERROR code", async () => {
    const api = createApiClient({
        fetchFn: async () => {
            throw new Error("Offline");
        }
    });
    await assert.rejects(api("/api/products"), (error) => {
        assert.equal(error.status, 0);
        assert.equal(error.code, "NETWORK_ERROR");
        return true;
    });
});
test("4.46 network failures always release the loading indicator", async () => {
    const delta = [];
    const api = createApiClient({
        onPendingChange: (n) => delta.push(n),
        fetchFn: async () => {
            throw Error("Offline");
        }
    });
    await assert.rejects(api("/api/products"));
    assert.equal(delta.join(","), "1,-1");
});
test("4.46 abort retains AbortError semantics", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const api = createApiClient({
        fetchFn: async () => {
            throw abort;
        }
    });
    await assert.rejects(api("/api/products"), (error) => {
        assert.equal(error.name, "AbortError");
        assert.equal("code" in error, false);
        return true;
    });
});
test("4.46 HTTP errors retain server error metadata instead of NETWORK_ERROR", async () => {
    const api = createApiClient({
        fetchFn: async () => response(429, { message: "Cooldown", retryAfterSeconds: 12 })
    });
    await assert.rejects(api("/api/auth/email-otp/request"), (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.retryAfterSeconds, 12);
        assert.notEqual(error.code, "NETWORK_ERROR");
        return true;
    });
});
test("4.46 HTTP error text fallback retains status code", async () => {
    const api = createApiClient({ fetchFn: async () => response(500, {}) });
    await assert.rejects(api("/api/report"), /Request failed \(500\)/);
});
test("4.46 API write failures do not trigger a retry", async () => {
    let writes = 0;
    const api = createApiClient({
        fetchFn: async () => {
            writes++;
            throw Error("Offline");
        }
    });
    await assert.rejects(api("/api/sales", { method: "POST", body: "{}" }));
    assert.equal(writes, 1);
});
test("4.46 successful HTTP calls preserve payload", async () => {
    const api = createApiClient({
        fetchFn: async () => response(200, { products: [{ productID: "A" }] })
    });
    assert.equal((await api("/api/products")).products[0].productID, "A");
});

test("4.48 shared state is visible to an API-backed workflow", async () => {
    const state = createAppState();
    const api = createApiClient({
        fetchFn: async () => response(200, { products: [{ productID: "CHEM-01", quantity: 2 }] })
    });
    const reply = await api("/api/products");
    state.setProducts(reply.products);
    assert.equal(state.getProducts()[0].quantity, 2);
});
test("4.48 overlapping API calls share nonnegative loading state", async () => {
    const state = createAppState();
    const pending = [];
    const resolve = [];
    const api = createApiClient({
        onPendingChange: (n) => {
            state.adjustPendingRequests(n);
            pending.push(state.getPendingRequests());
        },
        fetchFn: () => new Promise((r) => resolve.push(r))
    });
    const one = api("/api/products");
    const two = api("/api/customers");
    assert.equal(state.getPendingRequests(), 2);
    resolve[0](response());
    await one;
    resolve[1](response());
    await two;
    assert.equal(pending.join(","), "1,2,1,0");
});
test("4.48 lifecycle prepares one auth observer", async () => {
    let observers = 0;
    const controller = createAppLifecycle({
        prepareAuthScreen: () => {},
        initFirebase: async () => ({}),
        registerAuthObserver: () => {
            observers++;
            return () => {};
        },
        onSignedIn: async () => {},
        onSignedOut: () => {},
        onSignedInError: async () => {},
        onStartupError: () => {}
    });
    await Promise.all([controller.start(), controller.start()]);
    assert.equal(observers, 1);
    controller.stop();
});
test("4.48 no real Firebase calls are needed for the consolidated module tests", () => {
    assert.equal(typeof createAppLifecycle, "function");
    assert.equal(typeof createApiClient, "function");
});

test("4.49 toast has accessible screen-reader status", () => {
    assert.match(html, /id="toast"[^>]*role="status"[^>]*aria-live="polite"/);
});
test("4.49 loading overlay has accessible screen-reader status", () => {
    assert.match(html, /id="loadingOverlay"[^>]*role="status"[^>]*aria-live="polite"/);
});
test("4.49 Firebase CDN connection hint is present", () => {
    assert.match(html, /rel="preconnect" href="https:\/\/www\.gstatic\.com"/);
});
test("4.49 Chart CDN connection hint is present", () => {
    assert.match(html, /rel="preconnect" href="https:\/\/cdn\.jsdelivr\.net"/);
});

test("4.50 all frontend modules load before the application entry point", () => {
    const order = ["app-lifecycle.js", "ui-feedback.js", "app.js"].map((name) =>
        html.indexOf(`src="js/${name}"`)
    );
    assert(order.every((n, i) => n >= 0 && (!i || n > order[i - 1])));
});
test("4.50 app uses shared UI feedback without redeclaring global handlers", () => {
    assert.match(app, /XTechUiFeedback\.createUiFeedback/);
    assert.doesNotMatch(app, /function toast\(message\)/);
    assert.doesNotMatch(app, /function setMessage\(id,/);
    assert.doesNotMatch(app, /async function busy\(button,/);
});
test("4.50 static project validator includes consolidated module", () => {
    assert.match(read("scripts/validate.js"), /frontend\/js\/ui-feedback\.js/);
});
test("4.50 release audit is registered as a separate npm quality gate", () => {
    assert.equal(pkg.scripts["test:release-audit"], "node scripts/release-audit.js");
});
test("4.50 unit regression suite registers this file", () => {
    assert(pkg.scripts["test:unit"].includes("tests/frontend-release-candidate.test.js"));
});
test("4.50 GitHub CI includes the new release audit", () => {
    assert.match(read(".github/workflows/ci.yml"), /npm run test:release-audit/);
});
test("4.50 release checklist explicitly requires manual acceptance", () => {
    assert.match(read("docs/RELEASE_CANDIDATE_CHECKLIST.md"), /Required manual acceptance matrix/);
});
test("4.50 rollout and rollback remain manual", () => {
    assert.match(read("docs/RELEASE_CANDIDATE_CHECKLIST.md"), /Roll\s*back|rollback/i);
});
