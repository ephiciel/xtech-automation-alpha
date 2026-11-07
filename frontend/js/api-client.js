"use strict";

// Browser-neutral HTTP client. Authentication and loading state are supplied by the app.
(function registerApiClient(global) {
    function createApiClient({
        getToken = () => "",
        onPendingChange = () => {},
        fetchFn = (url, options) => global.fetch(url, options)
    } = {}) {
        return async function api(url, options = {}) {
            const { silent = false, ...requestOptions } = options;
            const headers = { ...(requestOptions.headers || {}) };
            const token = getToken();

            if (token) headers.Authorization = "Bearer " + token;
            if (requestOptions.body && !headers["Content-Type"]) {
                headers["Content-Type"] = "application/json";
            }

            if (!silent) onPendingChange(1);

            try {
                const response = await fetchFn(url, { ...requestOptions, headers });
                let data = {};

                try {
                    data = await response.json();
                } catch {
                    // Preserve the original empty-object fallback for non-JSON responses.
                }

                if (!response.ok) {
                    const message =
                        (data && data.message) || "Request failed (" + response.status + ")";
                    const error = new Error(message);
                    error.status = response.status;
                    Object.assign(error, data);
                    throw error;
                }

                return data;
            } finally {
                if (!silent) onPendingChange(-1);
            }
        };
    }

    global.XTechApiClient = Object.freeze({ createApiClient });
})(typeof window !== "undefined" ? window : globalThis);
