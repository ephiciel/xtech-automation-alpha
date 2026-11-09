"use strict";
// Stage 4.44: lifecycle controller for one-time boot, auth-observer dispatch, and cleanup.
// Authentication identity and MFA state remain owned by the existing app/auth modules.
(function registerAppLifecycle(global) {
    function createAppLifecycle(deps) {
        const {
            prepareAuthScreen,
            initFirebase,
            registerAuthObserver,
            onSignedIn,
            onSignedOut,
            onSignedInError,
            onStartupError
        } = deps;

        let startPromise = null;
        let unsubscribe = null;
        let started = false;
        let stopped = false;

        async function handleAuthState(user, auth) {
            if (stopped) return;
            if (!user) {
                onSignedOut();
                return;
            }
            try {
                await onSignedIn(user);
            } catch (error) {
                if (!stopped) await onSignedInError(error, auth);
            }
        }

        // Safe when called twice: exactly one auth observer is registered.
        function start() {
            if (stopped) return Promise.resolve(false);
            if (startPromise) return startPromise;

            try {
                prepareAuthScreen();
            } catch (error) {
                onStartupError(error);
                return Promise.resolve(false);
            }

            startPromise = (async () => {
                try {
                    const auth = await initFirebase();
                    if (stopped) return false;
                    const subscription = registerAuthObserver(auth, (user) =>
                        handleAuthState(user, auth)
                    );
                    if (typeof subscription === "function") unsubscribe = subscription;
                    started = true;
                    return true;
                } catch (error) {
                    startPromise = null;
                    onStartupError(error);
                    return false;
                }
            })();
            return startPromise;
        }

        // Explicit lifecycle disposal, useful for safe future navigation/teardown.
        // This does not sign out Firebase users or change session credentials.
        function stop() {
            if (stopped) return;
            stopped = true;
            started = false;
            if (unsubscribe) {
                const release = unsubscribe;
                unsubscribe = null;
                release();
            }
        }

        return Object.freeze({
            start,
            stop,
            get isStarted() {
                return started;
            }
        });
    }

    global.XTechAppLifecycle = Object.freeze({ createAppLifecycle });
})(window);
