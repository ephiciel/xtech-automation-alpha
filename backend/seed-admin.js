require("dotenv").config();
const { db, auth, Timestamp } = require("./firebase");

(async () => {
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    const name = process.env.ADMIN_NAME || "Business Owner";

    if (!email || !password) {
        console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
        process.exit(1);
    }

    try {
        let user;
        try {
            user = await auth.getUserByEmail(email);
            await auth.updateUser(user.uid, { password, displayName: name });
        } catch (error) {
            if (error.code !== "auth/user-not-found") throw error;
            user = await auth.createUser({ email, password, displayName: name });
        }

        await db.collection("users").doc(user.uid).set(
            {
                uid: user.uid,
                email,
                name,
                role: "admin",
                active: true,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            },
            { merge: true }
        );

        console.log(`Admin ready: ${email}\nUID: ${user.uid}`);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }

    process.exit(0);
})();
