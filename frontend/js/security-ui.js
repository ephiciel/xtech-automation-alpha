"use strict";
(function registerXTechSecurityUi(global) {
    function createSecurityUi(deps) {
        const {
            $,
            toast,
            setMessage,
            busy,
            roleDisplayName,
            validationError,
            validateText,
            validateNewPassword,
            getCurrentUser,
            getProfile,
            getFirebaseAuthApi,
            getFirebaseAuthInstance
        } = deps;
        let pendingPasswordChangeMfaResolver = null;
        let pendingPasswordChangeMfaHint = null;
        // Loads account and MFA details shown on the Account & Security page
        function loadSecurity() {
            const currentUser = getCurrentUser();
            const profile = getProfile();
            const firebaseAuthApi = getFirebaseAuthApi();
            if (!currentUser || !firebaseAuthApi) return;

            $("securityEmail").textContent = currentUser.email || "—";
            $("securityRole").textContent = roleDisplayName(profile?.role || "customer");

            const factors = firebaseAuthApi.multiFactor(currentUser).enrolledFactors || [];
            const hasTotp = factors.some(
                (factor) => factor.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID
            );
            $("securityMfaStatus").textContent = hasTotp ? "Authenticator enabled" : "Not enabled";
            $("securityEmailOtpStatus").textContent = currentUser.email
                ? "Available"
                : "Unavailable";

            const lastSignIn = currentUser.metadata?.lastSignInTime;
            $("securityLastSignIn").textContent = lastSignIn
                ? new Date(lastSignIn).toLocaleString()
                : "—";
        }

        // Clears any unfinished Authenticator verification for a password change
        function resetPasswordChangeMfa() {
            pendingPasswordChangeMfaResolver = null;
            pendingPasswordChangeMfaHint = null;
            $("changePasswordTotpWrap")?.classList.add("hidden");
            if ($("changePasswordTotpCode")) $("changePasswordTotpCode").value = "";
        }

        // Sends a Firebase password-reset link to the signed-in account
        $("sendResetPasswordBtn").addEventListener("click", async (event) => {
            const currentUser = getCurrentUser();
            const firebaseAuthInstance = getFirebaseAuthInstance();
            const firebaseAuthApi = getFirebaseAuthApi();
            setMessage("securityResetMessage", "");
            try {
                if (!currentUser?.email)
                    validationError("This account does not have an email address.");
                await busy(
                    event.currentTarget,
                    () =>
                        firebaseAuthApi.sendPasswordResetEmail(
                            firebaseAuthInstance,
                            currentUser.email
                        ),
                    "Sending…"
                );
                setMessage(
                    "securityResetMessage",
                    `Password reset email sent to ${currentUser.email}.`,
                    "success"
                );
            } catch (error) {
                setMessage(
                    "securityResetMessage",
                    error.message || "Could not send the password reset email."
                );
            }
        });

        // Verifies the current password, optional TOTP code, then changes the Firebase password
        $("changePasswordForm").addEventListener("submit", async (event) => {
            const currentUser = getCurrentUser();
            const firebaseAuthInstance = getFirebaseAuthInstance();
            const firebaseAuthApi = getFirebaseAuthApi();
            event.preventDefault();
            setMessage("changePasswordMessage", "");

            try {
                if (!currentUser?.email)
                    validationError("This account does not have an email address.");

                const currentPassword = validateText(
                    $("currentPassword").value,
                    "Current password",
                    128,
                    true
                );
                const newPassword = validateNewPassword($("newPassword").value);
                const confirmPassword = String($("confirmNewPassword").value || "");

                if (newPassword !== confirmPassword)
                    validationError("New password and confirmation do not match.");
                if (newPassword === currentPassword)
                    validationError(
                        "Your new password must be different from your current password."
                    );

                // If Firebase already requested MFA, verify that code and continue the password change.
                if (pendingPasswordChangeMfaResolver && pendingPasswordChangeMfaHint) {
                    const code = String($("changePasswordTotpCode").value || "").trim();
                    if (!/^\d{6}$/.test(code))
                        validationError("Enter the 6-digit code from your authenticator app.");

                    const assertion = firebaseAuthApi.TotpMultiFactorGenerator.assertionForSignIn(
                        pendingPasswordChangeMfaHint.uid,
                        code
                    );
                    await busy(
                        event.submitter,
                        () => pendingPasswordChangeMfaResolver.resolveSignIn(assertion),
                        "Verifying…"
                    );
                    resetPasswordChangeMfa();
                } else {
                    // Re-sign in with the current password so Firebase treats this as a recent, security-sensitive login.
                    try {
                        await firebaseAuthApi.signInWithEmailAndPassword(
                            firebaseAuthInstance,
                            currentUser.email,
                            currentPassword
                        );
                    } catch (error) {
                        if (error.code !== "auth/multi-factor-auth-required") throw error;

                        pendingPasswordChangeMfaResolver = firebaseAuthApi.getMultiFactorResolver(
                            firebaseAuthInstance,
                            error
                        );
                        pendingPasswordChangeMfaHint = pendingPasswordChangeMfaResolver.hints.find(
                            (hint) =>
                                hint.factorId === firebaseAuthApi.TotpMultiFactorGenerator.FACTOR_ID
                        );

                        if (!pendingPasswordChangeMfaHint) {
                            resetPasswordChangeMfa();
                            validationError(
                                "This account requires an unsupported multi-factor method."
                            );
                        }

                        $("changePasswordTotpWrap").classList.remove("hidden");
                        $("changePasswordTotpCode").focus();
                        setMessage(
                            "changePasswordMessage",
                            "Current password verified. Enter your 6-digit Authenticator code to continue.",
                            "success"
                        );
                        return;
                    }
                }

                const user = firebaseAuthInstance.currentUser;
                if (!user) validationError("Your authentication session expired. Sign in again.");

                await busy(
                    event.submitter,
                    () => firebaseAuthApi.updatePassword(user, newPassword),
                    "Changing…"
                );
                $("changePasswordForm").reset();
                resetPasswordChangeMfa();
                toast("Password changed successfully");

                // Require a fresh sign-in using the new password after the change.
                await firebaseAuthApi.signOut(firebaseAuthInstance);
                setMessage(
                    "loginMessage",
                    "Password changed successfully. Sign in again using your new password.",
                    "success"
                );
            } catch (error) {
                const friendly =
                    {
                        "auth/invalid-credential": "The current password is incorrect.",
                        "auth/wrong-password": "The current password is incorrect.",
                        "auth/weak-password": "The new password is too weak.",
                        "auth/requires-recent-login":
                            "Please sign out, sign in again, and retry the password change."
                    }[error.code] ||
                    error.message ||
                    "Could not change the password.";
                setMessage("changePasswordMessage", friendly);
            }
        });

        return Object.freeze({ loadSecurity, resetPasswordChangeMfa });
    }
    global.XTechSecurityUi = Object.freeze({ createSecurityUi });
})(typeof window !== "undefined" ? window : globalThis);
