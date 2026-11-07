"use strict";

// Firebase bootstrap and OTP browser persistence without DOM or UI dependencies.
(function registerAuthClient(global) {
    const APP_SDK_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
    const AUTH_SDK_URL = "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

    function createFirebaseAuthClient({
        request,
        loadModules = () => Promise.all([import(APP_SDK_URL), import(AUTH_SDK_URL)])
    } = {}) {
        if (typeof request !== "function") {
            throw new TypeError("An API request function is required.");
        }

        let appInstance = null;
        let authInstance = null;
        let firebaseApi = null;
        let sdkPromise = null;
        let initPromise = null;
        let config = {};

        async function loadFirebaseAuthApi() {
            if (firebaseApi) return firebaseApi;
            if (!sdkPromise) {
                sdkPromise = Promise.resolve()
                    .then(() => loadModules())
                    .then(([appModule, authModule]) => {
                        firebaseApi = { ...appModule, ...authModule };
                        return firebaseApi;
                    });
            }

            try {
                return await sdkPromise;
            } catch (error) {
                sdkPromise = null;
                throw error;
            }
        }

        async function initFirebase() {
            if (authInstance && firebaseApi) {
                return { auth: authInstance, firebaseApi, config };
            }
            if (initPromise) return initPromise;

            initPromise = (async () => {
                config = await request("/api/config", { silent: true });
                if (!config.apiKey || !config.projectId || !config.appId) {
                    throw new Error(
                        "Firebase web configuration is missing. Check FIREBASE_API_KEY, " +
                            "FIREBASE_PROJECT_ID, and FIREBASE_APP_ID in your deployment environment."
                    );
                }

                const sdk = await loadFirebaseAuthApi();
                if (!appInstance) appInstance = sdk.initializeApp(config);
                if (!authInstance) authInstance = sdk.getAuth(appInstance);
                return { auth: authInstance, firebaseApi: sdk, config };
            })();

            try {
                return await initPromise;
            } catch (error) {
                initPromise = null;
                throw error;
            }
        }

        return Object.freeze({ initFirebase });
    }

    function createEmailOtpStore({ key, getStorage = () => global.sessionStorage } = {}) {
        if (!key) throw new TypeError("An OTP storage key is required.");

        return Object.freeze({
            save(state) {
                try {
                    getStorage().setItem(key, JSON.stringify(state));
                    return true;
                } catch {
                    // Server-side OTP cooldown enforcement does not depend on browser storage.
                    return false;
                }
            },
            read() {
                try {
                    return JSON.parse(getStorage().getItem(key) || "null");
                } catch {
                    return null;
                }
            },
            clear() {
                try {
                    getStorage().removeItem(key);
                    return true;
                } catch {
                    return false;
                }
            }
        });
    }

    global.XTechAuthClient = Object.freeze({
        createFirebaseAuthClient,
        createEmailOtpStore
    });
})(typeof window !== "undefined" ? window : globalThis);
