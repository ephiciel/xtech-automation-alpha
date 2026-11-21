/* XTECH: dependency-free fullscreen product image viewer. */
/* global module */
(function registerXTechProductLightbox(global) {
    "use strict";

    const MAX_ZOOM = 5;
    const MIN_ZOOM = 1;
    const ZOOM_STEP = 0.5;
    const PRODUCT_AREAS = "#productTable, #pickupProductPreview, [data-product-gallery]";

    function clamp(value, low, high) {
        return Math.min(high, Math.max(low, value));
    }

    function normalizeImageUrl(src, baseUrl) {
        if (!String(src || "").trim()) return null;
        try {
            const url = new URL(String(src || ""), baseUrl);
            return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
        } catch {
            return null;
        }
    }

    function isProductImage(node) {
        if (!node || String(node.tagName || "").toUpperCase() !== "IMG") return false;
        if (node.hasAttribute?.("data-xtech-no-lightbox")) return false;
        if (
            node.hasAttribute?.("data-product-image") ||
            node.hasAttribute?.("data-xtech-product-image")
        )
            return true;
        if (
            String(node.getAttribute?.("alt") || "")
                .trim()
                .toLowerCase() === "product"
        )
            return true;
        if (String(node.getAttribute?.("src") || "").includes("/product-images/")) return true;
        return Boolean(node.closest?.(PRODUCT_AREAS));
    }

    const helpers = { clamp, normalizeImageUrl, isProductImage };
    if (typeof module !== "undefined" && module.exports) module.exports = helpers;
    if (!global || !global.document) return;

    const document = global.document;
    let overlay = null;
    let preview = null;
    let stage = null;
    let message = null;
    let zoomLabel = null;
    let scale = MIN_ZOOM;
    let panX = 0;
    let panY = 0;
    let savedFocus = null;
    let savedOverflow = null;
    const pointers = new Map();
    let initialDrag = null;
    let initialPinch = null;

    function fitPan() {
        if (!preview || !stage) return;
        const maxX = Math.max(0, (preview.offsetWidth * scale - stage.clientWidth) / 2);
        const maxY = Math.max(0, (preview.offsetHeight * scale - stage.clientHeight) / 2);
        panX = clamp(panX, -maxX, maxX);
        panY = clamp(panY, -maxY, maxY);
        if (scale <= MIN_ZOOM) {
            panX = 0;
            panY = 0;
        }
    }

    function render() {
        if (!preview || !overlay) return;
        fitPan();
        preview.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
        overlay.querySelector('[data-lightbox-action="out"]').disabled = scale <= MIN_ZOOM;
        overlay.querySelector('[data-lightbox-action="in"]').disabled = scale >= MAX_ZOOM;
        stage.classList.toggle("is-zoomed", scale > MIN_ZOOM);
    }

    function setZoom(nextScale) {
        scale = clamp(Math.round(nextScale * 100) / 100, MIN_ZOOM, MAX_ZOOM);
        render();
    }

    function resetZoom() {
        scale = MIN_ZOOM;
        panX = 0;
        panY = 0;
        render();
    }

    function close() {
        if (!overlay || overlay.hidden) return;
        overlay.hidden = true;
        resetZoom();
        pointers.clear();
        initialPinch = null;
        initialDrag = null;
        if (savedOverflow !== null) document.body.style.overflow = savedOverflow;
        savedOverflow = null;
        if (savedFocus && typeof savedFocus.focus === "function" && savedFocus.isConnected) {
            savedFocus.focus({ preventScroll: true });
        }
        savedFocus = null;
        preview.removeAttribute("src");
    }

    function installUI() {
        if (overlay) return;
        overlay = document.createElement("div");
        overlay.className = "xtech-lightbox";
        overlay.hidden = true;
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.setAttribute("aria-label", "Expanded product image");
        // All markup is constant, never assembled from product names or URLs.
        overlay.innerHTML = `
            <div class="xtech-lightbox__top">
              <span class="xtech-lightbox__title">Product image</span>
              <button type="button" class="xtech-lightbox__close" data-lightbox-action="close" aria-label="Close image viewer" title="Close (Esc)">×</button>
            </div>
            <div class="xtech-lightbox__stage" aria-label="Enlarged image. Double-click or double-tap to zoom.">
              <img class="xtech-lightbox__image" alt="Expanded product image" draggable="false" />
              <p class="xtech-lightbox__message" role="status" hidden>Image could not be loaded.</p>
            </div>
            <div class="xtech-lightbox__tools" role="toolbar" aria-label="Image zoom">
              <button type="button" data-lightbox-action="out" aria-label="Zoom out" title="Zoom out (-)">−</button>
              <output data-lightbox-zoom aria-live="off">100%</output>
              <button type="button" data-lightbox-action="in" aria-label="Zoom in" title="Zoom in (+)">+</button>
              <button type="button" data-lightbox-action="reset" aria-label="Fit image to screen" title="Fit to screen (0)">Fit</button>
            </div>`;
        document.body.appendChild(overlay);
        preview = overlay.querySelector(".xtech-lightbox__image");
        stage = overlay.querySelector(".xtech-lightbox__stage");
        message = overlay.querySelector(".xtech-lightbox__message");
        zoomLabel = overlay.querySelector("[data-lightbox-zoom]");

        overlay.addEventListener("click", (event) => {
            const button = event.target.closest?.("[data-lightbox-action]");
            const action = button?.getAttribute("data-lightbox-action");
            if (action === "close") close();
            else if (action === "in") setZoom(scale + ZOOM_STEP);
            else if (action === "out") setZoom(scale - ZOOM_STEP);
            else if (action === "reset") resetZoom();
            else if (event.target === overlay || event.target === stage) close();
        });
        preview.addEventListener("load", () => {
            message.hidden = true;
            preview.hidden = false;
            render();
        });
        preview.addEventListener("error", () => {
            preview.hidden = true;
            message.hidden = false;
            message.textContent = "This product image could not be loaded.";
        });

        stage.addEventListener("dblclick", (event) => {
            event.preventDefault();
            if (scale > MIN_ZOOM) resetZoom();
            else setZoom(2);
        });
        stage.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                setZoom(scale + (event.deltaY < 0 ? 0.25 : -0.25));
            },
            { passive: false }
        );

        stage.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            stage.setPointerCapture?.(event.pointerId);
            if (pointers.size >= 2) {
                const [a, b] = Array.from(pointers.values());
                initialPinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
                initialDrag = null;
            } else if (scale > MIN_ZOOM) {
                initialDrag = { x: event.clientX, y: event.clientY, panX, panY };
            }
        });
        stage.addEventListener("pointermove", (event) => {
            if (!pointers.has(event.pointerId)) return;
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (pointers.size >= 2 && initialPinch) {
                const [a, b] = Array.from(pointers.values());
                setZoom(
                    initialPinch.scale * (Math.hypot(a.x - b.x, a.y - b.y) / initialPinch.distance)
                );
            } else if (initialDrag && scale > MIN_ZOOM) {
                panX = initialDrag.panX + event.clientX - initialDrag.x;
                panY = initialDrag.panY + event.clientY - initialDrag.y;
                render();
            }
        });
        function releasePointer(event) {
            pointers.delete(event.pointerId);
            initialPinch = null;
            initialDrag = null;
            if (pointers.size === 1 && scale > MIN_ZOOM) {
                const [point] = Array.from(pointers.values());
                initialDrag = { ...point, panX, panY };
            }
        }
        stage.addEventListener("pointerup", releasePointer);
        stage.addEventListener("pointercancel", releasePointer);
        stage.addEventListener("lostpointercapture", releasePointer);
        global.addEventListener("resize", render);
    }

    function open(image) {
        if (!isProductImage(image)) return false;
        const src = normalizeImageUrl(
            image.currentSrc || image.getAttribute("src"),
            global.location.href
        );
        if (!src) return false;
        installUI();
        savedFocus = document.activeElement;
        savedOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        message.hidden = true;
        preview.hidden = false;
        preview.alt = String(image.alt || "Product") + " — enlarged";
        overlay.hidden = false;
        resetZoom();
        preview.src = src;
        overlay.querySelector('[data-lightbox-action="close"]').focus({ preventScroll: true });
        return true;
    }

    function annotate(root) {
        if (!root || typeof root.querySelectorAll !== "function") return;
        const images = [];
        if (isProductImage(root)) images.push(root);
        images.push(...root.querySelectorAll("img"));
        for (const image of images) {
            if (!isProductImage(image) || image.dataset.xtechLightboxReady === "1") continue;
            image.dataset.xtechLightboxReady = "1";
            if (!image.hasAttribute("tabindex")) image.setAttribute("tabindex", "0");
            if (!image.hasAttribute("role")) image.setAttribute("role", "button");
            image.setAttribute("aria-label", "Enlarge product image");
            image.title = image.title || "Click to enlarge product image";
            image.classList.add("xtech-lightbox-trigger");
        }
    }

    function onKeyDown(event) {
        if (!overlay || overlay.hidden) {
            if ((event.key === "Enter" || event.key === " ") && isProductImage(event.target)) {
                if (open(event.target)) event.preventDefault();
            }
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            setZoom(scale + ZOOM_STEP);
        }
        if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            setZoom(scale - ZOOM_STEP);
        }
        if (event.key === "0") {
            event.preventDefault();
            resetZoom();
        }
        if (event.key === "Tab") {
            const buttons = Array.from(overlay.querySelectorAll("button:not(:disabled)"));
            if (!buttons.length) return;
            const first = buttons[0];
            const last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    }

    function init() {
        if (document.documentElement.dataset.xtechLightboxInstalled === "1") return;
        document.documentElement.dataset.xtechLightboxInstalled = "1";
        annotate(document);
        // Product grids and pickup previews are re-rendered dynamically.
        const observer = new MutationObserver((records) => {
            for (const record of records) {
                for (const node of record.addedNodes) {
                    if (node.nodeType === 1 && node !== overlay) annotate(node);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener(
            "click",
            (event) => {
                if (overlay && !overlay.hidden) return;
                const image = event.target.closest?.("img");
                if (isProductImage(image) && open(image)) event.preventDefault();
            },
            true
        );
        document.addEventListener("keydown", onKeyDown, true);
    }

    global.XTechProductLightbox = Object.freeze({ open, close, isProductImage });
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
})(typeof window !== "undefined" ? window : undefined);
