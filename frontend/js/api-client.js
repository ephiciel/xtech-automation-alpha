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
                let response;
                try {
                    response = await fetchFn(url, { ...requestOptions, headers });
                } catch (error) {
                    // A transport failure is distinct from an HTTP 401/403/429/500.
                    // Preserve the original message and NEVER auto-retry write requests.
                    if (
                        error &&
                        typeof error === "object" &&
                        error.name !== "AbortError" &&
                        Object.isExtensible(error) &&
                        !("status" in error)
                    ) {
                        error.status = 0;
                        if (!("code" in error)) error.code = "NETWORK_ERROR";
                    }
                    throw error;
                }
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
