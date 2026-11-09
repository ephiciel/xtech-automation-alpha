"use strict";
(function registerXTechAuthUi(global) {
    function createAuthUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            validateName,
            validateEmail,
            validatePhone,
            validateText,
            validatePassword,
            validationError,
            emailOtpStore,
            state,
            initFirebase,
            finishSignedInUser,
            getFirebaseAuthApi,
            getFirebaseAuthInstance,
            getAppConfig,
            document,
            window,
            setInterval,
            clearInterval
        } = deps;

        // Stores the email OTP screen state so a page refresh does not reset the resend countdown
        function saveEmailOtpSession() {
            if (!state.pendingEmailOtpEmail || !state.emailOtpExpiresAt) return;
            emailOtpStore.save({
                email: state.pendingEmailOtpEmail,
                maskedEmail: state.pendingEmailOtpMaskedEmail,
                resendAvailableAt: state.emailOtpResendAvailableAt,
                expiresAt: state.emailOtpExpiresAt
            });
        }

        // Stops the live resend timer
        function stopEmailOtpCountdown() {
            if (state.emailOtpCountdownTimer) {
                clearInterval(state.emailOtpCountdownTimer);
                state.emailOtpCountdownTimer = null;
            }
        }

        // Removes the locally saved email OTP sign-in state
        function clearEmailOtpSession() {
            stopEmailOtpCountdown();
            state.pendingEmailOtpEmail = "";
            state.pendingEmailOtpMaskedEmail = "";
            state.emailOtpResendAvailableAt = 0;
            state.emailOtpExpiresAt = 0;
            emailOtpStore.clear();

            if ($("resendEmailOtp")) {
                $("resendEmailOtp").disabled = false;
                $("resendEmailOtp").textContent = "Resend Code";
            }
            if ($("emailOtpCooldown")) $("emailOtpCooldown").textContent = "";
        }

        // Updates the resend button and countdown once per second
        function updateEmailOtpCountdown() {
            const button = $("resendEmailOtp");
            const countdown = $("emailOtpCooldown");
            if (!button || !countdown) return;

            const remainingSeconds = Math.max(
                0,
                Math.ceil((state.emailOtpResendAvailableAt - Date.now()) / 1000)
            );
            if (remainingSeconds > 0) {
                button.disabled = true;
                button.textContent = `Resend Code (${remainingSeconds}s)`;
                countdown.textContent = `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`;
                return;
            }

            button.disabled = false;
            button.textContent = "Resend Code";
            countdown.textContent = "You can request another code now.";
            stopEmailOtpCountdown();
        }

        // Starts a live resend countdown using an absolute timestamp
        function startEmailOtpCountdown() {
            stopEmailOtpCountdown();
            updateEmailOtpCountdown();
            if (state.emailOtpResendAvailableAt > Date.now()) {
                state.emailOtpCountdownTimer = setInterval(updateEmailOtpCountdown, 250);
            }
        }

        // Restores an unfinished email OTP sign-in after the page is refreshed
        function restoreEmailOtpSession() {
            const saved = emailOtpStore.read();

            if (!saved?.email || !saved?.expiresAt || Number(saved.expiresAt) <= Date.now()) {
                clearEmailOtpSession();
                return false;
            }

            state.pendingEmailOtpEmail = String(saved.email);
            state.pendingEmailOtpMaskedEmail = String(saved.maskedEmail || saved.email);
            state.emailOtpResendAvailableAt = Number(saved.resendAvailableAt || 0);
            state.emailOtpExpiresAt = Number(saved.expiresAt || 0);

            setSignInMethod("email-otp", { preserveOtpSession: true });
            $("emailOtpEmail").value = state.pendingEmailOtpEmail;
            $("loginForm").classList.add("hidden");
            $("registerForm").classList.add("hidden");
            $("emailOtpForm").classList.remove("hidden");
            $("emailOtpDestination").textContent =
                `Code sent to ${state.pendingEmailOtpMaskedEmail}.`;

            const minutesRemaining = Math.max(
                1,
                Math.ceil((state.emailOtpExpiresAt - Date.now()) / 60000)
            );
            setMessage(
                "emailOtpMessage",
                `Enter the 6-digit code. It expires in about ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.`,
                "success"
            );
            startEmailOtpCountdown();
            return true;
        }

        // Hides the extra security forms and returns to the selected sign-in method
        function resetSecurityForms({ clearOtpSession = false } = {}) {
            state.pendingMfaResolver = null;
            state.pendingMfaHint = null;
            state.pendingTotpSecret = null;
            if (clearOtpSession) clearEmailOtpSession();
            else stopEmailOtpCountdown();
            $("totpChallengeForm").classList.add("hidden");
            $("totpEnrollForm").classList.add("hidden");
            $("emailOtpForm").classList.add("hidden");
            $("loginForm").classList.remove("hidden");
            $("totpChallengeCode").value = "";
            $("totpEnrollCode").value = "";
            $("emailOtpCode").value = "";
            $("totpQr").innerHTML = "";
            $("totpSecretKey").textContent = "—";
            $("emailOtpDestination").textContent = "Enter the 6-digit code sent to your email.";
            setMessage("totpChallengeMessage", "");
            setMessage("totpEnrollMessage", "");
            setMessage("emailOtpMessage", "");
        }

        // Switches between password plus authenticator and email-code sign in
        function setSignInMethod(method, { preserveOtpSession = false } = {}) {
            state.selectedSignInMethod = method === "email-otp" ? "email-otp" : "password-totp";
            const emailOtp = state.selectedSignInMethod === "email-otp";

            if (!emailOtp && !preserveOtpSession) clearEmailOtpSession();

            $("passwordTotpFields").classList.toggle("hidden", emailOtp);
            $("emailOtpFields").classList.toggle("hidden", !emailOtp);
            $("passwordTotpMethod").classList.toggle("active", !emailOtp);
            $("emailOtpMethod").classList.toggle("active", emailOtp);
            $("loginSubmit").textContent = emailOtp
                ? "Send 6-Digit Email Code"
                : "Continue with Password + Authenticator";
            setMessage("loginMessage", "");
        }

        // Switches between the login and registration forms
        function showAuthMode(mode, { preserveOtpSession = false } = {}) {
            const login = mode === "login";
            resetSecurityForms({ clearOtpSession: !preserveOtpSession });
            $("loginForm").classList.toggle("hidden", !login);
            $("registerForm").classList.toggle("hidden", login);
            $("showLoginBtn").classList.toggle("active", login);
            $("showRegisterBtn").classList.toggle("active", !login);
            setMessage("loginMessage", "");
            setMessage("registerMessage", "");
        }

        // Shows the TOTP challenge when Firebase requires a second factor
        function beginTotpChallenge(error) {
            state.pendingMfaResolver = getFirebaseAuthApi().getMultiFactorResolver(
                getFirebaseAuthInstance(),
                error
            );
            state.pendingMfaHint = state.pendingMfaResolver.hints.find(
                (hint) => hint.factorId === getFirebaseAuthApi().TotpMultiFactorGenerator.FACTOR_ID
            );

            if (!state.pendingMfaHint) {
                state.authFlowInProgress = false;
                throw new Error(
                    "This account requires a multi-factor method that XTECH does not support."
                );
            }

            $("loginForm").classList.add("hidden");
            $("registerForm").classList.add("hidden");
            $("totpEnrollForm").classList.add("hidden");
            $("totpChallengeForm").classList.remove("hidden");
            $("totpChallengeCode").focus();
            setMessage(
                "totpChallengeMessage",
                "Enter the current code from your authenticator app.",
                "success"
            );
        }

        // Starts authenticator enrollment for an account that has no TOTP factor yet
        async function beginTotpEnrollment(user) {
            if (!user.emailVerified) {
                await getFirebaseAuthApi().sendEmailVerification(user);
                await getFirebaseAuthApi().signOut(getFirebaseAuthInstance());
                state.authFlowInProgress = false;
                resetSecurityForms();
                setMessage(
                    "loginMessage",
                    "Your email must be verified before Authenticator setup. A verification email was sent. Verify it, then sign in again.",
                    "success"
                );
                return;
            }

            const session = await getFirebaseAuthApi().multiFactor(user).getSession();
            state.pendingTotpSecret =
                await getFirebaseAuthApi().TotpMultiFactorGenerator.generateSecret(session);
            const qrUri = state.pendingTotpSecret.generateQrCodeUrl(
                user.email || "XTECH user",
                "XTECH Automation"
            );

            $("loginForm").classList.add("hidden");
            $("registerForm").classList.add("hidden");
            $("totpChallengeForm").classList.add("hidden");
            $("totpEnrollForm").classList.remove("hidden");
            $("totpSecretKey").textContent = state.pendingTotpSecret.secretKey;
            $("totpQr").innerHTML = "";

            if (window.QRCode) {
                new window.QRCode($("totpQr"), {
                    text: qrUri,
                    width: 180,
                    height: 180,
                    correctLevel: window.QRCode.CorrectLevel.M
                });
            } else {
                $("totpQr").textContent =
                    "QR code library could not load. Use the manual setup key below.";
            }

            $("totpEnrollCode").focus();
            setMessage(
                "totpEnrollMessage",
                "Scan the QR code with Google Authenticator or another TOTP app, then enter the 6-digit code.",
                "success"
            );
        }

        // Adds the show and hide button to a password field
        function setupPasswordToggle(targetId) {
            const input = $(targetId);
            const toggle = document.querySelector(`[data-target="${targetId}"]`);
            if (!input || !toggle) return;

            toggle.addEventListener("click", () => {
                const shouldShow = input.type === "password";
                input.type = shouldShow ? "text" : "password";
                toggle.textContent = shouldShow ? "Hide" : "Show";
                toggle.setAttribute("aria-label", shouldShow ? "Hide password" : "Show password");
            });
        }

        [
            "loginPassword",
            "registerPassword",
            "registerPassword2",
            "userPassword",
            "currentPassword",
            "newPassword",
            "confirmNewPassword"
        ].forEach(setupPasswordToggle);

        $("showLoginBtn").addEventListener("click", () => showAuthMode("login"));
        $("showRegisterBtn").addEventListener("click", () => showAuthMode("register"));
        $("passwordTotpMethod").addEventListener("click", () => setSignInMethod("password-totp"));
        $("emailOtpMethod").addEventListener("click", () => setSignInMethod("email-otp"));

        // Sends a Firebase password-reset email from the signed-out login screen
        $("forgotPasswordBtn").addEventListener("click", async (event) => {
            setMessage("loginMessage", "");
            try {
                const email = validateEmail($("loginEmail").value);
                const auth = await initFirebase();
                await busy(
                    event.currentTarget,
                    () => getFirebaseAuthApi().sendPasswordResetEmail(auth, email),
                    "Sending…"
                );
                setMessage(
                    "loginMessage",
                    `If an XTECH account exists for ${email}, a password-reset email has been sent.`,
                    "success"
                );
            } catch (error) {
                if (error?.code === "auth/user-not-found") {
                    setMessage(
                        "loginMessage",
                        "If an XTECH account exists for that email, a password-reset email has been sent.",
                        "success"
                    );
                    return;
                }
                setMessage(
                    "loginMessage",
                    error.message || "Could not send the password-reset email."
                );
            }
        });

        // Signs in with password plus Authenticator or sends a one-time email code
        $("loginForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("loginMessage", "");

            if (state.selectedSignInMethod === "email-otp") {
                try {
                    const email = validateEmail($("emailOtpEmail").value);
                    const result = await busy(
                        event.submitter,
                        () =>
                            api("/api/auth/email-otp/request", {
                                method: "POST",
                                body: JSON.stringify({ email }),
                                silent: true
                            }),
                        "Sending Code…"
                    );

                    state.pendingEmailOtpEmail = email;
                    state.pendingEmailOtpMaskedEmail = result.maskedEmail || email;
                    state.emailOtpResendAvailableAt =
                        Date.now() + Number(result.resendAfterSeconds || 60) * 1000;
                    state.emailOtpExpiresAt =
                        Date.now() + Number(result.expiresInSeconds || 600) * 1000;
                    saveEmailOtpSession();
                    $("loginForm").classList.add("hidden");
                    $("registerForm").classList.add("hidden");
                    $("emailOtpForm").classList.remove("hidden");
                    $("emailOtpDestination").textContent =
                        `Code sent to ${state.pendingEmailOtpMaskedEmail}.`;
                    setMessage(
                        "emailOtpMessage",
                        `Enter the 6-digit code. It expires in ${Math.ceil(Number(result.expiresInSeconds || 600) / 60)} minutes.`,
                        "success"
                    );
                    startEmailOtpCountdown();
                    $("emailOtpCode").focus();
                } catch (error) {
                    setMessage("loginMessage", error.message);
                }
                return;
            }

            state.authFlowInProgress = true;
            setMessage("loginMessage", "Checking your account…", "success");

            try {
                const email = validateEmail($("loginEmail").value);
                const password = validateText($("loginPassword").value, "Password", 128, true);
                const auth = await initFirebase();
                const credential = await busy(
                    event.submitter,
                    () => getFirebaseAuthApi().signInWithEmailAndPassword(auth, email, password),
                    "Signing In…"
                );

                const factors = getFirebaseAuthApi().multiFactor(credential.user).enrolledFactors;
                const hasTotp = factors.some(
                    (factor) =>
                        factor.factorId === getFirebaseAuthApi().TotpMultiFactorGenerator.FACTOR_ID
                );

                const adminMfaBypass =
                    getAppConfig().adminMfaBypass === true &&
                    credential.user.email?.toLowerCase() ===
                        getAppConfig().adminEmail?.toLowerCase();

                if (!hasTotp && !adminMfaBypass) {
                    await beginTotpEnrollment(credential.user);
                    return;
                }

                state.authFlowInProgress = false;
                await finishSignedInUser(credential.user);
            } catch (error) {
                if (error.code === "auth/multi-factor-auth-required") {
                    try {
                        beginTotpChallenge(error);
                    } catch (challengeError) {
                        setMessage("loginMessage", challengeError.message);
                    }
                    return;
                }
                state.authFlowInProgress = false;
                setMessage("loginMessage", error.message);
            }
        });

        // Verifies a 6-digit code that was sent to the registered email address
        $("emailOtpForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("emailOtpMessage", "");

            try {
                const code = String($("emailOtpCode").value || "").trim();
                if (!/^\d{6}$/.test(code))
                    validationError("Enter the 6-digit code from your email.");
                if (!state.pendingEmailOtpEmail)
                    validationError("The email-code session has expired. Request a new code.");

                state.authFlowInProgress = true;
                const result = await busy(
                    event.submitter,
                    () =>
                        api("/api/auth/email-otp/verify", {
                            method: "POST",
                            body: JSON.stringify({ email: state.pendingEmailOtpEmail, code }),
                            silent: true
                        }),
                    "Verifying…"
                );

                const auth = await initFirebase();
                const credential = await getFirebaseAuthApi().signInWithCustomToken(
                    auth,
                    result.customToken
                );
                const user = credential.user;
                clearEmailOtpSession();
                state.authFlowInProgress = false;
                resetSecurityForms();
                await finishSignedInUser(user);
            } catch (error) {
                state.authFlowInProgress = false;
                setMessage(
                    "emailOtpMessage",
                    error.message || "The email sign-in code could not be verified."
                );
            }
        });

        // Sends another email code after the resend cooldown
        $("resendEmailOtp").addEventListener("click", async (event) => {
            setMessage("emailOtpMessage", "");

            try {
                if (!state.pendingEmailOtpEmail)
                    validationError("The email-code session has expired. Start again.");

                const remainingSeconds = Math.ceil(
                    (state.emailOtpResendAvailableAt - Date.now()) / 1000
                );
                if (remainingSeconds > 0) {
                    validationError(
                        `Please wait ${remainingSeconds} second${remainingSeconds === 1 ? "" : "s"} before requesting another code.`
                    );
                }

                const result = await busy(
                    event.currentTarget,
                    () =>
                        api("/api/auth/email-otp/request", {
                            method: "POST",
                            body: JSON.stringify({ email: state.pendingEmailOtpEmail }),
                            silent: true
                        }),
                    "Sending…"
                );

                state.pendingEmailOtpMaskedEmail = result.maskedEmail || state.pendingEmailOtpEmail;
                state.emailOtpResendAvailableAt =
                    Date.now() + Number(result.resendAfterSeconds || 60) * 1000;
                state.emailOtpExpiresAt =
                    Date.now() + Number(result.expiresInSeconds || 600) * 1000;
                saveEmailOtpSession();
                $("emailOtpCode").value = "";
                $("emailOtpDestination").textContent =
                    `New code sent to ${state.pendingEmailOtpMaskedEmail}.`;
                setMessage("emailOtpMessage", "A new 6-digit code was sent.", "success");
                startEmailOtpCountdown();
                $("emailOtpCode").focus();
            } catch (error) {
                if (Number(error?.retryAfterSeconds) > 0) {
                    state.emailOtpResendAvailableAt =
                        Date.now() + Number(error.retryAfterSeconds) * 1000;
                    if (!state.emailOtpExpiresAt)
                        state.emailOtpExpiresAt = Date.now() + 10 * 60 * 1000;
                    saveEmailOtpSession();
                    startEmailOtpCountdown();
                    setMessage(
                        "emailOtpMessage",
                        "A recent code is still active. Use the countdown before requesting another code."
                    );
                } else {
                    setMessage(
                        "emailOtpMessage",
                        error.message || "Could not resend the email code."
                    );
                }
            }
        });

        // Cancels email-code sign in and returns to the login form
        $("cancelEmailOtp").addEventListener("click", () => {
            clearEmailOtpSession();
            resetSecurityForms();
            setSignInMethod("email-otp", { preserveOtpSession: true });
            $("emailOtpEmail").focus();
        });

        // Verifies the 6-digit code for a previously enrolled authenticator
        $("totpChallengeForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("totpChallengeMessage", "");

            try {
                const code = String($("totpChallengeCode").value || "").trim();
                if (!/^\d{6}$/.test(code))
                    validationError("Enter the 6-digit code from your authenticator app.");
                if (!state.pendingMfaResolver || !state.pendingMfaHint)
                    validationError("The authentication session has expired. Start sign-in again.");

                const assertion = getFirebaseAuthApi().TotpMultiFactorGenerator.assertionForSignIn(
                    state.pendingMfaHint.uid,
                    code
                );
                const credential = await busy(
                    event.submitter,
                    () => state.pendingMfaResolver.resolveSignIn(assertion),
                    "Verifying…"
                );
                state.pendingMfaResolver = null;
                state.pendingMfaHint = null;
                state.authFlowInProgress = false;
                resetSecurityForms();
                await finishSignedInUser(credential.user);
            } catch (error) {
                setMessage(
                    "totpChallengeMessage",
                    error.message || "Invalid or expired authenticator code."
                );
            }
        });

        // Finishes first-time TOTP enrollment
        $("totpEnrollForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("totpEnrollMessage", "");

            try {
                const code = String($("totpEnrollCode").value || "").trim();
                if (!/^\d{6}$/.test(code))
                    validationError("Enter the 6-digit code from your authenticator app.");
                if (!state.pendingTotpSecret || !getFirebaseAuthInstance().currentUser)
                    validationError(
                        "The authenticator setup session has expired. Start sign-in again."
                    );

                const assertion =
                    getFirebaseAuthApi().TotpMultiFactorGenerator.assertionForEnrollment(
                        state.pendingTotpSecret,
                        code
                    );
                await busy(
                    event.submitter,
                    () =>
                        getFirebaseAuthApi()
                            .multiFactor(getFirebaseAuthInstance().currentUser)
                            .enroll(assertion, "XTECH Authenticator"),
                    "Enabling…"
                );
                state.pendingTotpSecret = null;
                state.authFlowInProgress = false;
                const user = getFirebaseAuthInstance().currentUser;
                resetSecurityForms();
                await finishSignedInUser(user);
                toast("Authenticator enabled successfully");
            } catch (error) {
                setMessage(
                    "totpEnrollMessage",
                    error.message || "Could not enable the authenticator."
                );
            }
        });

        // Cancels an authenticator verification attempt
        $("cancelTotpChallenge").addEventListener("click", async () => {
            state.authFlowInProgress = false;
            state.pendingMfaResolver = null;
            state.pendingMfaHint = null;
            resetSecurityForms();
            if (getFirebaseAuthInstance()?.currentUser)
                await getFirebaseAuthApi().signOut(getFirebaseAuthInstance());
        });

        // Cancels first-time authenticator setup
        $("cancelTotpEnroll").addEventListener("click", async () => {
            state.authFlowInProgress = false;
            state.pendingTotpSecret = null;
            if (getFirebaseAuthInstance()?.currentUser)
                await getFirebaseAuthApi().signOut(getFirebaseAuthInstance());
            resetSecurityForms();
            setMessage("loginMessage", "Authenticator setup was cancelled.");
        });

        // Creates a pending customer account and requires the emailed 6-digit code to finish registration
        $("registerForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("registerMessage", "");
            state.authFlowInProgress = true;

            try {
                const name = validateName($("registerName").value, "Full name");
                const email = validateEmail($("registerEmail").value);
                const phone = validatePhone($("registerPhone").value);
                const company = validateText(
                    $("registerCompany").value,
                    "Company / Organization",
                    120
                );
                const address = validateText($("registerAddress").value, "Address", 250);
                const password = validatePassword($("registerPassword").value);
                if (password !== $("registerPassword2").value) {
                    validationError("Passwords do not match.");
                }

                const result = await busy(
                    event.submitter,
                    () =>
                        api("/api/auth/register-customer", {
                            method: "POST",
                            body: JSON.stringify({ name, email, phone, company, address, password })
                        }),
                    "Creating Account…"
                );

                state.pendingEmailOtpEmail = email;
                state.pendingEmailOtpMaskedEmail = result.maskedEmail || email;
                state.emailOtpResendAvailableAt =
                    Date.now() + Number(result.resendAfterSeconds || 60) * 1000;
                state.emailOtpExpiresAt =
                    Date.now() + Number(result.expiresInSeconds || 600) * 1000;
                saveEmailOtpSession();

                state.authFlowInProgress = false;
                showAuthMode("login", { preserveOtpSession: true });
                setSignInMethod("email-otp", { preserveOtpSession: true });
                $("emailOtpEmail").value = email;
                $("loginForm").classList.add("hidden");
                $("registerForm").classList.add("hidden");
                $("emailOtpForm").classList.remove("hidden");
                $("emailOtpDestination").textContent =
                    `Registration code sent to ${state.pendingEmailOtpMaskedEmail}.`;
                setMessage(
                    "emailOtpMessage",
                    "Enter the 6-digit code to verify your email and finish creating your XTECH account.",
                    "success"
                );
                startEmailOtpCountdown();
                $("emailOtpCode").focus();
            } catch (error) {
                state.authFlowInProgress = false;
                setMessage("registerMessage", error.message);
            }
        });

        return Object.freeze({
            showAuthMode,
            setSignInMethod,
            resetSecurityForms,
            restoreEmailOtpSession,
            clearEmailOtpSession,
            startEmailOtpCountdown,
            stopEmailOtpCountdown
        });
    }
    global.XTechAuthUi = Object.freeze({ createAuthUi });
})(typeof window !== "undefined" ? window : globalThis);
