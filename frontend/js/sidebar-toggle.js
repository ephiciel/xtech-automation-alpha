/* XTECH Automation: compact icon-only sidebar, with remembered preference. */
(() => {
  "use strict";

  const layout = document.querySelector("#app .layout");
  const sidebar = document.querySelector("#app .sidebar");
  if (!layout || !sidebar || document.getElementById("sidebarToggle")) return;

  const STORAGE_KEY = "xtech-sidebar-collapsed";
  const desktop = window.matchMedia("(min-width: 821px)");
  let collapsed = false;
  try {
    collapsed = localStorage.getItem(STORAGE_KEY) === "true";
  } catch (_) {
    // Private browsing/storage restrictions should not prevent navigation.
  }

  sidebar.id = sidebar.id || "xtechSidebar";

  // Preserve the existing .nav elements, data-section values, click listeners,
  // permissions and active states. Only wrap their plain-text labels.
  sidebar.querySelectorAll(".nav").forEach((nav) => {
    const label = nav.textContent.trim();
    if (!label) return;
    if (!nav.querySelector(".sidebar-nav-label") && nav.children.length === 0) {
      const span = document.createElement("span");
      span.className = "sidebar-nav-label";
      span.textContent = label;
      nav.textContent = "";
      nav.appendChild(span);
    }
    if (!nav.hasAttribute("title")) nav.title = label;
    if (!nav.hasAttribute("aria-label")) nav.setAttribute("aria-label", label);
  });

  const heading = document.createElement("div");
  heading.className = "sidebar-toggle-heading";

  const title = document.createElement("span");
  title.className = "sidebar-toggle-title";
  title.textContent = "WORKSPACE";

  const button = document.createElement("button");
  button.id = "sidebarToggle";
  button.className = "sidebar-toggle-button";
  button.type = "button";
  button.setAttribute("aria-controls", sidebar.id);

  const arrow = document.createElement("span");
  arrow.className = "sidebar-toggle-arrow";
  arrow.setAttribute("aria-hidden", "true");
  button.appendChild(arrow);

  heading.append(title, button);
  sidebar.prepend(heading);

  function update() {
    const isCollapsed = collapsed && desktop.matches;
    layout.classList.toggle("sidebar-collapsed", isCollapsed);
    const action = isCollapsed ? "Expand sidebar" : "Collapse sidebar";
    button.setAttribute("aria-label", action);
    button.setAttribute("aria-expanded", String(!isCollapsed));
    button.title = action;
    arrow.textContent = isCollapsed ? "❯" : "❮";
  }

  button.addEventListener("click", () => {
    collapsed = !collapsed;
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)); } catch (_) {}
    update();
  });

  // On mobile, the existing horizontal nav is always shown; desktop preference
  // is restored automatically when the viewport widens again.
  if (desktop.addEventListener) desktop.addEventListener("change", update);
  else desktop.addListener(update); // Older browser compatibility.
  update();
})();
