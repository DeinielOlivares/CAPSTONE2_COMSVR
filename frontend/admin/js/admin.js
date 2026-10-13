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
// actually sets REMEMBER_KEY/LOGIN_AT_KEY; every other admin page just
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
// enforceAdminPortalAccess below checks it — a remembered session skips
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

// This script is only ever loaded by pages inside /admin/, so the portal is
// fixed. Every page that loads admin.js is a logged-in-only page (the
// login/forgot-password/reset pages load main.js instead), so bounce back
// to the login page unless there's a valid token AND the cached user is
// actually an Administrator — otherwise a Barangay Official's (or a stale/
// leftover) session could land straight on the Admin Portal unchecked.
function getAdminUser() {
  try {
    return JSON.parse(adminAuthStorage().getItem(ADMIN_AUTH_STORAGE_KEY));
  } catch {
    return null;
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

// Renders a real uploaded profile picture into an avatar container (the
// topbar avatar, the profile popup avatar, etc.) when one exists, falling
// back to initials — used everywhere a placeholder profile picture
// appears, so uploading a photo on My Profile shows up everywhere at once.
// Same helper as main.js's (duplicated here rather than shared, since
// admin.js and main.js are never loaded on the same page).
function renderAvatar(container, user) {
  if (!container) return;
  if (user && user.profilePicture) {
    container.innerHTML = `<img class="avatar-img" src="${user.profilePicture}" alt="" />`;
  } else if (user && user.initials) {
    container.textContent = user.initials;
  }
}

(function enforceAdminPortalAccess() {
  const user = getAdminUser();
  const hasToken = !!adminAuthStorage().getItem(ADMIN_ACCESS_TOKEN_KEY);
  // There's no separate Admin login anymore — Administrator is a Barangay
  // Staff role, not its own account type (see accounts/serializers.py's
  // STAFF_ROLE_CHOICES), so the single login page lives under /staff/.
  // Not logged in at all -> straight to that login page; logged in but not
  // an Administrator -> back to their own Staff portal home rather than a
  // login prompt they'd just bounce off of again.
  if (!hasToken || !user) {
    window.location.href = "/staff/index.html";
    return;
  }
  if (user.role !== "admin") {
    window.location.href = "/staff/reports-dashboard.html";
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
// main.js are never loaded on the same page — see the loading comment
// above). Every authenticated admin API call should go through this.
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

// Shows/clears an inline error message below a form (e.g. Create Account
// failing because the email's already taken). Same pattern as main.js.
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

// Administrator accounts group under "staff" here (not their own "admin"
// group) — the Filter dropdowns on Approve Accounts/Manage Accounts/Audit
// Logs only offer Citizens vs. Barangay Staff, with Admins counted as staff.
function accountTypeGroup(type) {
  if (type === "Barangay Citizen") return "citizen";
  return "staff";
}

// ---- Notifications (bell icon in the topbar) ----
// Stored in localStorage (rather than an in-memory array) so a notification
// added on one admin page — e.g. Create Account — is still there after
// navigating to another admin page.
const ADMIN_NOTIFICATIONS_KEY = "orms_admin_notifications";
const ADMIN_NOTIFICATIONS_MAX = 20;

function makeNotifId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAdminNotifications() {
  let notifications;
  try {
    notifications = JSON.parse(localStorage.getItem(ADMIN_NOTIFICATIONS_KEY)) || [];
  } catch {
    notifications = [];
  }
  // Backfills an id onto any notification stored before dismiss buttons
  // existed, so it can still be dismissed individually.
  let backfilled = false;
  notifications = notifications.map((n) => {
    if (n.id) return n;
    backfilled = true;
    return { ...n, id: makeNotifId() };
  });
  if (backfilled) localStorage.setItem(ADMIN_NOTIFICATIONS_KEY, JSON.stringify(notifications));
  return notifications;
}

// Called from other admin pages (e.g. Create Account) to raise a
// notification. link (optional) — the page a click on it should navigate to.
function addAdminNotification(message, link) {
  const notifications = getAdminNotifications();
  notifications.unshift({ id: makeNotifId(), message, link: link || null, time: Date.now() });
  localStorage.setItem(
    ADMIN_NOTIFICATIONS_KEY,
    JSON.stringify(notifications.slice(0, ADMIN_NOTIFICATIONS_MAX))
  );
}

// Called by the dismiss (×) button on each notification.
function removeAdminNotification(id) {
  const notifications = getAdminNotifications().filter((n) => n.id !== id);
  localStorage.setItem(ADMIN_NOTIFICATIONS_KEY, JSON.stringify(notifications));
}

function clearAllAdminNotifications() {
  localStorage.setItem(ADMIN_NOTIFICATIONS_KEY, JSON.stringify([]));
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

// ---- Notification preferences (per category) ----
// Which categories of real backend events raise a bell notification. New
// account verifications (a citizen just registered and needs approval) is
// on by default — that's core to the job, same reasoning as the Staff
// Portal's own notifications never being opt-in (see pollNotifications
// there). Audit log logins stay opt-in; an admin can still turn either off
// via the checkboxes injected into the notification dropdown below.
const ADMIN_NOTIF_PREFS_KEY = "orms_admin_notif_prefs";

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

// "Seen" IDs per category, so polling only raises a notification for items
// that showed up *after* the admin opted in — not a flood of one
// notification per already-existing pending account/login the moment they
// flip the checkbox on. `null` (vs. an empty array) means "never seeded
// yet," which is how a freshly-enabled category is told to seed silently
// instead of notifying about everything currently there.
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

const NOTIF_SEEN_VERIFICATIONS_KEY = "orms_admin_seen_verification_ids";
const NOTIF_SEEN_LOGINS_KEY = "orms_admin_seen_login_ids";

// Polls GET /api/auth/admin/verifications/ (the same endpoint Approve
// Accounts uses) and raises a notification for any pending account that
// wasn't there last time this ran.
// Returns how many genuinely-new pending accounts were found, so the
// caller can pop the dropdown open and flash the bell for them — a new
// citizen registration is easy to miss as a small badge, same reasoning as
// the Staff Portal's own report/concern notifications (see pollNotifications
// in frontend/staff/js/admin.js).
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
  newOnes.forEach((v) => addAdminNotification(`New account verification request from ${v.owner}`, "approve-accounts.html"));
  setSeenIds(NOTIF_SEEN_VERIFICATIONS_KEY, currentIds);
  return newOnes.length;
}

// Polls GET /api/auth/admin/audit-logs/ (View Audit Logs' own endpoint) and
// raises a notification for any login session that wasn't there last time.
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

  // Bounded window — only the most recent logins are relevant for "new"
  // detection, and the full log can grow indefinitely.
  const recent = list.slice(0, 50);
  const currentIds = recent.map((l) => l.id);
  const seen = getSeenIds(NOTIF_SEEN_LOGINS_KEY);
  if (seen === null) {
    setSeenIds(NOTIF_SEEN_LOGINS_KEY, currentIds);
    return;
  }

  recent
    .filter((l) => !seen.includes(l.id))
    .forEach((l) => addAdminNotification(`${l.owner} (${l.type}) logged in at ${l.loggedOnLabel}`, "audit-logs.html"));
  setSeenIds(NOTIF_SEEN_LOGINS_KEY, Array.from(new Set(currentIds.concat(seen))));
}

// Same password-strength checklist as main.js's/create-accounts.js's —
// duplicated here (own name for the word list to avoid clashing with
// create-accounts.js's own COMMON_PASSWORDS when both load on the same
// page) since My Profile → Change Password needs it on every admin page,
// not just Create Accounts. Mirrors the backend's AUTH_PASSWORD_VALIDATORS
// (see orms_backend/settings.py) closely enough to catch obviously-invalid
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
    numeric: pw.length > 0 && !/^\d+$/.test(pw),
    common: pw.length > 0 && !ADMIN_COMMON_PASSWORDS.has(lowerPw),
    similar: pw.length > 0 && !tooSimilar,
  };
}

function getPasswordRequirementError(pw, attrs = {}) {
  const status = getPasswordRuleStatus(pw, attrs);
  if (!status.length) return "Password must be at least 8 characters.";
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

    function update() {
      const status = getPasswordRuleStatus(passwordField.value, {
        firstName: firstNameField ? firstNameField.value : "",
        lastName: lastNameField ? lastNameField.value : "",
        email: emailField ? emailField.value : "",
      });
      hintList.querySelectorAll("li[data-rule]").forEach((li) => {
        const satisfied = !!status[li.dataset.rule];
        li.classList.toggle("is-satisfied", satisfied);
        const checkbox = li.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = satisfied;
      });
    }

    [passwordField, firstNameField, lastNameField, emailField].forEach((field) => {
      if (field) field.addEventListener("input", update);
    });
    update();
  });
}

// Same show/hide eye button as main.js's — duplicated here since admin.js
// and main.js are never loaded on the same page. Covers Create Accounts'
// password field and any other password input on an authenticated page.
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

// Pulls the navbar/sidebar brand name + logo from Website Branding settings
// (siteinfo.BarangayProfile.site_name/site_logo — see siteinfo/views.py's
// BrandingPublicView) so every portal shows the same, admin-editable brand
// instead of a hardcoded "Barangay Platero OVRMS". Best-effort: on any failure the
// static "Barangay Platero OVRMS" + default leaf logo already in the HTML stays as-is.
// The browser tab's <title> is untouched on purpose.
function applySiteBranding() {
  fetch("/api/site/branding/")
    .then((r) => (r.ok ? r.json() : null))
    .then((branding) => {
      if (!branding) return;
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
    // .admin-sidebar-backdrop in style.css) and every admin/staff page
    // shares this same sidebar markup.
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
      // Only show the dimming backdrop on mobile widths — on desktop,
      // .is-collapsed instead means "hide the sidebar for more room", where
      // a backdrop wouldn't make sense.
      if (window.matchMedia("(max-width: 900px)").matches) {
        backdrop.classList.toggle("is-visible", isOpening);
      }
    });

    backdrop.addEventListener("click", closeSidebar);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeSidebar();
    });

    // A nav link tap should close the drawer too, not leave it open over
    // the page that just loaded.
    sidebar.querySelectorAll(".admin-sidebar__nav a").forEach((link) => {
      link.addEventListener("click", () => {
        if (window.matchMedia("(max-width: 900px)").matches) closeSidebar();
      });
    });
  }

  // Sidebar groups (Account Management / Activity / Setup) — each one's
  // own dropdown, independent of the others. The group holding the current
  // page is server-rendered already expanded; this just makes every
  // toggle button actually clickable.
  document.querySelectorAll(".admin-sidebar__group-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const subnav = toggle.nextElementSibling;
      if (!subnav) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      subnav.hidden = expanded;
    });
  });

  // Topbar name + the profile popup both reflect whoever is actually logged
  // in (rather than a hardcoded placeholder), so an edit made on the My
  // Profile page shows up everywhere right away.
  const user = getAdminUser();
  if (user) {
    document.querySelectorAll(".admin-topbar__name strong").forEach((el) => {
      el.textContent = user.name;
    });
    document.querySelectorAll(".admin-topbar__avatar").forEach((el) => renderAvatar(el, user));
    document.getElementById("profileCardName") && (document.getElementById("profileCardName").textContent = user.name);
    renderAvatar(document.getElementById("profileCardInitials"), user);
  }

  const profileBtn = document.getElementById("profileBtn");
  const profileModal = document.getElementById("profileModal");
  if (profileBtn && profileModal) {
    profileBtn.addEventListener("click", () => {
      profileModal.hidden = false;
    });
  }

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
        if (profileModal) profileModal.hidden = true;
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
      const notifications = getAdminNotifications();
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
        // Otherwise this bubbles to notifBell's click handler and toggles the
        // whole dropdown closed instead of just removing the one notification.
        e.stopPropagation();
        removeAdminNotification(dismissBtn.dataset.dismiss);
        renderNotifications();
        return;
      }
      const goto = e.target.closest("[data-goto]");
      if (!goto) return;
      const notification = getAdminNotifications().find((n) => n.id === goto.dataset.goto);
      removeAdminNotification(goto.dataset.goto);
      if (notification && notification.link) {
        window.location.href = notification.link;
      } else {
        renderNotifications();
      }
    });

    if (notifClearAll) {
      notifClearAll.addEventListener("click", (e) => {
        e.stopPropagation();
        clearAllAdminNotifications();
        renderNotifications();
      });
    }

    // Lets the admin choose which real backend events raise a notification
    // (both off by default — see getNotifPrefs). Injected here via JS
    // rather than duplicated into every admin page's dropdown markup.
    // Placed after the whole header row (title + Clear All), not just after
    // the title, so it doesn't end up squeezed inside that flex row.
    const notifHeader = notifDropdown.querySelector(".notif-dropdown__header");
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
    // Clicking inside the prefs row (including the checkboxes) bubbles up
    // to notifBell's own click handler otherwise, which would toggle the
    // dropdown closed the instant a checkbox is clicked.
    prefsRow.addEventListener("click", (e) => e.stopPropagation());
    notifHeader.insertAdjacentElement("afterend", prefsRow);

    const prefVerifications = prefsRow.querySelector("#notifPrefVerifications");
    const prefAuditLogs = prefsRow.querySelector("#notifPrefAuditLogs");
    const prefs = getNotifPrefs();
    prefVerifications.checked = prefs.verifications;
    prefAuditLogs.checked = prefs.auditLogs;

    prefVerifications.addEventListener("change", () => {
      setNotifPrefs({ ...getNotifPrefs(), verifications: prefVerifications.checked });
      checkForNewVerifications().then(renderNotifications);
    });
    prefAuditLogs.addEventListener("change", () => {
      setNotifPrefs({ ...getNotifPrefs(), auditLogs: prefAuditLogs.checked });
      checkForNewAuditLogs().then(renderNotifications);
    });

    // A brief pulse on the bell so a fresh registration catches the eye even
    // in peripheral vision — the dropdown popping open alone is easy to miss
    // if the admin isn't already looking at the topbar. Same pattern as the
    // Staff Portal's own flashNotifBell.
    function flashNotifBell() {
      notifBell.classList.remove("navbar__bell--flash");
      void notifBell.offsetWidth; // restart the animation if it's still mid-flash
      notifBell.classList.add("navbar__bell--flash");
    }

    // Check immediately on page load, then keep polling — there's no
    // real-time push here, so this is what makes new pending accounts /
    // logins show up as notifications without a full page reload. A
    // genuinely new account verification request pops the dropdown open on
    // its own and flashes the bell — new logins stay a quiet badge update.
    function pollNotifications() {
      return Promise.all([checkForNewVerifications(), checkForNewAuditLogs()]).then(([newVerifications]) => {
        renderNotifications();
        if (newVerifications > 0) {
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
    const text = document.createElement("p");
    text.className = "auth-card__subtitle";
    text.textContent = message;
    card.appendChild(text);
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
