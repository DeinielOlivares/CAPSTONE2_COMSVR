// Barangay Platero OVRMS — shared behavior for admin pages (sidebar toggle + logout).

// ---- Skeleton loading placeholders (see .skeleton* in style.css) ----
// Used in place of a bare "Loading..." string so a slow connection shows
// something that already roughly matches the real layout, instead of a
// layout jump once data arrives.

// `count` <tr> rows for a <tbody>, each with `columns` cells containing a
// shimmering bar.
function skeletonTableRows(count, columns) {
  const row = `<tr>${Array.from({ length: columns }, () => `<td><span class="skeleton skeleton-text"></span></td>`).join("")}</tr>`;
  return Array.from({ length: count }).fill(row).join("");
}

// `count` card-style blocks for a simple list container — two bars each,
// standing in for a title line and a shorter meta line underneath it.
function skeletonCards(count) {
  const card = `
    <div class="skeleton-card">
      <span class="skeleton skeleton-text skeleton-text--medium"></span>
      <span class="skeleton skeleton-text skeleton-text--short"></span>
    </div>`;
  return Array.from({ length: count }).fill(card).join("");
}

const ADMIN_AUTH_STORAGE_KEY = "orms_auth_user";
const ADMIN_ACCESS_TOKEN_KEY = "orms_access_token";
const ADMIN_REFRESH_TOKEN_KEY = "orms_refresh_token";

// Same "Stay signed in" scheme as main.js's (see that file for the full
// explanation) — duplicated here since admin.js and main.js are never
// loaded on the same page. Login itself (main.js, on index.html) is what
// actually sets REMEMBER_KEY/LOGIN_AT_KEY; every other staff page just
// needs to read the same bucket consistently, which is what this getter is for.
const ADMIN_REMEMBER_KEY = "orms_remember_me";
const ADMIN_LOGIN_AT_KEY = "orms_login_at";
const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function adminAuthStorage() {
  return localStorage.getItem(ADMIN_REMEMBER_KEY) === "1" ? localStorage : sessionStorage;
}

function adminLogOut() {
  [localStorage, sessionStorage].forEach((store) => {
    store.removeItem(ADMIN_AUTH_STORAGE_KEY);
    store.removeItem(ADMIN_ACCESS_TOKEN_KEY);
    store.removeItem(ADMIN_REFRESH_TOKEN_KEY);
    store.removeItem(ADMIN_LOGIN_AT_KEY);
  });
  localStorage.removeItem(ADMIN_REMEMBER_KEY);
}

// Clears a stale (past its 1-day cap) non-remembered session before
// enforceStaffPortalAccess below checks it — a remembered session skips
// this and instead lasts until the refresh token itself expires (7 days
// server-side), which authFetch's refresh-on-401 handling surfaces as a
// normal logout when it finally fails.
function expireStaleAdminSession() {
  if (localStorage.getItem(ADMIN_REMEMBER_KEY) === "1") return;
  const loginAt = Number(sessionStorage.getItem(ADMIN_LOGIN_AT_KEY));
  if (loginAt && Date.now() - loginAt > ADMIN_SESSION_MAX_AGE_MS) {
    adminLogOut();
  }
}
expireStaleAdminSession();

// This script is only ever loaded by pages inside /staff/, so the portal is
// fixed. Every page that loads admin.js is a logged-in-only page (the
// login/forgot-password/reset pages load main.js instead), so bounce back
// to the login page unless there's a valid token AND the cached user is
// actually a Barangay Official — otherwise an Administrator's (or a stale/
// leftover) session could land straight on the Staff Portal unchecked.
function getAdminUser() {
  try {
    return JSON.parse(adminAuthStorage().getItem(ADMIN_AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

// After a dropdown panel becomes visible, nudge its inline position so it
// stays within the viewport on both sides. Resets any previous inline
// adjustment first so the CSS default is the measurement baseline.
function positionDropdown(el) {
  el.style.left = "";
  el.style.right = "";
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth;
  if (rect.right > vw - 4) {
    el.style.left = "auto";
    el.style.right = "0";
  } else if (rect.left < 4) {
    el.style.left = "0";
    el.style.right = "auto";
  }
}

// Wires a ".filters-dropdown" trigger+panel pair (sort/filter/page-size
// controls behind a single "Order" button — see style.css's .filters-dropdown
// rules). Each page with one calls this once with its own #filtersToggleBtn/
// #filtersPanel; the controls inside the panel (real <select>s) keep their
// own existing "change" listeners untouched.
function wireFiltersDropdown(toggleBtn, panel) {
  if (!toggleBtn || !panel) return;

  function closePanel() {
    panel.hidden = true;
    toggleBtn.setAttribute("aria-expanded", "false");
  }

  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggleBtn.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) positionDropdown(panel);
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== toggleBtn) closePanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) closePanel();
  });

  // Resets every select in the panel back to its original default option
  // (the one marked `selected` in the HTML, or the first option otherwise)
  // and re-fires each one's own change handling, so the page's list goes
  // back to its default order/filter.
  const clearBtn = panel.querySelector(".filters-dropdown__clear");
  if (clearBtn) {
    const defaults = Array.from(panel.querySelectorAll("select")).map((select) => {
      const defaultOption = select.querySelector("option[selected]") || select.options[0];
      return { select, value: defaultOption ? defaultOption.value : "" };
    });
    clearBtn.addEventListener("click", () => {
      defaults.forEach(({ select, value }) => {
        if (select.value === value) return;
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }
}

// Remembers a page's filters, search and page number for the rest of this
// browser tab, so opening an item and coming back (or visiting other pages)
// shows the page the way it was left. Kept per signed-in user and per page;
// sessionStorage, so a fresh tab starts from the defaults.
function createFilterMemory(name) {
  const user = getAdminUser();
  const key = `orms_filters_${(user && user.id) || "anon"}_${name}`;
  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(key)) || {};
  } catch {
    saved = {};
  }
  function set(field, value) {
    saved[field] = value;
    try {
      sessionStorage.setItem(key, JSON.stringify(saved));
    } catch {
      // Storage unavailable (private mode, blocked) — filters just won't persist.
    }
  }
  return {
    get(field, fallback) {
      return Object.prototype.hasOwnProperty.call(saved, field) ? saved[field] : fallback;
    },
    set,
    // Puts back a <select>'s saved choice (only if that option still
    // exists) and saves every later change.
    bindSelect(select, field) {
      if (!select) return;
      const name = field || select.id;
      const value = saved[name];
      if (value !== undefined && Array.from(select.options).some((o) => o.value === value)) select.value = value;
      select.addEventListener("change", () => set(name, select.value));
    },
  };
}

// A "Show" select's value as a page size (null = All).
function pageSizeFrom(select, fallback) {
  if (!select) return fallback;
  return select.value === "all" ? null : Number(select.value) || fallback;
}

// Whether anything editable in the form differs from how the page loaded it
// (typed text, a picked option or date, a ticked box, an attached file).
function formHasEntries(form) {
  return Array.from(form.elements).some((el) => {
    if (el.disabled || el.readOnly) return false;
    if (el.type === "file") return el.files.length > 0;
    if (el.type === "checkbox" || el.type === "radio") return el.checked !== el.defaultChecked;
    if (el.tagName === "SELECT") {
      // Options filled in by script have no default — the first one is it.
      const initial = Array.from(el.options).find((o) => o.defaultSelected) || el.options[0];
      return !!initial && el.value !== initial.value;
    }
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      if (["button", "submit", "reset", "hidden"].includes(el.type)) return false;
      return el.value.trim() !== el.defaultValue.trim();
    }
    return false;
  });
}

// Asks "Save Changes?" (the same popup as My Profile's) before leaving a
// form that has something entered in it: Save Changes runs the form's own
// submit, Discard Changes leaves anyway, Cancel stays on the page. Covers
// every link on the page (Cancel, sidebar, navbar) and — through the
// browser's own prompt — closing the tab or pressing Back. isDirty defaults
// to formHasEntries(form). Call allowLeave() right before the page moves on
// by itself (e.g. after a successful submit).
function guardUnsavedForm(form, isDirty) {
  const hasChanges = isDirty || (() => formHasEntries(form));
  let leaving = false;
  let pendingHref = null;

  const modal = document.createElement("div");
  modal.className = "modal-overlay";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal-card">
      <h2>Save Changes?</h2>
      <p class="auth-card__subtitle">You have entered details that haven't been submitted yet.</p>
      <div class="stacked-buttons">
        <button type="button" class="btn" data-unsaved="save">Save Changes</button>
        <button type="button" class="btn btn-muted" data-unsaved="discard">Discard Changes</button>
        <button type="button" class="btn btn-danger" data-unsaved="cancel">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.addEventListener("click", (e) => {
    const action = e.target.closest("[data-unsaved]")?.dataset.unsaved;
    if (e.target === modal || action === "cancel") {
      modal.hidden = true;
    } else if (action === "save") {
      modal.hidden = true;
      form.requestSubmit();
    } else if (action === "discard") {
      modal.hidden = true;
      leaving = true;
      window.location.href = pendingHref;
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.closest("#logoutYes")) {
      // Logging out already asked "Continue to Logout?".
      leaving = true;
      return;
    }
    if (leaving || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = e.target.closest("a[href]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (!hasChanges()) return;
    e.preventDefault();
    pendingHref = link.href;
    modal.hidden = false;
  });

  window.addEventListener("beforeunload", (e) => {
    if (leaving || !hasChanges()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  return {
    allowLeave() {
      leaving = true;
    },
  };
}

(function enforceStaffPortalAccess() {
  const user = getAdminUser();
  const hasToken = !!adminAuthStorage().getItem(ADMIN_ACCESS_TOKEN_KEY);
  if (!hasToken || !user || user.role !== "staff") {
    window.location.href = "/staff/index.html";
  }
})();

// ---- Role-based section access ----
// Each Barangay Staff role sees a different slice of the Staff Portal:
// Barangay Captain gets read-only dashboards + Ordinances + Questions,
// Secretary gets Concerns/Suggestions + Ordinances + Questions, Barangay
// Treasurer gets Ordinances (managing the resolutions in it) + Questions,
// with Ordinances as their landing page since they have no dashboard, Investigator
// gets Reports (claim/work reports — see reports-list.js) + a read-only
// Ordinances (citing one is part of filing/reviewing a report) + Questions.
// Detail pages reached by navigating from an allowed page (report-detail.html
// etc.) aren't restricted here — what changes per role there is only which
// edit controls show (see report-detail.js/concern-detail.js/
// ordinance-detail.js's own role checks), not access to the page itself.
const STAFF_NAV_ACCESS = {
  // Each role's own overview dashboard is listed first so it's also the
  // first entry in allowedPages below — enforceStaffSectionAccess uses that
  // as the redirect target for a page the current role can't see, which is
  // what makes it the landing page after login (see main.js's
  // STAFF_POSITION_HOME, kept in sync with this).
  "investigator-dashboard.html": ["Investigator"],
  "reports-dashboard.html": ["Barangay Captain"],
  // Opened from the Reports Dashboard's heatmap card rather than the sidebar.
  "geo-analysis.html": ["Barangay Captain"],
  // Barangay Captain gets read-only Reports too — the Reports Dashboard's
  // Recent Reports table (their only path to an individual report's detail
  // page) was removed in favor of showing the charts up top, so this is now
  // how they reach report-detail.html (report-detail.js's own role check
  // keeps them read-only there, same as Ordinances).
  "reports.html": ["Investigator", "Barangay Captain"],
  // Sidebar-only entries for the Reports group's role-specific subpages
  // (same page, filtered — see reports-list.js's REPORT_VIEWS); a subpage
  // link without its own entry (Unclaimed Reports) falls under its page's.
  "reports.html?view=mine": ["Investigator"],
  "reports.html?view=others": ["Investigator"],
  "reports.html?view=claimed": ["Barangay Captain"],
  "concerns-dashboard.html": ["Barangay Captain"],
  "secretary-dashboard.html": ["Secretary"],
  // Barangay Captain gets read-only Concerns/Suggestions too, same pattern
  // as Reports above — concerns-list.js and concern-detail.js hide every
  // editing/category-management control for anyone but the Secretary.
  "concerns.html": ["Secretary", "Barangay Captain"],
  "ordinances.html": ["Barangay Captain", "Secretary", "Investigator"],
  "questions.html": ["Barangay Captain", "Secretary", "Investigator"],
  "announcements.html": ["Barangay Captain", "Secretary"],
};

(function enforceStaffSectionAccess() {
  const user = getAdminUser();
  if (!user) return; // enforceStaffPortalAccess above already redirects away in this case

  const allowedPages = Object.keys(STAFF_NAV_ACCESS).filter((page) =>
    STAFF_NAV_ACCESS[page].includes(user.position)
  );

  document.querySelectorAll(".admin-sidebar__nav a[href]").forEach((link) => {
    let page = link.getAttribute("href");
    if (!Object.prototype.hasOwnProperty.call(STAFF_NAV_ACCESS, page)) page = page.split("?")[0];
    if (Object.prototype.hasOwnProperty.call(STAFF_NAV_ACCESS, page) && !allowedPages.includes(page)) {
      const item = link.closest("li");
      if (item) item.hidden = true;
    }
  });
  // A sidebar group with none of its subpages left visible goes too.
  document.querySelectorAll(".admin-sidebar__group").forEach((group) => {
    if (!group.querySelector(".admin-sidebar__subnav li:not([hidden])")) group.hidden = true;
  });

  const currentPage = window.location.pathname.split("/").pop();
  if (Object.prototype.hasOwnProperty.call(STAFF_NAV_ACCESS, currentPage) && !allowedPages.includes(currentPage)) {
    // questions.html is every recognized role's fallback, since all 3 can
    // see it — but an account with no position set (or one that doesn't
    // match Barangay Captain/Secretary/Investigator) has an empty
    // allowedPages too, which would make this redirect target itself and
    // loop forever. Guard against that rather than assuming a valid role.
    const target = allowedPages[0] || "questions.html";
    if (target !== currentPage) window.location.href = target;
  }
})();

// Silently refreshes the access token using the refresh token, same as
// main.js's — see that file for the full explanation of why this matters
// (without it, the 1hr access-token lifetime would make a "day-long"
// session break every hour instead).
async function refreshAdminAccessToken() {
  const refreshToken = adminAuthStorage().getItem(ADMIN_REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  try {
    const response = await fetch("/api/auth/refresh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    const store = adminAuthStorage();
    store.setItem(ADMIN_ACCESS_TOKEN_KEY, data.access);
    if (data.refresh) store.setItem(ADMIN_REFRESH_TOKEN_KEY, data.refresh);
    return true;
  } catch {
    return false;
  }
}

// Attaches the stored JWT to a fetch call. Same helper as main.js's
// authFetch (duplicated here rather than shared, since admin.js and
// main.js are never loaded on the same page). Every authenticated staff
// API call should go through this.
async function authFetch(path, options = {}) {
  const token = adminAuthStorage().getItem(ADMIN_ACCESS_TOKEN_KEY);
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && (await refreshAdminAccessToken())) {
    const retryHeaders = {
      ...(options.headers || {}),
      Authorization: `Bearer ${adminAuthStorage().getItem(ADMIN_ACCESS_TOKEN_KEY)}`,
    };
    return fetch(path, { ...options, headers: retryHeaders });
  }
  return response;
}

// The server names downloaded files with a date (or date range) baked in —
// see reports/views.py's PDF-download views — but a blob: URL (what every
// "download via fetch" flow here uses) ignores Content-Disposition for
// naming; only the <a download> attribute controls the saved filename. So
// that name is read back out of the header here instead of being
// hardcoded a second time on the frontend, which would drift out of sync
// with whatever the backend actually names it.
function filenameFromResponse(response, fallback) {
  const header = response.headers.get("Content-Disposition") || "";
  const match = header.match(/filename="?([^";]+)"?/i);
  return match ? match[1] : fallback;
}

// Shows/clears an inline error message below a form. Same pattern as main.js.
function showFormError(form, message) {
  let errEl = form.querySelector(".form-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.className = "form-error";
    errEl.style.color = "#c0392b";
    errEl.style.marginTop = "0.5rem";
    errEl.style.fontSize = "0.9rem";
    form.appendChild(errEl);
  }
  errEl.textContent = message;
}

function clearFormError(form) {
  const errEl = form.querySelector(".form-error");
  if (errEl) errEl.remove();
}

// Highlights one control red with an inline message underneath it. Same
// pattern as main.js's markFieldInvalid.
function markFieldInvalid(input, message) {
  if (!input) return;
  input.classList.add("field-invalid");
  const field = input.closest(".field") || input.parentElement;
  let errEl = field.querySelector(".field-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.className = "field-error";
    field.appendChild(errEl);
  }
  errEl.textContent = message;
  const clear = () => clearFieldInvalid(input);
  input.addEventListener("input", clear, { once: true });
  input.addEventListener("change", clear, { once: true });
}

function clearFieldInvalid(input) {
  if (!input) return;
  input.classList.remove("field-invalid");
  const field = input.closest(".field") || input.parentElement;
  const errEl = field.querySelector(".field-error");
  if (errEl) errEl.remove();
}

// Submit-time check for a form that has "novalidate" (so the browser's own
// "Please fill out this field" popup never shows): every required, visible
// control that is still empty gets a red outline and a message under it.
// Returns true when nothing is missing. Controls hidden with the `hidden`
// attribute (such as a custom dropdown's backing <select>) are skipped; the
// page checks those itself.
function flagMissingRequired(form) {
  let missing = 0;
  form.querySelectorAll("[required]").forEach((el) => {
    if (el.disabled || el.hidden || el.closest("[hidden]")) return;
    const empty = el.type === "checkbox" ? !el.checked : !String(el.value).trim();
    if (!empty) return;
    markFieldInvalid(el, "Please fill out this field.");
    missing += 1;
  });
  return missing === 0;
}

// Renders a real uploaded profile picture into an avatar container (the
// topbar avatar, the profile popup avatar, etc.) when one exists, falling
// back to initials — used everywhere a placeholder profile picture
// appears, so uploading a photo on My Profile shows up everywhere at once.
function renderAvatar(container, user) {
  if (!container) return;
  if (user && user.profilePicture) {
    container.innerHTML = `<img class="avatar-img" src="${user.profilePicture}" alt="" />`;
  } else if (user && user.initials) {
    container.textContent = user.initials;
  }
}

function accountTypeGroup(type) {
  if (type === "Administrator") return "admin";
  if (type === "Barangay Citizen") return "citizen";
  return "staff";
}

// ---- Notifications (bell icon in the topbar) ----
// New report/concern submissions raise a notification automatically (no
// opt-in — this is core to the job, unlike the Admin portal's broader
// account/login notifications). Stored in localStorage so a notification
// raised on one page is still there after navigating to another. Uses its
// own key, distinct from the Admin portal's "orms_admin_notifications" —
// localStorage is shared across the whole site (same origin regardless of
// /admin/ vs /staff/), so a shared key would have let the two portals'
// notifications leak into each other on any browser used for both. For the
// same reason every key below is also suffixed with the signed-in staff
// member's id — otherwise a Secretary's concern notifications would still be
// sitting in the bell when an Investigator later signs in on that browser.
function staffNotifKey(base) {
  const user = getAdminUser();
  return `${base}_${user && user.id != null ? user.id : "anon"}`;
}

// Pre-per-user keys, shared by every staff account on the browser — dropped
// so their cross-role leftovers don't linger in storage.
["orms_staff_notifications", "orms_staff_seen_report_ids", "orms_staff_seen_concern_ids"].forEach((k) =>
  localStorage.removeItem(k)
);

const STAFF_NOTIFICATIONS_KEY = staffNotifKey("orms_staff_notifications");
const STAFF_NOTIFICATIONS_MAX = 20;

function makeNotifId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getStaffNotifications() {
  let notifications;
  try {
    notifications = JSON.parse(localStorage.getItem(STAFF_NOTIFICATIONS_KEY)) || [];
  } catch {
    notifications = [];
  }
  let backfilled = false;
  notifications = notifications.map((n) => {
    if (n.id) return n;
    backfilled = true;
    return { ...n, id: makeNotifId() };
  });
  if (backfilled) localStorage.setItem(STAFF_NOTIFICATIONS_KEY, JSON.stringify(notifications));
  return notifications;
}

// link (optional) — the page a click on this notification should navigate to.
function addStaffNotification(message, link) {
  const notifications = getStaffNotifications();
  notifications.unshift({ id: makeNotifId(), message, link: link || null, time: Date.now() });
  localStorage.setItem(
    STAFF_NOTIFICATIONS_KEY,
    JSON.stringify(notifications.slice(0, STAFF_NOTIFICATIONS_MAX))
  );
}

function removeStaffNotification(id) {
  const notifications = getStaffNotifications().filter((n) => n.id !== id);
  localStorage.setItem(STAFF_NOTIFICATIONS_KEY, JSON.stringify(notifications));
}

function clearAllStaffNotifications() {
  localStorage.setItem(STAFF_NOTIFICATIONS_KEY, JSON.stringify([]));
}

function timeAgo(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// "Seen" IDs, so polling only raises a notification for reports/concerns
// that showed up *after* this loaded — not a flood of one notification per
// already-existing submission the first time a staff member logs in.
// `null` (vs. an empty array) means "never seeded yet."
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

const NOTIF_SEEN_REPORTS_KEY = staffNotifKey("orms_staff_seen_report_ids");
const NOTIF_SEEN_CONCERNS_KEY = staffNotifKey("orms_staff_seen_concern_ids");

// Polls GET /api/reports/staff/ and raises a notification for any report
// that wasn't there last time this ran. Returns how many were new, so the
// caller can pop the dropdown open for a submission that just came in
// instead of only flipping the badge on (see wiring below).
async function checkForNewReports() {
  let list;
  try {
    const res = await authFetch("/api/reports/staff/");
    if (!res.ok) return 0;
    list = await res.json();
  } catch {
    return 0;
  }

  const currentIds = list.map((r) => r.id);
  const seen = getSeenIds(NOTIF_SEEN_REPORTS_KEY);
  if (seen === null) {
    setSeenIds(NOTIF_SEEN_REPORTS_KEY, currentIds);
    return 0;
  }

  const fresh = list.filter((r) => !seen.includes(r.id));
  fresh.forEach((r) => addStaffNotification(`New report submitted by ${r.reporter}: ${r.ordinance}`, `report-detail.html?id=${r.id}`));
  setSeenIds(NOTIF_SEEN_REPORTS_KEY, currentIds);
  return fresh.length;
}

// Polls GET /api/concerns/staff/ and raises a notification for any concern/
// suggestion that wasn't there last time this ran. Returns how many were new.
async function checkForNewConcerns() {
  let list;
  try {
    const res = await authFetch("/api/concerns/staff/");
    if (!res.ok) return 0;
    list = await res.json();
  } catch {
    return 0;
  }

  const currentIds = list.map((c) => c.id);
  const seen = getSeenIds(NOTIF_SEEN_CONCERNS_KEY);
  if (seen === null) {
    setSeenIds(NOTIF_SEEN_CONCERNS_KEY, currentIds);
    return 0;
  }

  const fresh = list.filter((c) => !seen.includes(c.id));
  fresh.forEach((c) => addStaffNotification(`New concern/suggestion submitted by ${c.reporter}`, `concern-detail.html?id=${c.id}`));
  setSeenIds(NOTIF_SEEN_CONCERNS_KEY, currentIds);
  return fresh.length;
}

// Same password-strength checklist as main.js's — duplicated here since
// admin.js and main.js are never loaded on the same page (My Profile →
// Change Password is the only place on an authenticated staff page that
// needs it). Mirrors the backend's AUTH_PASSWORD_VALIDATORS (see
// orms_backend/settings.py) closely enough to catch obviously-invalid
// passwords client-side.
const ADMIN_COMMON_PASSWORDS = new Set([
  "password", "123456", "12345678", "qwerty", "123456789", "12345",
  "1234567890", "1234567", "password1", "111111", "iloveyou", "1234",
  "abc123", "123123", "qwerty123", "welcome", "admin123", "letmein",
  "monkey123", "login", "princess", "solo123", "starwars", "dragon",
  "passw0rd", "master", "hello123", "freedom", "whatever", "qazwsx",
  "trustno1", "000000", "football", "baseball", "shadow123", "michael1",
  "superman1", "batman123", "charlie1", "jordan23", "harley123",
  "hunter123", "ranger123", "buster123", "soccer123", "hockey123",
  "computer1", "jessica1", "pepper123", "1qaz2wsx", "flower123",
]);

function getPasswordRuleStatus(pw, attrs = {}) {
  const lowerPw = pw.toLowerCase();
  const candidates = [attrs.firstName, attrs.lastName, (attrs.email || "").split("@")[0]].filter(Boolean);
  const tooSimilar = candidates.some((candidate) => {
    const lowerCandidate = candidate.toLowerCase().trim();
    return lowerCandidate.length >= 3 && (lowerPw.includes(lowerCandidate) || lowerCandidate.includes(lowerPw));
  });
  return {
    length: pw.length >= 8,
    lowercase: /[a-z]/.test(pw),
    uppercase: /[A-Z]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
    numeric: pw.length > 0 && !/^\d+$/.test(pw),
    common: pw.length > 0 && !ADMIN_COMMON_PASSWORDS.has(lowerPw),
    similar: pw.length > 0 && !tooSimilar,
  };
}

function getPasswordRequirementError(pw, attrs = {}) {
  const status = getPasswordRuleStatus(pw, attrs);
  if (!status.length) return "Password must be at least 8 characters.";
  if (!status.lowercase) return "Password needs at least 1 lowercase character.";
  if (!status.uppercase) return "Password needs at least 1 uppercase character.";
  if (!status.special) return "Password needs at least 1 special character.";
  if (!status.numeric) return "Password can't be entirely numbers.";
  if (!status.common) return "That password is too common. Please choose a less predictable one.";
  if (!status.similar) return "Password is too similar to your name or email.";
  return null;
}

// Wires live checkbox feedback for every .password-hint list on the page —
// each <li data-rule="..."> ticks its checkbox once that requirement is
// met. Defaults to the form's first password field; a form with more than
// one (Change Password: current/new/confirm) must say which one via
// data-password-field="<id>" on the .password-hint element.
function setupPasswordHints() {
  document.querySelectorAll(".password-hint").forEach((hintList) => {
    const form = hintList.closest("form");
    if (!form) return;
    const passwordField = hintList.dataset.passwordField
      ? document.getElementById(hintList.dataset.passwordField)
      : form.querySelector('input[type="password"]');
    if (!passwordField) return;
    const firstNameField = form.querySelector('[name="first_name"]');
    const lastNameField = form.querySelector('[name="last_name"]');
    const emailField = form.querySelector('[name="email"]');

    // .password-hint--missing-only lists stay hidden until the user submits
    // with requirements unmet, and then only list the unmet ones.
    const missingOnly = hintList.classList.contains("password-hint--missing-only");

    function update() {
      const status = getPasswordRuleStatus(passwordField.value, {
        firstName: firstNameField ? firstNameField.value : "",
        lastName: lastNameField ? lastNameField.value : "",
        email: emailField ? emailField.value : "",
      });
      let allSatisfied = true;
      hintList.querySelectorAll("li[data-rule]").forEach((li) => {
        const satisfied = !!status[li.dataset.rule];
        if (!satisfied) allSatisfied = false;
        li.classList.toggle("is-satisfied", satisfied);
        const checkbox = li.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = satisfied;
      });
      if (missingOnly) {
        hintList.hidden = allSatisfied || hintList.dataset.prompted === undefined;
      }
    }

    if (missingOnly) {
      // Reveal the unmet requirements once the user tries to submit (capture
      // phase, so it runs before the form's own submit handler), and hide
      // the list again when the form is cleared after a successful save.
      form.addEventListener("submit", () => {
        hintList.dataset.prompted = "";
        update();
      }, true);
      form.addEventListener("reset", () => {
        delete hintList.dataset.prompted;
        setTimeout(update);
      });
    }

    [passwordField, firstNameField, lastNameField, emailField].forEach((field) => {
      if (field) field.addEventListener("input", update);
    });
    update();
  });
}

// Same show/hide eye button as main.js's — duplicated here since admin.js
// and main.js are never loaded on the same page. Covers any password input
// on an authenticated staff page.
const ADMIN_EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const ADMIN_EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a16.6 16.6 0 01-3.4 4.4M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6"/><path d="M9.9 10.1a3 3 0 004.1 4.1"/></svg>';

function setupPasswordVisibilityToggles() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.dataset.toggleWired) return;
    input.dataset.toggleWired = "1";

    const wrap = document.createElement("div");
    wrap.className = "password-toggle-wrap";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "password-toggle-btn";
    btn.setAttribute("aria-label", "Show password");
    btn.innerHTML = ADMIN_EYE_ICON;
    wrap.appendChild(btn);

    btn.addEventListener("click", () => {
      const nowShowing = input.type === "password";
      input.type = nowShowing ? "text" : "password";
      btn.innerHTML = nowShowing ? ADMIN_EYE_OFF_ICON : ADMIN_EYE_ICON;
      btn.setAttribute("aria-label", nowShowing ? "Hide password" : "Show password");
    });
  });
}

// Admin-uploaded page background (Website Setup → Website Branding). The
// CSS falls back to the built-in barangay hall photo when --site-bg isn't
// set. The last-seen URL is cached and applied as soon as this script runs,
// so a custom background doesn't flash the default photo on every page load
// while the branding request is still in flight.
const SITE_BG_CACHE_KEY = "orms_site_background";

function setSiteBackground(url) {
  const root = document.documentElement;
  if (url) root.style.setProperty("--site-bg", `url("${url}")`);
  else root.style.removeProperty("--site-bg");
  try {
    if (url) localStorage.setItem(SITE_BG_CACHE_KEY, url);
    else localStorage.removeItem(SITE_BG_CACHE_KEY);
  } catch (e) {}
}

try {
  setSiteBackground(localStorage.getItem(SITE_BG_CACHE_KEY) || "");
} catch (e) {}

// Swaps the browser tab's favicon — there's no <link rel="icon"> in any
// page's <head>, so the tab just shows the browser's own default icon
// until this runs. Called once with the portal's static default logo.png
// right away, then again with the admin-uploaded one once branding loads
// below, same best-effort pattern as the sidebar logo.
function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

// Pulls the navbar/sidebar brand name + logo from Admin's Website Branding
// settings (siteinfo.BarangayProfile.site_name/site_logo — see
// siteinfo/views.py's BrandingPublicView) so every portal shows the same,
// admin-editable brand instead of a hardcoded "Barangay Platero OVRMS". Best-effort: on
// any failure the static "Barangay Platero OVRMS" + default leaf logo already in the
// HTML stays as-is. The browser tab's <title> is untouched on purpose.
function applySiteBranding() {
  fetch("/api/site/branding/")
    .then((r) => (r.ok ? r.json() : null))
    .then((branding) => {
      if (!branding) return;
      setSiteBackground(branding.site_background_url || "");
      if (branding.site_name) {
        // "Name | Kind of system" — the part after the bar goes on its own
        // smaller line under the name (dropped if the name has no bar).
        const [name, ...rest] = branding.site_name.split("|");
        const sub = rest.join("|").trim();
        document.querySelectorAll(".admin-sidebar__brand-text").forEach((el) => {
          const strong = el.querySelector("strong");
          if (strong) strong.textContent = name.trim();
          const small = el.querySelector("small");
          if (small) {
            small.textContent = sub;
            small.hidden = !sub;
          }
        });
      }
      if (branding.site_logo_url) {
        document.querySelectorAll(".admin-sidebar__logo").forEach((el) => {
          el.style.backgroundImage = `url("${branding.site_logo_url}")`;
        });
        setFavicon(branding.site_logo_url);
      }
    })
    .catch(() => {});
}

document.addEventListener("DOMContentLoaded", () => {
  setFavicon("assets/logo.png");
  applySiteBranding();
  setupPasswordVisibilityToggles();
  setupPasswordHints();
  const sidebarToggle = document.getElementById("sidebarToggle");
  const sidebar = document.querySelector(".admin-sidebar");
  const shell = document.querySelector(".admin-shell");

  if (sidebarToggle && sidebar && shell) {
    // A dimmed backdrop behind the mobile drawer — created here rather than
    // added to every HTML page, since it's only relevant below 900px (see
    // .admin-sidebar-backdrop in style.css).
    const backdrop = document.createElement("div");
    backdrop.className = "admin-sidebar-backdrop";
    shell.appendChild(backdrop);

    const closeSidebar = () => {
      sidebar.classList.remove("is-collapsed");
      backdrop.classList.remove("is-visible");
    };

    sidebarToggle.addEventListener("click", () => {
      const isOpening = !sidebar.classList.contains("is-collapsed");
      sidebar.classList.toggle("is-collapsed");
      if (window.matchMedia("(max-width: 900px)").matches) {
        backdrop.classList.toggle("is-visible", isOpening);
      }
    });

    backdrop.addEventListener("click", closeSidebar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSidebar();
    });

    sidebar.querySelectorAll(".admin-sidebar__nav a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) closeSidebar();
      });
    });
  }

  // Sidebar groups (Reports) — a collapsible dropdown, same as the Admin
  // Portal's. The group holding the current page is server-rendered already
  // expanded; this just makes the toggle button clickable.
  document.querySelectorAll(".admin-sidebar__group-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const subnav = toggle.nextElementSibling;
      if (!subnav) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      subnav.hidden = expanded;
    });
  });

  const logoutConfirmModal = document.getElementById("logoutConfirmModal");
  const logoutYes = document.getElementById("logoutYes");
  const logoutNo = document.getElementById("logoutNo");

  // Both the sidebar's Logout button and the profile popup's Log Out button
  // (when present) open the same confirmation modal. The profile popup
  // itself must close first — both are full-screen .modal-overlay elements
  // with the same stacking, so leaving it open buried the confirmation
  // behind it instead of showing on top.
  [document.getElementById("logoutBtn"), document.getElementById("profileLogoutBtn")].forEach((btn) => {
    if (btn && logoutConfirmModal) {
      btn.addEventListener("click", () => {
        const openProfileModal = document.getElementById("profileModal");
        if (openProfileModal) openProfileModal.hidden = true;
        logoutConfirmModal.hidden = false;
      });
    }
  });
  if (logoutYes) {
    logoutYes.addEventListener("click", async () => {
      // Closes out the LoginSession for View Audit Logs — best-effort, since
      // the local session should clear either way. Must happen before the
      // token authFetch needs to authenticate this gets removed below.
      try {
        await authFetch("/api/auth/logout/", { method: "POST" });
      } catch {
        // ignore — logging out locally still proceeds below
      }
      adminLogOut();
      window.location.href = "/staff/index.html";
    });
  }
  if (logoutNo) {
    logoutNo.addEventListener("click", () => {
      logoutConfirmModal.hidden = true;
    });
  }

  // Topbar name/role/avatar + the profile popup both reflect whoever is
  // actually logged in (rather than the hardcoded "Eliseo Aurelio Jr." /
  // "Barangay Chairman" placeholder this used to ship with), so an edit
  // made on My Profile shows up everywhere right away.
  const user = getAdminUser();
  if (user) {
    document.querySelectorAll(".admin-topbar__name strong").forEach((el) => {
      el.textContent = user.name;
    });
    document.querySelectorAll(".admin-topbar__name small").forEach((el) => {
      el.textContent = user.position || "Barangay Official";
    });
    document.querySelectorAll(".admin-topbar__avatar").forEach((el) => renderAvatar(el, user));
    document.getElementById("profileCardName") && (document.getElementById("profileCardName").textContent = user.name);
    document.getElementById("profileCardRole") && (document.getElementById("profileCardRole").textContent = user.position || "Barangay Official");
    renderAvatar(document.getElementById("profileCardInitials"), user);
  }

  const profileBtn = document.getElementById("profileBtn");
  const profileModal = document.getElementById("profileModal");
  if (profileBtn && profileModal) {
    profileBtn.addEventListener("click", () => {
      profileModal.hidden = false;
    });
  }

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

  // Bell icon: toggles the notifications dropdown anchored beneath it
  const notifBell = document.getElementById("notifBell");
  const notifDropdown = document.getElementById("notifDropdown");
  const notifBadge = document.getElementById("notifBadge");
  const notifList = document.getElementById("notifList");
  const notifClearAll = document.getElementById("notifClearAll");

  if (notifBell && notifDropdown && notifList) {
    const renderNotifications = () => {
      const notifications = getStaffNotifications();
      notifBadge.hidden = notifications.length === 0;
      notifList.innerHTML = notifications.length
        ? notifications
            .map(
              (n) => `
              <li class="notif-dropdown__item">
                <div class="notif-dropdown__content" data-goto="${n.id}">
                  <span class="notif-dropdown__message">${n.message}</span>
                  <span class="notif-dropdown__time">${timeAgo(n.time)}</span>
                </div>
                <button type="button" class="notif-dropdown__dismiss" data-dismiss="${n.id}" aria-label="Dismiss notification">&times;</button>
              </li>`
            )
            .join("")
        : `<li class="notif-dropdown__item">No notifications yet</li>`;
    };
    renderNotifications();

    // Dismiss (×) button removes just that one; clicking the notification's
    // content instead navigates to what it's about and clears it.
    notifList.addEventListener("click", (e) => {
      const dismissBtn = e.target.closest("[data-dismiss]");
      if (dismissBtn) {
        e.stopPropagation();
        removeStaffNotification(dismissBtn.dataset.dismiss);
        renderNotifications();
        return;
      }
      const goto = e.target.closest("[data-goto]");
      if (!goto) return;
      const notification = getStaffNotifications().find((n) => n.id === goto.dataset.goto);
      removeStaffNotification(goto.dataset.goto);
      if (notification && notification.link) {
        window.location.href = notification.link;
      } else {
        renderNotifications();
      }
    });

    if (notifClearAll) {
      notifClearAll.addEventListener("click", (e) => {
        e.stopPropagation();
        clearAllStaffNotifications();
        renderNotifications();
      });
    }

    // A brief pulse on the bell so a fresh notification catches the eye even
    // in peripheral vision — the dropdown popping open alone is easy to miss
    // if a staffer isn't already looking at the topbar.
    function flashNotifBell() {
      notifBell.classList.remove("navbar__bell--flash");
      void notifBell.offsetWidth; // restart the animation if it's still mid-flash
      notifBell.classList.add("navbar__bell--flash");
    }

    // Only raise a notification for a section this role can actually reach
    // from the nav (see STAFF_NAV_ACCESS above) — a Secretary has no path to
    // reports.html, an Investigator none to concerns.html/concerns-dashboard.html,
    // and the backend's own /staff/ list endpoints allow any Staff/Admin
    // regardless (they're meant for cross-referencing, not gated the same
    // way), so this has to be enforced here rather than assumed from a 403.
    // Derived from STAFF_NAV_ACCESS rather than a separate role list so this
    // can't quietly drift from what the sidebar actually shows.
    const staffPosition = (getAdminUser() || {}).position;
    const canSeeReports = STAFF_NAV_ACCESS["reports.html"].includes(staffPosition);
    const canSeeConcerns =
      STAFF_NAV_ACCESS["concerns.html"].includes(staffPosition) ||
      STAFF_NAV_ACCESS["concerns-dashboard.html"].includes(staffPosition);

    // Check immediately on page load, then keep polling — there's no
    // real-time push here, so this is what makes new report/concern
    // submissions show up as notifications without a full page reload. A
    // report/concern that's genuinely new (not just unread from before) pops
    // the dropdown open on its own — a new submission is easy to miss as a
    // small badge, and this is core to the job, so it doesn't wait for a
    // click on the bell (same reasoning as notifications not being opt-in
    // at all — see the file header comment above).
    function pollNotifications() {
      return Promise.all([
        canSeeReports ? checkForNewReports() : Promise.resolve(0),
        canSeeConcerns ? checkForNewConcerns() : Promise.resolve(0),
      ]).then(([newReports, newConcerns]) => {
        renderNotifications();
        if (newReports + newConcerns > 0) {
          notifDropdown.hidden = false;
          flashNotifBell();
        }
      });
    }
    pollNotifications();
    setInterval(pollNotifications, 30000);

    const toggleNotifDropdown = () => {
      notifDropdown.hidden = !notifDropdown.hidden;
      if (!notifDropdown.hidden) renderNotifications();
    };
    notifBell.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleNotifDropdown();
    });
    notifBell.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleNotifDropdown();
      }
    });
    document.addEventListener("click", (e) => {
      if (!notifDropdown.hidden && !notifBell.contains(e.target)) {
        notifDropdown.hidden = true;
      }
    });
  }
});


// Site-styled replacements for the browser's native popup dialogs.
function openSiteDialog({ title, message, buttons }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "dialog");
    if (title) {
      const heading = document.createElement("h2");
      heading.textContent = title;
      card.appendChild(heading);
    }
    // No message just shows the title and buttons (e.g. the plain "Are you
    // sure?" claim prompt — see reports-data.js's CLAIM_CONFIRM_MESSAGE).
    if (message) {
      const text = document.createElement("p");
      text.className = "auth-card__subtitle";
      text.textContent = message;
      card.appendChild(text);
    }
    const row = document.createElement("div");
    row.className = "btn-row";
    buttons.forEach((b) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn ${b.className || ""}`.trim();
      btn.textContent = b.label;
      btn.addEventListener("click", () => close(b.value));
      row.appendChild(btn);
    });
    card.appendChild(row);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const cancelValue = buttons.some((b) => b.value === false) ? false : buttons[0].value;
    function onKey(e) {
      if (e.key === "Escape") close(cancelValue);
    }
    function close(value) {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(cancelValue);
    });
    document.addEventListener("keydown", onKey);
    row.querySelector("button").focus();
  });
}

function siteAlert(message, title = "") {
  return openSiteDialog({ title, message, buttons: [{ label: "OK", value: true }] });
}

function siteConfirm(message, { title = "Are you sure?", confirmText = "OK", cancelText = "Cancel", danger = false } = {}) {
  return openSiteDialog({
    title,
    message,
    buttons: [
      { label: confirmText, value: true, className: danger ? "btn-danger" : "" },
      { label: cancelText, value: false, className: "btn-muted" },
    ],
  });
}
