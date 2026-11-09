"use strict";
// Stage 4.43: isolate Firebase SDK handles and in-progress authentication UI state.
// The application's signed-in identity and Bearer token still belong to app.js.
(function registerAuthSessionState(global) {
    function createAuthSessionState() {
        let firebaseAuthInstance = null;
        let firebaseAuthApi = null;
        let appConfig = {};
        const authUiState = {
            selectedSignInMethod: "password-totp",
            authFlowInProgress: false,
            pendingMfaResolver: null,
            pendingMfaHint: null,
            pendingTotpSecret: null,
            pendingEmailOtpEmail: "",
            pendingEmailOtpMaskedEmail: "",
            emailOtpResendAvailableAt: 0,
            emailOtpExpiresAt: 0,
            emailOtpCountdownTimer: null
        };

        // Preserve the previous order: store initialized Firebase handles together.
        // No Firebase or network calls occur inside this module.
        function setFirebaseClient(result) {
            firebaseAuthApi = result.firebaseApi;
            firebaseAuthInstance = result.auth;
            appConfig = result.config;
        }
        function getFirebaseAuthApi() {
            return firebaseAuthApi;
        }
        function getFirebaseAuthInstance() {
            return firebaseAuthInstance;
        }
        function getAppConfig() {
            return appConfig;
        }

        return Object.freeze({
            setFirebaseClient,
            getFirebaseAuthApi,
            getFirebaseAuthInstance,
            getAppConfig,
            authUiState
        });
    }
    global.XTechAuthSessionState = Object.freeze({ createAuthSessionState });
})(window);
