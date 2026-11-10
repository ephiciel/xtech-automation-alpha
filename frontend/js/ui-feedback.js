"use strict";
// Stage 4.45: shared notification and pending-button behavior without page globals.
(function registerUiFeedback(global) {
    function createUiFeedback({
        getElement,
        setTimeoutFn = setTimeout,
        clearTimeoutFn = clearTimeout
    } = {}) {
        if (typeof getElement !== "function") {
            throw new TypeError("UI feedback requires an element lookup function.");
        }
        let toastTimer = null;

        function toast(message) {
            const element = getElement("toast");
            if (!element) return;
            element.textContent = message;
            element.classList.add("show");
            clearTimeoutFn(toastTimer);
            toastTimer = setTimeoutFn(() => element.classList.remove("show"), 2800);
        }

        function setMessage(id, message, kind = "error") {
            const element = getElement(id);
            if (!element) return;
            element.textContent = message || "";
            element.classList.toggle("success", kind === "success");
        }

        // Keeps the original button state transition and always resets after failure.
        async function busy(button, work, workingText = "Please wait…") {
            if (!button) return work();
            const original = button.textContent;
            button.disabled = true;
            button.textContent = workingText;
            try {
                return await work();
            } finally {
                button.disabled = false;
                button.textContent = original;
            }
        }

        return Object.freeze({ toast, setMessage, busy });
    }

    global.XTechUiFeedback = Object.freeze({ createUiFeedback });
})(window);
