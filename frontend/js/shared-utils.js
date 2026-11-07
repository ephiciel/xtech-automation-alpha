"use strict";
// Shared date, HTML-escaping and form-validation helpers.
// Classic-script namespace keeps existing app startup and event handlers unchanged.
(function registerSharedUtils(global) {
    // Makes text safe before adding it to HTML
    function esc(value) {
        return String(value ?? "").replace(
            /[&<>"']/g,
            (char) =>
                ({
                    "&": "&amp;",
                    "<": "&lt;",
                    ">": "&gt;",
                    '"': "&quot;",
                    "'": "&#039;"
                })[char]
        );
    }

    // Formats a value as a readable date and time
    function fmtDateTime(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString();
    }

    // Formats a value as a readable date
    function fmtDate(value) {
        if (!value) return "—";
        const date = new Date(`${value}T00:00:00`);
        return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString();
    }

    // Converts a date value to YYYY-MM-DD format
    function datePart(value) {
        if (!value) return "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const d = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    // Gets todays date in YYYY-MM-DD format
    function todayYMD() {
        return datePart(new Date());
    }

    // Checks if a date is inside the selected date range
    function within(value, start, end) {
        const date = datePart(value);
        if (start && (!date || date < start)) return false;
        if (end && (!date || date > end)) return false;
        return true;
    }

    // Checks names, emails, phone numbers, text lengths, and numeric fields before sending data
    function validationError(message) {
        throw new Error(message);
    }

    function validateName(value, label = "Name") {
        const text = String(value || "").trim();
        if (
            text.length < 2 ||
            text.length > 80 ||
            !/[\p{L}]/u.test(text) ||
            !/^[\p{L}\p{M} .'-]+$/u.test(text)
        ) {
            validationError(
                `${label} must be 2 to 80 characters and use letters, spaces, apostrophes, periods, or hyphens.`
            );
        }
        return text;
    }

    function validateEmail(value) {
        const email = String(value || "")
            .trim()
            .toLowerCase();
        if (!email || email.length > 254 || /\s/.test(email)) {
            validationError("Enter a valid email address.");
        }

        const parts = email.split("@");
        if (parts.length !== 2)
            validationError("Enter a valid email address. Use only one @ symbol.");

        const [local, domain] = parts;
        if (
            !local ||
            !domain ||
            local.length > 64 ||
            local.startsWith(".") ||
            local.endsWith(".") ||
            local.includes("..")
        ) {
            validationError(
                "Enter a valid email address. Check for missing text or repeated periods."
            );
        }
        if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) {
            validationError("Enter a valid email address.");
        }

        const labels = domain.split(".");
        if (labels.length < 2) validationError("Enter a complete email domain such as gmail.com.");

        for (const label of labels) {
            if (
                !label ||
                label.length > 63 ||
                !/^[a-z0-9-]+$/i.test(label) ||
                label.startsWith("-") ||
                label.endsWith("-")
            ) {
                validationError("Enter a valid email domain.");
            }
        }

        const tld = labels.at(-1).toLowerCase();
        if (!/^[a-z]{2,24}$/i.test(tld)) validationError("Enter a valid email ending.");

        const commonEndings = ["com", "net", "org", "edu", "gov", "mil", "ph", "io", "co"];
        const repeatedEnding =
            labels.length >= 3 &&
            labels.at(-1).toLowerCase() === labels.at(-2).toLowerCase() &&
            commonEndings.includes(tld);
        const concatenatedEnding = commonEndings.some((ending) => tld === ending + ending);
        if (repeatedEnding || concatenatedEnding) {
            validationError(
                "Check the email ending. Addresses such as me.test@gmail.comcom or me.test@gmail.com.com are not accepted."
            );
        }

        return email;
    }

    function validatePhone(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (!/^[+0-9() .-]+$/.test(raw)) {
            validationError(
                "Enter a Philippine mobile number using digits and normal phone separators only."
            );
        }

        const compact = raw.replace(/[() .-]/g, "");
        let normalized = "";
        if (/^09\d{9}$/.test(compact)) normalized = `+63${compact.slice(1)}`;
        else if (/^\+639\d{9}$/.test(compact)) normalized = compact;
        else
            validationError(
                "Enter a valid Philippine mobile number such as 09171234567 or +639171234567."
            );

        const subscriber = normalized.replace(/\D/g, "").slice(3);
        if (
            /^(\d)\1{8}$/.test(subscriber) ||
            ["123456789", "987654321", "000000000"].includes(subscriber)
        ) {
            validationError(
                "Enter a real Philippine mobile number instead of an obvious placeholder number."
            );
        }

        return normalized;
    }

    function validateText(value, label, maxLength, required = false) {
        const text = String(value || "").trim();
        if (required && !text) validationError(`${label} is required.`);
        if (text.length > maxLength)
            validationError(`${label} must be ${maxLength} characters or fewer.`);
        return text;
    }

    function validatePassword(value) {
        const password = String(value || "");
        if (password.length < 6 || password.length > 128) {
            validationError("Password must be between 6 and 128 characters.");
        }
        return password;
    }

    // Applies a stronger password rule when an existing user changes their password
    function validateNewPassword(value) {
        const password = String(value || "");
        if (password.length < 8 || password.length > 128) {
            validationError("New password must be between 8 and 128 characters.");
        }
        if (!/[A-Z]/.test(password))
            validationError("New password must include at least one uppercase letter.");
        if (!/[a-z]/.test(password))
            validationError("New password must include at least one lowercase letter.");
        if (!/\d/.test(password)) validationError("New password must include at least one number.");
        return password;
    }

    function validateProductID(value) {
        const productID = String(value || "").trim();
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,39}$/.test(productID)) {
            validationError(
                "Product ID must be 2 to 40 characters and use only letters, numbers, hyphens, or underscores."
            );
        }
        return productID;
    }

    function validateProductName(value) {
        const name = String(value || "").trim();
        if (name.length < 2 || name.length > 100) {
            validationError("Product name must be between 2 and 100 characters.");
        }
        return name;
    }

    function validateCategory(value) {
        const category = String(value || "").trim();
        if (
            !["Industrial Chemical", "Janitorial Chemical", "Cleaning Supply", "Other"].includes(
                category
            )
        ) {
            validationError("Select a valid product category.");
        }
        return category;
    }

    function validatePositiveWholeNumber(value, label = "Quantity") {
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0 || number > 1000000) {
            validationError(`${label} must be a positive whole number no greater than 1,000,000.`);
        }
        return number;
    }

    function validateFutureDate(value, label = "Date") {
        const text = String(value || "").trim();
        const date = new Date(`${text}T00:00:00`);
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
            Number.isNaN(date.getTime()) ||
            datePart(date) !== text ||
            text < todayYMD()
        ) {
            validationError(`${label} must be a valid date that is today or later.`);
        }
        return text;
    }

    global.XTechSharedUtils = Object.freeze({
        esc,
        fmtDateTime,
        fmtDate,
        datePart,
        todayYMD,
        within,
        validationError,
        validateName,
        validateEmail,
        validatePhone,
        validateText,
        validatePassword,
        validateNewPassword,
        validateProductID,
        validateProductName,
        validateCategory,
        validatePositiveWholeNumber,
        validateFutureDate
    });
})(window);
