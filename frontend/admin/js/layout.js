// layout.js — the page frame of every admin page (sidebar, top bar, profile
// popup, logout, notification bell). Loaded last on the page, after common.js
// and the page's own script.

// ---- Access check (runs immediately) --------------------------------------------

expireStaleSession();

// Admins log in on the staff login page. Not logged in -> that login page;
// logged in but not an Administrator -> back to the staff portal.
(function enforceAdminPortalAccess() {
  const user = getCurrentUser();
  if (!isLoggedIn() || !user) {
    window.location.href = "/staff/index.html";
    return;
  }
  if (user.role !== "admin") {
    window.location.href = "/staff/reports-dashboard.html";
  }
})();

// ---- Helpers used by admin pages --------------------------------------------------

// The account filters on admin pages only have two groups: citizens and staff
// (Administrators count as staff).
function accountTypeGroup(type) {
  if (type === "Barangay Citizen") return "citizen";
  return "staff";
}

// ---- Notifications ----------------------------------------------------------------
// Two kinds, each can be switched on/off with checkboxes in the bell dropdown:
//   - new account verification requests (on by default)
//   - new audit log entries (off by default)

const notificationStore = createNotificationStore("orms_admin_notifications", 20);
const ADMIN_NOTIF_PREFS_KEY = "orms_admin_notif_prefs";
const NOTIF_SEEN_VERIFICATIONS_KEY = "orms_admin_seen_verification_ids";
const NOTIF_SEEN_LOGINS_KEY = "orms_admin_seen_login_ids";

// Other admin pages call this to add a notification (link is optional).
function addAdminNotification(message, link) {
  notificationStore.add(message, link);
}

function getNotifPrefs() {
  try {
    return { verifications: true, auditLogs: false, ...JSON.parse(localStorage.getItem(ADMIN_NOTIF_PREFS_KEY)) };
  } catch {
    return { verifications: true, auditLogs: false };
  }
}

function setNotifPrefs(prefs) {
  localStorage.setItem(ADMIN_NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

// The ids already seen, or null the first time (then nothing is notified, so
// switching a kind on doesn't flood the bell with every existing item).
function getSeenIds(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function setSeenIds(key, ids) {
  localStorage.setItem(key, JSON.stringify(ids.slice(0, 200)));
}

// Returns how many new pending accounts were found.
async function checkForNewVerifications() {
  if (!getNotifPrefs().verifications) return 0;

  let list;
  try {
    const res = await authFetch("/api/auth/admin/verifications/");
    if (!res.ok) return 0;
    list = await res.json();
  } catch {
    return 0;
  }

  const currentIds = list.map((v) => v.id);
  const seen = getSeenIds(NOTIF_SEEN_VERIFICATIONS_KEY);
  if (seen === null) {
    setSeenIds(NOTIF_SEEN_VERIFICATIONS_KEY, currentIds);
    return 0;
  }

  const newOnes = list.filter((v) => !seen.includes(v.id));
  newOnes.forEach((v) => notificationStore.add(`New account verification request from ${v.owner}`, "approve-accounts.html"));
  setSeenIds(NOTIF_SEEN_VERIFICATIONS_KEY, currentIds);
  return newOnes.length;
}

async function checkForNewAuditLogs() {
  if (!getNotifPrefs().auditLogs) return;

  let list;
  try {
    const res = await authFetch("/api/auth/admin/audit-logs/");
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  const recent = list.slice(0, 50); // only the newest entries matter
  const currentIds = recent.map((l) => l.id);
  const seen = getSeenIds(NOTIF_SEEN_LOGINS_KEY);
  if (seen === null) {
    setSeenIds(NOTIF_SEEN_LOGINS_KEY, currentIds);
    return;
  }

  recent
    .filter((l) => !seen.includes(l.id))
    .forEach((l) => notificationStore.add(`${l.owner} (${l.type}) logged in at ${l.loggedOnLabel}`, "audit-logs.html"));
  setSeenIds(NOTIF_SEEN_LOGINS_KEY, Array.from(new Set(currentIds.concat(seen))));
}

// The two checkboxes added under the bell dropdown's header.
function addNotificationPrefs(dropdown, render) {
  const prefsRow = document.createElement("div");
  prefsRow.className = "notif-dropdown__prefs";
  prefsRow.innerHTML = `
      <label class="notif-dropdown__pref-label">
        <input type="checkbox" id="notifPrefVerifications" />
        New account verifications
      </label>
      <label class="notif-dropdown__pref-label">
        <input type="checkbox" id="notifPrefAuditLogs" />
        New action logs
      </label>
    `;
  prefsRow.addEventListener("click", (e) => e.stopPropagation()); // keep the dropdown open
  dropdown.querySelector(".notif-dropdown__header").insertAdjacentElement("afterend", prefsRow);

  const prefVerifications = prefsRow.querySelector("#notifPrefVerifications");
  const prefAuditLogs = prefsRow.querySelector("#notifPrefAuditLogs");
  const prefs = getNotifPrefs();
  prefVerifications.checked = prefs.verifications;
  prefAuditLogs.checked = prefs.auditLogs;

  prefVerifications.addEventListener("change", () => {
    setNotifPrefs({ ...getNotifPrefs(), verifications: prefVerifications.checked });
    checkForNewVerifications().then(render);
  });
  prefAuditLogs.addEventListener("change", () => {
    setNotifPrefs({ ...getNotifPrefs(), auditLogs: prefAuditLogs.checked });
    checkForNewAuditLogs().then(render);
  });
}

// ---- Page setup -----------------------------------------------------------------

// Sidebar ☰ button. On small screens (≤900px) the sidebar slides in over the
// page with a dark backdrop; on large screens it just hides/shows.
function wireSidebar() {
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebar = document.querySelector(".admin-sidebar");
  const shell = document.querySelector(".admin-shell");
  if (!sidebarToggle || !sidebar || !shell) return;

  const backdrop = document.createElement("div");
  backdrop.className = "admin-sidebar-backdrop";
  shell.appendChild(backdrop);
  const isSmallScreen = () => window.matchMedia("(max-width: 900px)").matches;

  const closeSidebar = () => {
    sidebar.classList.remove("is-collapsed");
    backdrop.classList.remove("is-visible");
  };

  sidebarToggle.addEventListener("click", () => {
    const isOpening = !sidebar.classList.contains("is-collapsed");
    sidebar.classList.toggle("is-collapsed");
    if (isSmallScreen()) backdrop.classList.toggle("is-visible", isOpening);
  });
  backdrop.addEventListener("click", closeSidebar);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSidebar();
  });
  sidebar.querySelectorAll(".admin-sidebar__nav a").forEach((link) => {
    link.addEventListener("click", () => {
      if (isSmallScreen()) closeSidebar();
    });
  });

  // Collapsible sidebar groups (Account Management, Activity, Setup).
  document.querySelectorAll(".admin-sidebar__group-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const subnav = toggle.nextElementSibling;
      if (!subnav) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      subnav.hidden = expanded;
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setFavicon("/shared/images/logo.png");
  applySiteBranding();
  setupPasswordVisibilityToggles();
  setupPasswordHints();
  wireSidebar();

  // Top bar and profile popup show the logged-in user.
  const user = getCurrentUser();
  if (user) {
    document.querySelectorAll(".admin-topbar__name strong").forEach((el) => {
      el.textContent = user.name;
    });
    document.querySelectorAll(".admin-topbar__avatar").forEach((el) => renderAvatar(el, user));
    const cardName = document.getElementById("profileCardName");
    if (cardName) cardName.textContent = user.name;
    renderAvatar(document.getElementById("profileCardInitials"), user);
  }

  const profileBtn = document.getElementById("profileBtn");
  const profileModal = document.getElementById("profileModal");
  if (profileBtn && profileModal) {
    profileBtn.addEventListener("click", () => {
      profileModal.hidden = false;
    });
  }

  // Logout: the sidebar button and the profile popup's button both ask first.
  const logoutConfirmModal = document.getElementById("logoutConfirmModal");
  const logoutYes = document.getElementById("logoutYes");
  const logoutNo = document.getElementById("logoutNo");
  [document.getElementById("logoutBtn"), document.getElementById("profileLogoutBtn")].forEach((btn) => {
    if (btn && logoutConfirmModal) {
      btn.addEventListener("click", () => {
        if (profileModal) profileModal.hidden = true;
        logoutConfirmModal.hidden = false;
      });
    }
  });
  if (logoutYes) {
    logoutYes.addEventListener("click", async () => {
      try {
        await authFetch("/api/auth/logout/", { method: "POST" }); // records the logout time
      } catch {
        // logging out locally still happens
      }
      logOut();
      window.location.href = "/staff/index.html";
    });
  }
  if (logoutNo) {
    logoutNo.addEventListener("click", () => {
      logoutConfirmModal.hidden = true;
    });
  }

  // Closing pop-ups (except [data-modal-guarded] ones, which close themselves).
  document.querySelectorAll(".modal-overlay:not([data-modal-guarded])").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const overlay = btn.closest(".modal-overlay");
      if (!overlay.hasAttribute("data-modal-guarded")) overlay.hidden = true;
    });
  });

  // Notification bell. A new verification request opens the dropdown and
  // flashes the bell; new log entries only update the badge. Checks every 30 seconds.
  const bell = setupNotificationBell(notificationStore);
  if (bell) {
    addNotificationPrefs(bell.dropdown, bell.render);
    const poll = () =>
      Promise.all([checkForNewVerifications(), checkForNewAuditLogs()]).then(([newVerifications]) => {
        bell.render();
        if (newVerifications > 0) bell.open();
      });
    poll();
    setInterval(poll, 30000);
  }
});
