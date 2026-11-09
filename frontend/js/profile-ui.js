"use strict";
(function registerXTechProfileUi(global) {
    function createProfileUi(deps) {
        const {
            $,
            api,
            toast,
            setMessage,
            busy,
            validateName,
            validatePhone,
            validateText,
            getCurrentUser
        } = deps;

        // Loads and updates the customer's profile
        // Loads the signed-in customer's profile
        async function loadProfile() {
            const currentUser = getCurrentUser();
            try {
                const data = await api("/api/profile");
                const customer = data.customer;
                $("profileName").value = customer.name || "";
                $("profileEmail").value = customer.email || currentUser?.email || "";
                $("profilePhone").value = customer.phone || "";
                $("profileCompany").value = customer.company || "";
                $("profileAddress").value = customer.address || "";
                setMessage("profileMessage", "");
            } catch (error) {
                setMessage("profileMessage", error.message);
            }
        }

        $("profileForm").addEventListener("submit", async (event) => {
            event.preventDefault();
            setMessage("profileMessage", "");
            try {
                const name = validateName($("profileName").value, "Full name");
                const phone = validatePhone($("profilePhone").value);
                const company = validateText(
                    $("profileCompany").value,
                    "Company / Organization",
                    120
                );
                const address = validateText($("profileAddress").value, "Address", 250);

                await busy(
                    event.submitter,
                    () =>
                        api("/api/profile", {
                            method: "PUT",
                            body: JSON.stringify({ name, phone, company, address })
                        }),
                    "Saving Profile…"
                );
                setMessage("profileMessage", "Profile updated successfully.", "success");
                toast("Profile updated");
            } catch (error) {
                setMessage("profileMessage", error.message);
            }
        });

        return Object.freeze({ loadProfile });
    }
    global.XTechProfileUi = Object.freeze({ createProfileUi });
})(typeof window !== "undefined" ? window : globalThis);
