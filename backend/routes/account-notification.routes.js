"use strict";

/** Register the existing account profile and customer notification API routes.
 * Dependencies are injected so the routes are testable without live Firebase.
 */
function registerAccountNotificationRoutes(app, deps) {
    const { authRequired, roles, serialize, notificationCollectionFor, now } = deps;

/* AUTH + ACCOUNT MANAGEMENT */
app.get("/api/auth/me", authRequired, (req, res) => {
    res.json({ success: true, user: serialize(req.user), profile: serialize(req.profile) });
});


/* CUSTOMER NOTIFICATIONS */
app.get("/api/notifications", authRequired, roles("customer"), async (req, res) => {
    try {
        const snapshot = await notificationCollectionFor(req.user.uid)
            .orderBy("createdAt", "desc")
            .limit(100)
            .get();
        const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...serialize(doc.data()) }));
        res.json({
            success: true,
            notifications,
            unreadCount: notifications.filter(item => item.read !== true).length
        });
    } catch (error) {
        console.error("Notification load error:", error?.message || error);
        res.status(500).json({ success: false, message: "Unable to load notifications." });
    }
});

app.patch("/api/notifications/read-all", authRequired, roles("customer"), async (req, res) => {
    try {
        const snapshot = await notificationCollectionFor(req.user.uid).get();
        const timestamp = now();
        const unreadDocs = snapshot.docs.filter(doc => doc.data().read !== true);
        await Promise.all(unreadDocs.map(doc => doc.ref.update({ read: true, readAt: timestamp })));
        res.json({ success: true, updated: unreadDocs.length });
    } catch (error) {
        console.error("Notification read-all error:", error?.message || error);
        res.status(500).json({ success: false, message: "Unable to mark notifications as read." });
    }
});

app.patch("/api/notifications/:id/read", authRequired, roles("customer"), async (req, res) => {
    try {
        const ref = notificationCollectionFor(req.user.uid).doc(req.params.id);
        const snapshot = await ref.get();
        if (!snapshot.exists) {
            return res.status(404).json({ success: false, message: "Notification not found." });
        }
        if (snapshot.data().read !== true) {
            await ref.update({ read: true, readAt: now() });
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Notification read error:", error?.message || error);
        res.status(500).json({ success: false, message: "Unable to update notification." });
    }
});
}

module.exports = { registerAccountNotificationRoutes };
