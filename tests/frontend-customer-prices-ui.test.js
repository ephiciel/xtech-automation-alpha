"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../frontend/js/customer-prices-ui.js"),
    "utf8"
);

function setup(role = "admin") {
    const elements = new Map();
    const calls = [];
    const messages = [];
    const prices = [];
    const win = {};

    const $ = (id) => {
        if (!elements.has(id)) {
            const handlers = {};
            elements.set(id, {
                value: "",
                innerHTML: "",
                textContent: "",
                disabled: false,
                handlers,
                classList: { remove() {} },
                addEventListener(name, fn) {
                    handlers[name] = fn;
                }
            });
        }
        return elements.get(id);
    };

    const api = async (url, options = {}) => {
        calls.push({ url, options });

        if (url === "/api/products")
            return {
                products: [
                    {
                        productID: "P100",
                        productName: "Cleaner",
                        basePriceCents: 25000
                    }
                ]
            };

        if (url.endsWith("/prices") && !options.method) {
            return { prices: [...prices] };
        }

        if (options.method === "PUT") {
            const id = decodeURIComponent(url.split("/").at(-1));
            const amount = JSON.parse(options.body).price;
            const cents = Math.round(Number(amount) * 100);
            const old = prices.find((item) => item.productID === id);

            if (old) old.priceCents = cents;
            else prices.push({ productID: id, priceCents: cents });

            return { success: true };
        }

        if (options.method === "DELETE") {
            const id = decodeURIComponent(url.split("/").at(-1));
            const index = prices.findIndex((item) => item.productID === id);
            if (index >= 0) prices.splice(index, 1);
            return { success: true };
        }

        throw Error("Unexpected API request.");
    };

    vm.runInNewContext(source, { window: win });

    win.XTechCustomerPricesUi.createCustomerPricesUi({
        $,
        api,
        toast: (message) => messages.push(message),
        esc: (value) =>
            String(value ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/"/g, "&quot;"),
        getCustomers: () => [{ id: "c1", name: "Customer One" }],
        getProfile: () => ({ role }),
        confirm: () => true
    });

    return { win, $, calls, messages, prices };
}

test("non-Admin cannot open customer amounts", async () => {
    const f = setup("secretary");
    await f.win.manageCustomerPrices("c1");
    assert.equal(f.calls.length, 0);
    assert.match(f.messages[0], /Only Admin/);
});

test("Admin can see the default and negotiated amounts", async () => {
    const f = setup();
    await f.win.manageCustomerPrices("c1");
    assert.match(f.$("customerPriceCurrent").textContent, /PHP 250.00/);
    assert.ok(f.calls.some((call) => call.url === "/api/customers/c1/prices"));
});

test("Admin saves and clears a negotiated amount", async () => {
    const f = setup();
    await f.win.manageCustomerPrices("c1");

    f.$("customerPriceAmount").value = "220.50";
    await f.$("customerPriceForm").handlers.submit({
        preventDefault() {}
    });

    assert.equal(f.prices[0].priceCents, 22050);
    assert.ok(f.calls.some((call) => call.options.method === "PUT"));

    await f.$("customerPriceRows").handlers.click({
        target: {
            closest() {
                return { dataset: { clear: "P100" }, disabled: false };
            }
        }
    });

    assert.equal(f.prices.length, 0);
    assert.ok(f.calls.some((call) => call.options.method === "DELETE"));
});
