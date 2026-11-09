"use strict";
(function registerXTechNotificationUi(global) {
    function createNotificationUi(deps) {
        const {
            $,
            api,
            toast,
            esc,
            fmtDateTime,
            getProfile,
            showSection,
            document,
            setInterval,
            clearInterval
        } = deps;
        let notifications = [];
        let notificationPollTimer = null;
        let lastNotificationUnreadCount = 0;
        // Returns the current number of unread customer notifications
        function notificationUnreadCount() {
            return notifications.filter((item) => item.read !== true).length;
        }

        function notificationIcon(type) {
            if (type === "purchase_recorded") return "✓";
            if (type === "pickup_approved") return "⇄";
            if (type === "pickup_completed") return "✓";
            return "•";
        }

        function notificationItemHtml(item) {
            const id = item.id || item.notificationID || "";
            const unread = item.read !== true;
            const reference = item.relatedId
                ? `<span class="notification-reference">Reference: ${esc(item.relatedId)}</span>`
                : "";
            return `<button type="button" class="notification-item ${unread ? "unread" : "read"}" data-notification-id="${esc(id)}">
        <span class="notification-item-icon" aria-hidden="true">${notificationIcon(item.type)}</span>
        <span class="notification-item-body">
            <span class="notification-item-title">${esc(item.title || "XTECH notification")}</span>
            <span class="notification-item-message">${esc(item.message || "")}</span>
            <span class="notification-item-meta">${esc(fmtDateTime(item.createdAt))}${reference}</span>
        </span>
        ${unread ? '<span class="notification-unread-dot" aria-label="Unread"></span>' : ""}
    </button>`;
        }

        function bindNotificationItems(container) {
            if (!container) return;
            container.querySelectorAll("[data-notification-id]").forEach((button) => {
                button.addEventListener("click", async () => {
                    const id = button.dataset.notificationId;
                    if (!id) return;
                    await markNotificationRead(id);
                });
            });
        }

        function renderNotifications() {
            const unread = notificationUnreadCount();
            const badge = $("notificationBadge");
            if (badge) {
                badge.textContent = unread > 99 ? "99+" : String(unread);
                badge.classList.toggle("hidden", unread === 0);
            }

            if ($("notificationMenuSummary")) {
                $("notificationMenuSummary").textContent = unread
                    ? `${unread} unread notification${unread === 1 ? "" : "s"}`
                    : "No unread notifications";
            }

            const menuList = $("notificationMenuList");
            if (menuList) {
                const recent = notifications.slice(0, 5);
                menuList.innerHTML = recent.length
                    ? recent.map(notificationItemHtml).join("")
                    : '<div class="notification-empty">No notifications yet.</div>';
                bindNotificationItems(menuList);
            }

            const pageList = $("notificationPageList");
            if (pageList) {
                pageList.innerHTML = notifications.length
                    ? notifications.map(notificationItemHtml).join("")
                    : '<div class="notification-empty">No purchase or pickup notifications yet.</div>';
                bindNotificationItems(pageList);
            }
        }

        async function loadNotifications({ silent = false, announce = false } = {}) {
            if (getProfile()?.role !== "customer") return;
            try {
                const previousUnread = lastNotificationUnreadCount;
                const data = await api("/api/notifications", { silent });
                notifications = data.notifications || [];
                const unread = notificationUnreadCount();
                renderNotifications();

                if (announce && unread > previousUnread) {
                    const added = unread - previousUnread;
                    toast(
                        added === 1
                            ? "You have a new notification."
                            : `You have ${added} new notifications.`
                    );
                }
                lastNotificationUnreadCount = unread;
            } catch (error) {
                if (!silent) toast(error.message || "Unable to load notifications.");
            }
        }

        async function markNotificationRead(id) {
            const item = notifications.find(
                (notification) => (notification.id || notification.notificationID) === id
            );
            if (!item || item.read === true) return;
            try {
                await api(`/api/notifications/${encodeURIComponent(id)}/read`, {
                    method: "PATCH",
                    silent: true
                });
                item.read = true;
                item.readAt = new Date().toISOString();
                lastNotificationUnreadCount = notificationUnreadCount();
                renderNotifications();
            } catch (error) {
                toast(error.message || "Unable to update notification.");
            }
        }

        async function markAllNotificationsRead() {
            if (!notifications.some((item) => item.read !== true)) return;
            try {
                await api("/api/notifications/read-all", { method: "PATCH", silent: true });
                const readAt = new Date().toISOString();
                notifications.forEach((item) => {
                    item.read = true;
                    item.readAt = readAt;
                });
                lastNotificationUnreadCount = 0;
                renderNotifications();
                toast("All notifications marked as read");
            } catch (error) {
                toast(error.message || "Unable to mark notifications as read.");
            }
        }

        function closeNotificationMenu() {
            $("notificationMenu")?.classList.add("hidden");
            $("notificationBell")?.setAttribute("aria-expanded", "false");
        }

        function stopNotificationPolling() {
            if (notificationPollTimer) clearInterval(notificationPollTimer);
            notificationPollTimer = null;
        }

        function startNotificationPolling() {
            stopNotificationPolling();
            if (getProfile()?.role !== "customer") return;
            notificationPollTimer = setInterval(() => {
                if (!document.hidden) loadNotifications({ silent: true, announce: true });
            }, 30000);
        }

        $("notificationBell")?.addEventListener("click", (event) => {
            event.stopPropagation();
            const menu = $("notificationMenu");
            if (!menu) return;
            const opening = menu.classList.contains("hidden");
            menu.classList.toggle("hidden", !opening);
            $("notificationBell")?.setAttribute("aria-expanded", opening ? "true" : "false");
            if (opening) loadNotifications({ silent: true });
        });

        $("notificationMenu")?.addEventListener("click", (event) => event.stopPropagation());
        $("markAllNotificationsReadTop")?.addEventListener("click", markAllNotificationsRead);
        $("markAllNotificationsRead")?.addEventListener("click", markAllNotificationsRead);
        $("refreshNotifications")?.addEventListener("click", () => loadNotifications());
        $("viewAllNotifications")?.addEventListener("click", () => {
            closeNotificationMenu();
            showSection("notifications");
        });
        document.addEventListener("click", closeNotificationMenu);
        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && getProfile()?.role === "customer")
                loadNotifications({ silent: true, announce: true });
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeNotificationMenu();
        });

        function resetNotifications() {
            notifications = [];
            lastNotificationUnreadCount = 0;
            stopNotificationPolling();
            closeNotificationMenu();
            renderNotifications();
        }

        return Object.freeze({
            notificationUnreadCount,
            renderNotifications,
            loadNotifications,
            markNotificationRead,
            markAllNotificationsRead,
            closeNotificationMenu,
            startNotificationPolling,
            stopNotificationPolling,
            resetNotifications
        });
    }
    global.XTechNotificationUi = Object.freeze({ createNotificationUi });
})(typeof window !== "undefined" ? window : globalThis);
