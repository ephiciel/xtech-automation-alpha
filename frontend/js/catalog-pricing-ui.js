"use strict";
// Catalog standard-price editor for Admin and Secretary only.
(function registerCatalogPricingUi(global) {
    function createCatalogPricingUi({ $, api, toast, getProfile }) {
        const search = $("catalogPricingSearch");
        const rows = $("catalogPricingRows");
        const message = $("catalogPricingMessage");
        if (!search || !rows || !message) throw Error("Catalog pricing markup missing.");
        let products = [];
        const fmt = (cents) =>
            Number.isSafeInteger(cents) && cents >= 0
                ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(
                      cents / 100
                  )
                : "Price not available";
        const esc = (s) =>
            String(s ?? "")
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#39;");
        function render() {
            const query = search.value.trim().toLowerCase();
            const visible = products.filter((p) =>
                `${p.productName} ${p.productID} ${p.category}`.toLowerCase().includes(query)
            );
            rows.innerHTML = visible.length
                ? visible
                      .map((p) => {
                          const current = p.sellingPriceCents;
                          const display = Number.isSafeInteger(current)
                              ? (current / 100).toFixed(2)
                              : "";
                          return `<tr><td><strong>${esc(p.productName)}</strong><br><small>${esc(p.productID)}</small></td>
                    <td>${esc(p.category)}</td><td>${esc(fmt(current))}</td>
                    <td><input type="number" min="0" max="9999999.99" step="0.01" placeholder="Unset" aria-label="Selling price for ${esc(p.productName)}" data-catalog-price="${esc(p.productID)}" value="${esc(display)}"></td>
                    <td><button type="button" class="small-btn secondary" data-catalog-save="${esc(p.productID)}">Save</button></td></tr>`;
                      })
                      .join("")
                : '<tr><td colspan="5">No matching products.</td></tr>';
        }
        async function loadCatalogPricing() {
            if (!["admin", "secretary"].includes(getProfile()?.role)) return;
            const data = await api("/api/catalog/products");
            if (!data.success || !Array.isArray(data.products)) throw Error("Catalog unavailable.");
            products = data.products;
            render();
        }
        search.addEventListener("input", render);
        rows.addEventListener("click", async (event) => {
            const button = event.target.closest("[data-catalog-save]");
            if (!button || !["admin", "secretary"].includes(getProfile()?.role)) return;
            const id = button.dataset.catalogSave;
            const product = products.find((item) => item.productID === id);
            const input = Array.from(rows.querySelectorAll("[data-catalog-price]")).find(
                (item) => item.dataset.catalogPrice === id
            );
            if (!product || !input) return;
            const price = input.value.trim();
            if (price && !/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(price)) {
                message.textContent = "Enter a PHP price with at most two decimal places.";
                return;
            }
            button.disabled = true;
            message.textContent = "";
            try {
                await api(`/api/products/${encodeURIComponent(id)}/standard-price`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        price: price || null,
                        expectedPriceCents: product.sellingPriceCents
                    })
                });
                await loadCatalogPricing();
                toast("Standard selling price saved.");
            } catch (error) {
                message.textContent = error.message || "Could not save catalog price.";
                // Reload on conflict so staff sees the latest price before retrying.
                if (/changed by another user|409|conflict/i.test(message.textContent))
                    await loadCatalogPricing();
            } finally {
                button.disabled = false;
            }
        });
        return Object.freeze({ loadCatalogPricing });
    }
    global.XTechCatalogPricingUi = Object.freeze({ createCatalogPricingUi });
})(typeof window !== "undefined" ? window : globalThis);
