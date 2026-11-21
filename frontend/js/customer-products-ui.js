"use strict";
// Customer-only, read-only product catalogue using XTECH's existing authenticated product API.
(function registerCustomerProductsUi(global) {
    function createCustomerProductsUi(deps) {
        const { $, api, getProfile, onRequestPickup, toast } = deps;
        let products = [];
        const grid = $("customerProductsGrid");
        const search = $("customerProductsSearch");
        const count = $("customerProductsCount");
        if (!grid || !search || !count)
            throw new Error("Customer product catalogue markup is missing.");

        function element(tag, className, content) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (content != null) node.textContent = String(content);
            return node;
        }

        function photoUrl(value) {
            if (typeof value !== "string") return null;
            try {
                const url = new URL(value);
                return url.protocol === "https:" ? url.href : null;
            } catch {
                return null;
            }
        }

        function render() {
            const query = search.value.trim().toLocaleLowerCase();
            const matches = products.filter((product) =>
                `${product.productName || ""} ${product.category || ""} ${product.productID || ""}`
                    .toLocaleLowerCase()
                    .includes(query)
            );
            count.textContent = `${matches.length} product${matches.length === 1 ? "" : "s"}`;
            const list = document.createDocumentFragment();

            if (!matches.length) {
                list.appendChild(
                    element("p", "customer-catalog-empty", "No products match your search.")
                );
            }

            for (const product of matches) {
                const title = String(product.productName || product.productID || "Unnamed product");
                const stock = Math.max(0, Number(product.quantity) || 0);
                const card = element("article", "customer-catalog-card");
                const media = element("div", "customer-catalog-media");
                const url = photoUrl(product.imageUrl);
                if (url) {
                    const image = element("img", "customer-catalog-image");
                    image.src = url;
                    image.alt = title;
                    image.loading = "lazy";
                    image.referrerPolicy = "no-referrer";
                    image.addEventListener(
                        "error",
                        () => {
                            image.replaceWith(
                                element("span", "customer-catalog-no-image", "Photo unavailable")
                            );
                        },
                        { once: true }
                    );
                    media.appendChild(image);
                } else {
                    media.appendChild(
                        element("span", "customer-catalog-no-image", "No product photo yet")
                    );
                }
                card.appendChild(media);

                const body = element("div", "customer-catalog-body");
                body.appendChild(element("h3", "customer-catalog-title", title));
                body.appendChild(
                    element("p", "customer-catalog-category", product.category || "Product")
                );
                const availability = element(
                    "span",
                    `customer-catalog-stock ${stock ? "available" : "unavailable"}`,
                    stock ? "Available" : "Out of stock"
                );
                body.appendChild(availability);

                const details = element("details", "customer-catalog-details");
                details.appendChild(element("summary", "", "View details"));
                if (product.unit) details.appendChild(element("p", "", `Unit: ${product.unit}`));
                details.appendChild(
                    element("p", "", product.description || "No product description available.")
                );
                body.appendChild(details);

                const button = element(
                    "button",
                    "primary customer-catalog-request",
                    "Request Pickup"
                );
                button.type = "button";
                button.disabled = stock <= 0;
                button.addEventListener("click", async () => {
                    button.disabled = true;
                    try {
                        await onRequestPickup(product.productID);
                    } catch (error) {
                        toast(error?.message || "Could not open the pickup form.");
                    } finally {
                        button.disabled = false;
                    }
                });
                body.appendChild(button);
                card.appendChild(body);
                list.appendChild(card);
            }
            grid.replaceChildren(list);
        }

        async function loadCustomerProducts() {
            if (getProfile()?.role !== "customer") return;
            grid.replaceChildren(element("p", "customer-catalog-empty", "Loading products..."));
            try {
                const response = await api("/api/products");
                if (response.success !== true || !Array.isArray(response.products)) {
                    throw new Error("Unable to load product catalogue.");
                }
                products = response.products
                    .filter((product) => product && product.active !== false)
                    .sort((a, b) =>
                        String(a.productName || "").localeCompare(String(b.productName || ""))
                    );
                render();
            } catch (error) {
                grid.replaceChildren(
                    element(
                        "p",
                        "customer-catalog-empty",
                        "Could not load products. Please try again."
                    )
                );
                count.textContent = "Unavailable";
                toast(error.message);
            }
        }

        search.addEventListener("input", render);
        return Object.freeze({ loadCustomerProducts });
    }
    global.XTechCustomerProductsUi = Object.freeze({ createCustomerProductsUi });
})(typeof window !== "undefined" ? window : globalThis);
