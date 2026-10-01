// Enables Firebase TOTP multi-factor authentication for the XTECH project
const { auth } = require("../backend/firebase");

async function enableTotp() {
    try {
        await auth.projectConfigManager().updateProjectConfig({
            multiFactorConfig: {
                providerConfigs: [
                    {
                        state: "ENABLED",
                        totpProviderConfig: {
                            adjacentIntervals: 1
                        }
                    }
                ]
            }
        });

        console.log("TOTP MFA is enabled for XTECH Automation.");
        console.log("Make sure Firebase Authentication with Identity Platform is enabled in the Firebase console.");
    } catch (error) {
        console.error("Could not enable TOTP MFA:", error.message);
        console.error("Upgrade Firebase Authentication to Identity Platform first, then run this command again.");
        process.exit(1);
    }
}

enableTotp();
