// layout.js — the page frame of every logged-in staff page (sidebar, top bar,
// profile popup, logout, notification bell). Loaded last on the page, after
// common.js, staff-nav.js and the page's own script.

// ---- Access checks (run immediately, before the page finishes loading) ------

expireStaleSession();

// Only a logged-in Barangay Official may use the staff pages.
(function enforceStaffPortalAccess() {
  const user = getCurrentUser();
  if (!isLoggedIn() || !user || user.role !== "staff") {
    window.location.href = "/staff/index.html";
  }
})();

// Hides the sidebar links this position can't use, and sends the user away
// from a page they aren't allowed to open (to their first allowed page).
(function enforceStaffSectionAccess() {
  const user = getCurrentUser();
  if (!user) return;
  hideStaffNavLinks();

  const allowedPages = allowedStaffPages(user);
  const currentPage = window.location.pathname.split("/").pop();
  if (hasNavEntry(currentPage) && !allowedPages.includes(currentPage)) {
    // questions.html is a safe fallback (and avoids a redirect loop for an
    // account without a known position).
    const target = allowedPages[0] || "questions.html";
    if (target !== currentPage) window.location.href = target;
  }
})();

// ---- Helpers used by staff pages ----------------------------------------------

// The file name the server gave a download (Content-Disposition header).
function filenameFromResponse(response, fallback) {
  const header = response.headers.get("Content-Disposition") || "";
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

// ---- Notifications --------------------------------------------------------------
// New reports and new concerns/suggestions. Saved per staff member (the key
// ends with the user's id), so two people sharing a browser don't see each
// other's notifications.

function staffNotifKey(base) {
  const user = getCurrentUser();
  return `${base}_${user && user.id != null ? user.id : "anon"}`;
}

const notificationStore = createNotificationStore(staffNotifKey("orms_staff_notifications"), 20);
const NOTIF_SEEN_REPORTS_KEY = staffNotifKey("orms_staff_seen_report_ids");
const NOTIF_SEEN_CONCERNS_KEY = staffNotifKey("orms_staff_seen_concern_ids");

// The ids already seen, or null the very first time (then nothing is notified,
// so a new staff member isn't flooded with every existing item).
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

// Fetches `url` and adds a notification for every item not seen before.
// Returns how many new items there were.
async function notifyNewItems(url, seenKey, makeNotification) {
  let list;
  try {
    const res = await authFetch(url);
    if (!res.ok) return 0;
    list = await res.json();
  } catch {
    return 0;
  }

  const currentIds = list.map((item) => item.id);
  const seen = getSeenIds(seenKey);
  if (seen === null) {
    setSeenIds(seenKey, currentIds);
    return 0;
  }

  const fresh = list.filter((item) => !seen.includes(item.id));
  fresh.forEach((item) => notificationStore.add(...makeNotification(item)));
  setSeenIds(seenKey, currentIds);
  return fresh.length;
}

function checkForNewReports() {
  return notifyNewItems("/api/reports/staff/", NOTIF_SEEN_REPORTS_KEY, (r) => [
    `New report submitted by ${r.reporter}: ${r.ordinance}`,
    `report-detail.html?id=${r.id}`,
  ]);
}

function checkForNewConcerns() {
  return notifyNewItems("/api/concerns/staff/", NOTIF_SEEN_CONCERNS_KEY, (c) => [
    `New concern/suggestion submitted by ${c.reporter}`,
    `concern-detail.html?id=${c.id}`,
  ]);
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

  // Collapsible sidebar groups (e.g. Reports).
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

  // Logout: the sidebar button and the profile popup's button both ask first.
  const logoutConfirmModal = document.getElementById("logoutConfirmModal");
  [document.getElementById("logoutBtn"), document.getElementById("profileLogoutBtn")].forEach((btn) => {
    if (btn && logoutConfirmModal) {
      btn.addEventListener("click", () => {
        const profileModal = document.getElementById("profileModal");
        if (profileModal) profileModal.hidden = true;
        logoutConfirmModal.hidden = false;
      });
    }
  });
  const logoutYes = document.getElementById("logoutYes");
  const logoutNo = document.getElementById("logoutNo");
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

  // Top bar and profile popup show the logged-in user.
  const user = getCurrentUser();
  if (user) {
    fillStaffTopbar();
    document.querySelectorAll(".admin-topbar__avatar").forEach((el) => renderAvatar(el, user));
    const cardName = document.getElementById("profileCardName");
    if (cardName) cardName.textContent = user.name;
    const cardRole = document.getElementById("profileCardRole");
    if (cardRole) cardRole.textContent = user.position || "Barangay Official";
    renderAvatar(document.getElementById("profileCardInitials"), user);
  }

  const profileBtn = document.getElementById("profileBtn");
  const profileModal = document.getElementById("profileModal");
  if (profileBtn && profileModal) {
    profileBtn.addEventListener("click", () => {
      profileModal.hidden = false;
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

  // Notification bell. Only sections this position can open raise notifications.
  // A brand-new item opens the dropdown and flashes the bell. Checks every 30 seconds.
  const bell = setupNotificationBell(notificationStore);
  if (bell) {
    const position = (getCurrentUser() || {}).position;
    const canSeeReports = STAFF_NAV_ACCESS["reports.html"].includes(position);
    const canSeeConcerns =
      STAFF_NAV_ACCESS["concerns.html"].includes(position) || STAFF_NAV_ACCESS["concerns-dashboard.html"].includes(position);

    const poll = () =>
      Promise.all([
        canSeeReports ? checkForNewReports() : Promise.resolve(0),
        canSeeConcerns ? checkForNewConcerns() : Promise.resolve(0),
      ]).then(([newReports, newConcerns]) => {
        bell.render();
        if (newReports + newConcerns > 0) bell.open();
      });
    poll();
    setInterval(poll, 30000);
  }
});
