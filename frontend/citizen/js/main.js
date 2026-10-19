// Barangay Platero OVRMS — shared front-end behavior, wired to the Django REST API.

// The API is served from the same host as this frontend (see
// WHITENOISE_ROOT in settings.py), so a relative path works both in local
// dev and once deployed — no hardcoded domain to update later.
const API_BASE = "/api/auth";

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

// JWT tokens + basic profile info are kept in sessionStorage by default —
// cleared automatically when the tab closes — or in localStorage when the
// person checked "Stay signed in" at login, so it survives closing the tab.
// The token is what actually authenticates requests; the cached user object
// is just for quick UI rendering (name/initials in the navbar) without a
// network round-trip on every page.
const AUTH_STORAGE_KEY = "orms_auth_user";
const ACCESS_TOKEN_KEY = "orms_access_token";
const REFRESH_TOKEN_KEY = "orms_refresh_token";

// Whether the current session should survive closing the tab — set at login
// time by the "Stay signed in" checkbox. Always in localStorage (regardless
// of which bucket the tokens themselves are in) since it just has to answer
// "which bucket do I check", not authenticate anyone on its own.
const REMEMBER_KEY = "orms_remember_me";

// Non-"Stay signed in" sessions also get a hard cap, independent of the tab
// staying open: logged out after 1 day even if it's never closed. A
// remembered session skips this — it lasts until the refresh token itself
// expires (7 days server-side, see SIMPLE_JWT in settings.py), which
// authFetch's refresh-on-401 handling below already surfaces as a normal
// logout when it finally fails.
const LOGIN_AT_KEY = "orms_login_at";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// The single choke point every other token/user read-or-write in this file
// goes through, so "Stay signed in" only had to be taught to this one
// function rather than every call site individually.
function authStorage() {
  return localStorage.getItem(REMEMBER_KEY) === "1" ? localStorage : sessionStorage;
}

// Clears a stale (past its 1-day cap) non-remembered session before
// anything else on the page reads it — enforcePortalAccess's existing
// isLoggedIn() check then naturally bounces staff/admin pages to login, and
// citizen pages naturally fall back to the guest navbar, with no extra
// redirect logic needed here.
function expireStaleSession() {
  if (localStorage.getItem(REMEMBER_KEY) === "1") return;
  const loginAt = Number(sessionStorage.getItem(LOGIN_AT_KEY));
  if (loginAt && Date.now() - loginAt > SESSION_MAX_AGE_MS) {
    logOut();
  }
}

// Holds signup.html's fields in sessionStorage while the resident is on
// verify-signup.html choosing their ID photo, so the whole signup (text
// fields + photo) can be submitted as one multipart request from there.
const SIGNUP_DRAFT_KEY = "orms_signup_draft";
const SIGNUP_TERMS_KEY = "orms_signup_terms_agreed";

// Same idea, for the Forgot Password flow's 3 separate pages (Forgot
// Password -> Input Code -> Reset Password): holds the email, and once
// Input Code succeeds, the verified code too, so Reset Password can submit
// both without asking for either again.
const RESET_DRAFT_KEY = "orms_reset_draft";

// Maps each backend role to the page it should land on after login, and to
// which portal folder that role is allowed into. Keeps the redirect logic
// in one place instead of duplicated per login form. `staff` is a fallback
// only — a real Staff account always has a position, so STAFF_POSITION_HOME
// below is what actually decides where they land (see loginHome()).
const ROLE_HOME = {
  citizen: "/citizen/home.html",
  staff: "/staff/reports-dashboard.html",
  admin: "/admin/approve-accounts.html",
};

// Each Barangay Staff role sees a different slice of the Staff Portal (see
// frontend/staff/js/admin.js's STAFF_NAV_ACCESS for the full breakdown) —
// this is just where they land right after logging in/finishing setup.
const STAFF_POSITION_HOME = {
  "Barangay Captain": "/staff/reports-dashboard.html",
  Secretary: "/staff/concerns.html",
  Investigator: "/staff/reports.html",
};

// Works out where to send someone right after apiLogin/apiCompleteAccountSetup
// resolves — reads the just-stored user (see storeAuthSession) rather than
// needing role/position passed around separately.
function loginHome(role) {
  if (role === "staff") {
    const user = getCurrentUser();
    return (user && STAFF_POSITION_HOME[user.position]) || ROLE_HOME.staff;
  }
  return ROLE_HOME[role];
}

function getCurrentUser() {
  try {
    return JSON.parse(authStorage().getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

// Renders a real uploaded profile picture into an avatar container (the
// navbar icon, the profile popup avatar, etc.) when one exists, falling
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

// ---- Notifications (bell icon in the navbar) ----
// Status/remarks updates on the citizen's own reports/concerns raise a
// notification automatically (no opt-in — this is exactly what the bell
// was always supposed to be for). Stored in localStorage so a notification
// raised on one page is still there after navigating to another.
const CITIZEN_NOTIFICATIONS_KEY = "orms_citizen_notifications";
const CITIZEN_NOTIFICATIONS_MAX = 20;

function makeNotifId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getCitizenNotifications() {
  let notifications;
  try {
    notifications = JSON.parse(localStorage.getItem(CITIZEN_NOTIFICATIONS_KEY)) || [];
  } catch {
    notifications = [];
  }
  let backfilled = false;
  notifications = notifications.map((n) => {
    if (n.id) return n;
    backfilled = true;
    return { ...n, id: makeNotifId() };
  });
  if (backfilled) localStorage.setItem(CITIZEN_NOTIFICATIONS_KEY, JSON.stringify(notifications));
  return notifications;
}

// link (optional) — the page a click on this notification should navigate
// to (e.g. the report/concern/ordinance it's about); omitted for
// notifications with no obvious destination.
function addCitizenNotification(message, link) {
  const notifications = getCitizenNotifications();
  notifications.unshift({ id: makeNotifId(), message, link: link || null, time: Date.now() });
  localStorage.setItem(
    CITIZEN_NOTIFICATIONS_KEY,
    JSON.stringify(notifications.slice(0, CITIZEN_NOTIFICATIONS_MAX))
  );
}

function removeCitizenNotification(id) {
  const notifications = getCitizenNotifications().filter((n) => n.id !== id);
  localStorage.setItem(CITIZEN_NOTIFICATIONS_KEY, JSON.stringify(notifications));
}

function clearAllCitizenNotifications() {
  localStorage.setItem(CITIZEN_NOTIFICATIONS_KEY, JSON.stringify([]));
}

function citizenTimeAgo(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const REPORT_STATUS_LABELS_FOR_NOTIF = {
  submitted: "Submitted",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};
const CONCERN_STATUS_LABELS_FOR_NOTIF = { submitted: "Submitted", reviewed: "Reviewed" };

// Snapshots each report/concern's status+remarks (keyed by id) so a later
// poll can tell whether it's actually changed since last seen. A brand-new
// item still sitting at its just-submitted default (status "submitted", no
// remarks) is baselined silently, since that's exactly the submission the
// citizen just made themselves. But an item seen for the first time in any
// other state — e.g. the citizen never had the app open between filing a
// report and staff already acting on it — is itself a change worth
// surfacing, not a silent baseline: otherwise that update would never be
// seen.
function getNotifSnapshot(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

function setNotifSnapshot(key, snapshot) {
  localStorage.setItem(key, JSON.stringify(snapshot));
}

const REPORT_SNAPSHOT_KEY = "orms_citizen_report_snapshot";
const CONCERN_SNAPSHOT_KEY = "orms_citizen_concern_snapshot";

async function checkForReportUpdates() {
  let list;
  try {
    const res = await authFetch("/api/reports/");
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  const snapshot = getNotifSnapshot(REPORT_SNAPSHOT_KEY);
  list.forEach((r) => {
    const hash = `${r.status}|${r.remarks}`;
    const isFirstSight = !(r.id in snapshot);
    const isFreshSubmission = r.status === "submitted" && !r.remarks;
    const changed = isFirstSight ? !isFreshSubmission : snapshot[r.id] !== hash;
    if (changed) {
      const label = REPORT_STATUS_LABELS_FOR_NOTIF[r.status] || r.status;
      addCitizenNotification(`Your report "${r.ordinance}" is now ${label}.`, `my-report-detail.html?id=${r.id}`);
    }
    snapshot[r.id] = hash;
  });
  setNotifSnapshot(REPORT_SNAPSHOT_KEY, snapshot);
}

async function checkForConcernUpdates() {
  let list;
  try {
    const res = await authFetch("/api/concerns/");
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  const snapshot = getNotifSnapshot(CONCERN_SNAPSHOT_KEY);
  list.forEach((c) => {
    const hash = `${c.status}|${c.remarks}`;
    const isFirstSight = !(c.id in snapshot);
    const isFreshSubmission = c.status === "submitted" && !c.remarks;
    const changed = isFirstSight ? !isFreshSubmission : snapshot[c.id] !== hash;
    if (changed) {
      const label = CONCERN_STATUS_LABELS_FOR_NOTIF[c.status] || c.status;
      addCitizenNotification(`Your concern/suggestion is now ${label}.`, `my-concern-detail.html?id=${c.id}`);
    }
    snapshot[c.id] = hash;
  });
  setNotifSnapshot(CONCERN_SNAPSHOT_KEY, snapshot);
}

function getAccessToken() {
  return authStorage().getItem(ACCESS_TOKEN_KEY);
}

function getRefreshToken() {
  return authStorage().getItem(REFRESH_TOKEN_KEY);
}

function isLoggedIn() {
  return !!getAccessToken();
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

// Remembers a page's filters, search and page number for the rest of this
// browser tab, so opening an item and coming back (or visiting other pages)
// shows the page the way it was left. Kept per signed-in user and per page;
// sessionStorage, so a fresh tab starts from the defaults.
function createFilterMemory(name) {
  const user = getCurrentUser();
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

// Clears both buckets unconditionally (rather than just whichever
// REMEMBER_KEY currently points at) so a leftover token from switching
// "Stay signed in" on/off across logins can never survive a logout.
function logOut() {
  [localStorage, sessionStorage].forEach((store) => {
    store.removeItem(AUTH_STORAGE_KEY);
    store.removeItem(ACCESS_TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
    store.removeItem(LOGIN_AT_KEY);
  });
  localStorage.removeItem(REMEMBER_KEY);
}

// Silently refreshes the access token using the refresh token — called by
// authFetch on a 401 rather than requiring every page to re-login every
// hour (the access token's own lifetime). Returns whether it succeeded.
async function refreshAccessToken() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await fetch(`${API_BASE}/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    const store = authStorage();
    store.setItem(ACCESS_TOKEN_KEY, data.access);
    // ROTATE_REFRESH_TOKENS is on server-side, so a fresh refresh token
    // comes back too — store it, or the next refresh would use a dead one.
    if (data.refresh) store.setItem(REFRESH_TOKEN_KEY, data.refresh);
    return true;
  } catch {
    return false;
  }
}

// Shared by apiLogin and apiCompleteAccountSetup below — both endpoints
// return the same {access, refresh, user} shape, so both just hand their
// response here to actually persist the session.
// remember: "Stay signed in" checkbox — false/omitted means the session
// lives in sessionStorage (gone once the tab closes) and is capped at 1 day;
// true means localStorage (survives closing the tab/browser).
function storeAuthSession(data, remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  const store = remember ? localStorage : sessionStorage;
  store.setItem(ACCESS_TOKEN_KEY, data.access);
  store.setItem(REFRESH_TOKEN_KEY, data.refresh);
  store.setItem(LOGIN_AT_KEY, String(Date.now()));
  store.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({
      name: data.user.name,
      firstName: data.user.first_name,
      middleInitial: data.user.middle_initial,
      lastName: data.user.last_name,
      // First + last initials specifically — data.user.name now may have a
      // middle initial in between (see User.get_full_name), which splitting
      // the full name by space would pick up instead of the last name.
      initials: [data.user.first_name, data.user.last_name]
        .filter(Boolean)
        .map((part) => part[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
      id: data.user.id,
      email: data.user.email,
      mobile: data.user.contact_number,
      address: data.user.address,
      role: data.user.role,
      position: data.user.position,
      profilePicture: data.user.profile_picture,
    })
  );
  return data.user.role;
}

// Calls the real login endpoint. On success, stores the JWT tokens and a
// small user summary, and returns the user's role so the caller can decide
// where to redirect. On failure, throws with a message meant to be shown
// directly to the person (invalid credentials, network error, etc).
async function apiLogin(email, password, remember) {
  let response;
  try {
    response = await fetch(`${API_BASE}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, portal: "citizen" }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    // Surfaces the backend's actual reason (e.g. "still under verification")
    // instead of a generic message, so an unverified/pending account gets a
    // meaningfully different prompt than a wrong password.
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Incorrect email or password.");
  }

  return storeAuthSession(await response.json(), remember);
}

// Account setup — the first-login screen for every account someone else
// created (Barangay Staff/Administrator accounts an Administrator made, and
// Barangay Citizen accounts made by an Administrator or the Secretary). The
// account has no password until its owner finishes setup from the one-time
// link emailed to them — see accounts/setup_links.py.

// Opening the link: checks it's still valid and returns the account's
// details to pre-fill (blank for staff/invited citizens). Throws with the
// backend's "expired or already used" message otherwise.
async function apiCheckSetupLink(uid, token) {
  let response;
  try {
    response = await fetch(`${API_BASE}/account-setup/check/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "This setup link isn't valid.");
  return data;
}

// Emails a fresh link (killing older ones), by { email } typed on the page or
// { uid } from an expired link. The answer is the same whether or not
// anything was sent — the backend deliberately doesn't reveal which emails
// have accounts — so the UI just tells the person to check their inbox.
async function apiRequestSetupLink(body) {
  let response;
  try {
    response = await fetch(`${API_BASE}/account-setup/request-link/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not send a setup link. Please try again.");
  }
  return response.json();
}

// Submits the details + chosen password and logs the account straight in —
// same session-storing behavior as apiLogin, since the response is shaped
// identically (see AccountSetupView).
async function apiCompleteAccountSetup(uid, token, details) {
  let response;
  try {
    response = await fetch(`${API_BASE}/account-setup/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token, ...details }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    const err = new Error(data.detail || (Array.isArray(firstError) ? firstError[0] : "Could not complete account setup."));
    err.fields = data;
    throw err;
  }
  return storeAuthSession(await response.json(), false);
}

// Public citizen self-registration. Takes a FormData (text fields + the
// voter_id_image file) since it's a multipart request, not JSON. Doesn't
// log the resident in — the account stays unverified until an admin
// approves it, see apiLogin's "still under verification" handling above.
async function apiRegister(formData) {
  let response;
  try {
    response = await fetch(`${API_BASE}/register/`, {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not create your account.");
  }

  return response.json();
}

// Sign Up step 1 calls this before moving to step 2's ID photo upload, so a
// duplicate email/phone is caught on the same page it was typed into.
// Returns the field -> message map on a conflict ({} means available),
// rather than throwing, since the caller needs to know which field(s).
async function apiCheckAvailability(email, contact_number) {
  let response;
  try {
    response = await fetch(`${API_BASE}/check-availability/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, contact_number }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (response.ok) return {};
  if (response.status !== 400) throw new Error("Could not check that information. Please try again.");
  return response.json();
}

// Forgot Password step 1 — emails a 6-digit code to the account, if one
// exists for that address.
async function apiRequestPasswordReset(email) {
  let response;
  try {
    response = await fetch(`${API_BASE}/password-reset/request/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not send a reset code.");
  }
  return response.json();
}

// Forgot Password step 2 (Input Code) — checks the code before Reset
// Password will accept it.
async function apiVerifyPasswordResetCode(email, code) {
  let response;
  try {
    response = await fetch(`${API_BASE}/password-reset/verify/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Invalid or expired code.");
  }
  return response.json();
}

// Forgot Password step 3 (Reset Password) — actually sets the new password.
async function apiConfirmPasswordReset(email, code, password) {
  let response;
  try {
    response = await fetch(`${API_BASE}/password-reset/confirm/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not reset your password.");
  }
  return response.json();
}

// Attaches the stored JWT to a fetch call. Every authenticated API request
// (reports, ordinances, concerns, etc. once those endpoints exist) should
// go through this helper rather than calling fetch() directly.
async function authFetch(path, options = {}) {
  const token = getAccessToken();
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  const response = await fetch(path, { ...options, headers });

  // The access token is short-lived (1hr) by design — this is what keeps a
  // session feeling like it lasts a day (or however long "Stay signed in"
  // lasts) instead of silently breaking every hour. If the refresh token
  // itself has died (expired, or none stored at all), this just falls
  // through and returns the original 401 as-is — same as today.
  if (response.status === 401 && (await refreshAccessToken())) {
    const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${getAccessToken()}` };
    return fetch(path, { ...options, headers: retryHeaders });
  }
  return response;
}

// Shows an inline error message below a form's submit button (created on
// first use), for failed API calls like a wrong password.
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

// Highlights one input/select red with an inline message underneath it —
// for mistakes tied to a specific field (invalid street, duplicate email or
// phone) rather than the whole form, so the person knows exactly what to
// fix without re-reading every field.
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
  input.addEventListener("input", () => clearFieldInvalid(input), { once: true });
}

function clearFieldInvalid(input) {
  if (!input) return;
  input.classList.remove("field-invalid");
  const field = input.closest(".field") || input.parentElement;
  const errEl = field.querySelector(".field-error");
  if (errEl) errEl.remove();
}

// Backs the floating "Ask a Question" button (askQuestionFab), wired below —
// present on every citizen page, not just FAQs.
async function askQuestion(question) {
  const response = await authFetch("/api/questions/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not submit your question.");
  }
  return response.json();
}

// Mirrors the backend's AUTH_PASSWORD_VALIDATORS (see orms_backend/settings.py)
// closely enough to catch obviously-invalid passwords before the resident
// spends time on the ID photo step, without duplicating Django's full
// ~20,000-entry common-password list — this list covers the most likely
// ones; anything it misses still gets caught by the real validator when the
// account is actually created.
const COMMON_PASSWORDS = new Set([
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

// Evaluates each client-checkable requirement independently — used to drive
// the live checkbox feedback next to the password field, so each rule ticks
// off as soon as it's satisfied rather than only reporting the first failure.
// An empty password reports every rule but "length" as unsatisfied, even
// though e.g. "" isn't technically all-numeric — nothing's been typed yet,
// so nothing should look already-satisfied.
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
    common: pw.length > 0 && !COMMON_PASSWORDS.has(lowerPw),
    similar: pw.length > 0 && !tooSimilar,
  };
}

// Returns an error message if the password fails a client-checkable
// requirement, or null if it looks fine. attrs are the resident's own
// name/email fields, since a password too similar to those is rejected too.
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
// each <li data-rule="..."> ticks its checkbox and highlights once that
// specific requirement is met, updating as the resident types the password
// or edits their name/email (since "too similar" depends on those too).
function setupPasswordHints() {
  document.querySelectorAll(".password-hint").forEach((hintList) => {
    const form = hintList.closest("form");
    if (!form) return;
    // Defaults to the form's first password field (true for every existing
    // use — Sign Up, Create Accounts, account setup — which have exactly
    // one). A form with more than one (Change Password: current/new/confirm)
    // must say which one via data-password-field="<id>", or this would wire
    // the hints to Current Password instead of New Password.
    const passwordField = hintList.dataset.passwordField
      ? document.getElementById(hintList.dataset.passwordField)
      : form.querySelector('input[type="password"]');
    if (!passwordField) return;
    const firstNameField = form.querySelector('[name="first_name"]');
    const lastNameField = form.querySelector('[name="last_name"]');
    const emailField = form.querySelector('[name="email"]');

    // Sign Up's list (.password-hint--missing-only) stays hidden until the
    // resident clicks Next with requirements unmet (see the signup step 1
    // handler, which sets data-prompted) — and then only shows the unmet
    // requirements, updating as they fix the password.
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
    hintList.updatePasswordHints = update;

    [passwordField, firstNameField, lastNameField, emailField].forEach((field) => {
      if (field) field.addEventListener("input", update);
    });
    update();
  });
}

// Adds a show/hide eye button to every password field on the page (login,
// signup, reset-password, change-password, etc. — anywhere one exists,
// nothing page-specific to wire up). Wraps each input in a small relative-
// positioned container rather than editing every page's HTML individually.
const EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a16.6 16.6 0 01-3.4 4.4M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6"/><path d="M9.9 10.1a3 3 0 004.1 4.1"/></svg>';

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
    btn.innerHTML = EYE_ICON;
    wrap.appendChild(btn);

    btn.addEventListener("click", () => {
      const nowShowing = input.type === "password";
      input.type = nowShowing ? "text" : "password";
      btn.innerHTML = nowShowing ? EYE_OFF_ICON : EYE_ICON;
      btn.setAttribute("aria-label", nowShowing ? "Hide password" : "Show password");
    });
  });
}

// Runs on every Staff/Admin portal page except the login page itself. The
// Citizen portal deliberately allows guest browsing (viewing ordinances
// without an account, per the scope doc), so it's excluded here — the
// existing data-auth-only / data-auth-gate logic further down already
// handles hiding citizen-only actions from guests.
// Pages reachable without an active session: the login page itself, plus
// the whole "forgot password" flow (a user hitting these is by definition
// not logged in yet).
const PUBLIC_PORTAL_PAGES = [
  "index.html",
  "forgot-password.html",
  "verify-code.html",
  "reset-password.html",
  "reset-success.html",
  "account-setup.html",
];

function enforcePortalAccess() {
  const path = window.location.pathname;

  // A Staff/Admin session leaking into the Citizen Portal (e.g. a staff
  // member still logged in on the Staff Portal edits the URL over to
  // /citizen/...) must not render as a logged-in citizen — that'd show
  // their staff account's name/avatar and let citizen-only actions go
  // through as them. Unlike the Staff/Admin side below, this doesn't
  // redirect away: Citizen pages allow guest browsing, so clearing the
  // mismatched session and falling through just leaves the normal guest
  // view (Login/Sign Up in the navbar, citizen-gated actions prompt login).
  if (path.startsWith("/citizen/")) {
    const user = getCurrentUser();
    if (user && user.role !== "citizen") logOut();
    return;
  }

  const isStaffOrAdmin = path.startsWith("/staff/") || path.startsWith("/admin/");
  if (!isStaffOrAdmin) return;

  const portal = path.startsWith("/staff/") ? "staff" : "admin";
  const page = path.split("/").pop();
  const isPublicPage = PUBLIC_PORTAL_PAGES.includes(page) || path === `/${portal}/`;
  if (isPublicPage) return;

  const user = getCurrentUser();
  if (!isLoggedIn() || !user || user.role !== portal) {
    window.location.href = `/${portal}/index.html`;
  }
}

// Swaps the browser tab's favicon — there's no <link rel="icon"> in any
// page's <head>, so the tab just shows the browser's own default icon
// until this runs. Called once with the portal's static default logo.png
// right away, then again with the admin-uploaded one once branding loads
// below, same best-effort pattern as the navbar logo.
function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

// Pulls the navbar brand name + logo from Admin's Website Branding settings
// (siteinfo.BarangayProfile.site_name/site_logo — see siteinfo/views.py's
// BrandingPublicView) so every portal shows the same, admin-editable brand
// instead of a hardcoded "Barangay Platero OVRMS". Best-effort: on any failure the
// static "Barangay Platero OVRMS" + default leaf logo already in the HTML stays as-is.
// The browser tab's <title> is untouched on purpose. Public (guests see
// the navbar too), so a plain fetch — no auth needed.
function applySiteBranding() {
  fetch("/api/site/branding/")
    .then((r) => (r.ok ? r.json() : null))
    .then((branding) => {
      if (!branding) return;
      // "Name | Kind of system" — the part after the bar goes on its own
      // smaller line under the name (dropped if the name has no bar).
      const [name, ...rest] = (branding.site_name || "").split("|");
      const sub = rest.join("|").trim();
      document.querySelectorAll(".navbar__brand-text").forEach((el) => {
        if (!branding.site_name) return;
        const strong = el.querySelector("strong");
        if (strong) strong.textContent = name.trim();
        const small = el.querySelector("small");
        if (small) {
          small.textContent = sub;
          small.hidden = !sub;
        }
      });
      if (branding.site_logo_url) {
        document.querySelectorAll(".navbar__logo").forEach((el) => {
          el.style.backgroundImage = `url("${branding.site_logo_url}")`;
        });
        setFavicon(branding.site_logo_url);
      }
    })
    .catch(() => {});
}

// Publishes the sticky navbar's real height as --navbar-height, so sticky
// side panels (the File Report page's Reporting Tips — see .info-panel in
// style.css) stop just below it rather than underneath it.
function trackNavbarHeight() {
  const navbar = document.querySelector(".navbar");
  if (!navbar) return;
  const update = () => document.documentElement.style.setProperty("--navbar-height", `${navbar.offsetHeight}px`);
  update();
  if (window.ResizeObserver) new ResizeObserver(update).observe(navbar);
  else window.addEventListener("resize", update);
}

document.addEventListener("DOMContentLoaded", () => {
  setFavicon("assets/logo.png");
  applySiteBranding();
  trackNavbarHeight();
  document.querySelectorAll(".navbar__brand").forEach((brand) => {
    brand.style.cursor = "pointer";
    brand.addEventListener("click", () => {
      window.location.href = "/citizen/about.html";
    });
  });
  expireStaleSession();
  enforcePortalAccess();
  setupPasswordHints();
  setupPasswordVisibilityToggles();

  // Sign Up's Street field: a type-to-filter combobox over the real street
  // list (streets-data.js, now API-backed — see ensureStreetsLoaded), same
  // pattern as File Report's location field. Guarded on streets-data.js
  // being loaded at all, since not every page that loads main.js does.
  // Awaited in its own IIFE rather than making this whole (very large)
  // DOMContentLoaded handler async, so the fetch doesn't hold up every
  // other unrelated bit of wiring below it.
  if (typeof ensureStreetsLoaded === "function") {
    ensureStreetsLoaded()
      .then(() => {
        wireStreetCombobox("signupStreet", "signupStreetList");
        wireStreetCombobox("profileStreet", "profileStreetList");
        wireStreetCombobox("setupStreet", "setupStreetList");
      })
      .catch(() => {
        // Best-effort — the comboboxes just show no options if this fails.
      });
  }

  // Prevent full page reload on forms that don't have a real backend yet;
  // just follow the link/button's intended navigation.
  document.querySelectorAll("form[data-goto]").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      // Some forms (e.g. Forgot Password) accept either of two fields
      // rather than requiring both, which HTML5 `required` can't express.
      if (form.dataset.requireEither) {
        const [firstName, secondName] = form.dataset.requireEither.split(",");
        const first = form.querySelector(`[name="${firstName}"]`);
        const second = form.querySelector(`[name="${secondName}"]`);
        if (!first.value.trim() && !second.value.trim()) {
          first.setCustomValidity(`Enter your ${firstName} or ${secondName}`);
          first.reportValidity();
          return;
        }
        first.setCustomValidity("");
      }

      // Sign Up step 1 (signup.html): stash the fields in sessionStorage —
      // the actual account isn't created until step 2 submits, since the
      // API needs the ID photo and the account together in one request.
      if (form.dataset.signupStep1 !== undefined) {
        const password = form.querySelector('[name="password"]');
        const confirmPassword = form.querySelector('[name="confirmPassword"]');
        const firstNameField = form.querySelector('[name="first_name"]');
        const lastNameField = form.querySelector('[name="last_name"]');
        const middleInitialField = form.querySelector('[name="middle_initial"]');
        const emailField = form.querySelector('[name="email"]');
        const phoneField = form.querySelector('[name="phone"]');
        const firstName = firstNameField.value.trim();
        const lastName = lastNameField.value.trim();
        const middleInitial = middleInitialField ? middleInitialField.value.trim() : "";
        const email = emailField.value.trim();
        clearFormError(form);
        [emailField, phoneField, form.querySelector('[name="address"]')].forEach(clearFieldInvalid);
        clearFieldInvalid(document.getElementById("signupStreet"));
        if (password.value !== confirmPassword.value) {
          showFormError(form, "Passwords do not match.");
          return;
        }
        // The character-class requirements aren't shown up front — reveal
        // the list of whichever ones are still missing and point at it.
        const ruleStatus = getPasswordRuleStatus(password.value);
        if (!ruleStatus.lowercase || !ruleStatus.uppercase || !ruleStatus.special || !ruleStatus.length) {
          const hintList = form.querySelector(".password-hint--missing-only");
          if (hintList && hintList.updatePasswordHints) {
            hintList.dataset.prompted = "";
            hintList.updatePasswordHints();
          }
          showFormError(form, "Your password is missing some requirements.");
          password.focus();
          return;
        }
        const passwordError = getPasswordRequirementError(password.value, { firstName, lastName, email });
        if (passwordError) {
          showFormError(form, passwordError);
          return;
        }

        // Street is a select-from-the-list combobox (see the STREETS wiring
        // above) rather than free text, so it has to actually match an
        // entry — typing something and not clicking an option shouldn't
        // silently go through as if it were a valid street.
        if (!isValidPhMobile(phoneField.value)) {
          markFieldInvalid(phoneField, "Enter a valid mobile number, like 09XXXXXXXXX.");
          return;
        }

        const streetField = document.getElementById("signupStreet");
        const blockLotField = document.getElementById("signupBlockLot");
        const street = streetField ? streetField.value.trim() : "";
        const blockLot = blockLotField ? blockLotField.value.trim() : "";
        if (streetField && typeof STREETS !== "undefined" && !STREETS.includes(street)) {
          markFieldInvalid(streetField, "Please select a street from the list.");
          return;
        }

        const contactNumber = phoneField.value.trim();
        const submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        let availability;
        try {
          availability = await apiCheckAvailability(email, contactNumber);
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          return;
        }
        submitBtn.disabled = false;
        if (availability.email) markFieldInvalid(emailField, availability.email[0]);
        if (availability.contact_number) markFieldInvalid(phoneField, availability.contact_number[0]);
        if (availability.email || availability.contact_number) return;

        sessionStorage.setItem(
          SIGNUP_DRAFT_KEY,
          JSON.stringify({
            email,
            password: password.value,
            first_name: firstName,
            middle_initial: middleInitial,
            last_name: lastName,
            contact_number: contactNumber,
            address: streetField ? `${blockLot}, ${street}` : form.querySelector('[name="address"]').value.trim(),
          })
        );
        window.location.href = form.dataset.goto;
        return;
      }

      // Sign Up step 2 (verify-signup.html): combines step 1's stashed
      // fields with the ID photo and actually creates the account.
      if (form.dataset.signupStep2 !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const fileInput = form.querySelector('[name="idPhoto"]');
        clearFormError(form);

        let draft = null;
        try {
          draft = JSON.parse(sessionStorage.getItem(SIGNUP_DRAFT_KEY));
        } catch {
          draft = null;
        }
        if (!draft) {
          window.location.href = "signup.html";
          return;
        }
        if (!fileInput.files.length) {
          const drop = form.querySelector(".upload-drop");
          if (drop) drop.classList.add("upload-drop--invalid");
          markFieldInvalid(fileInput, "You must upload a photo of your Voter's ID first.");
          fileInput.addEventListener("change", () => {
            clearFieldInvalid(fileInput);
            if (drop) drop.classList.remove("upload-drop--invalid");
          }, { once: true });
          return;
        }

        const formData = new FormData();
        Object.entries(draft).forEach(([key, value]) => formData.append(key, value));
        formData.append("voter_id_image", fileInput.files[0]);

        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";
        try {
          await apiRegister(formData);
          sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
          window.location.href = form.dataset.goto;
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = "Submit";
        }
        return;
      }

      // Forgot Password step 1 (forgot-password.html): request a reset code
      // by email — stashes the email in sessionStorage for the next two
      // steps, same pattern as the signup draft above.
      if (form.dataset.forgotRequest !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const email = form.querySelector('[name="email"]').value.trim();
        clearFormError(form);

        submitBtn.disabled = true;
        submitBtn.textContent = "Sending...";
        try {
          await apiRequestPasswordReset(email);
          sessionStorage.setItem(RESET_DRAFT_KEY, JSON.stringify({ email }));
          window.location.href = form.dataset.goto;
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = "Get Code";
        }
        return;
      }

      // Forgot Password step 2 (verify-code.html): confirms the code before
      // letting them set a new password.
      if (form.dataset.forgotVerify !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const code = form.querySelector('[name="code"]').value.trim();
        clearFormError(form);

        let draft = null;
        try {
          draft = JSON.parse(sessionStorage.getItem(RESET_DRAFT_KEY));
        } catch {
          draft = null;
        }
        if (!draft || !draft.email) {
          window.location.href = "forgot-password.html";
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Verifying...";
        try {
          await apiVerifyPasswordResetCode(draft.email, code);
          sessionStorage.setItem(RESET_DRAFT_KEY, JSON.stringify({ email: draft.email, code }));
          window.location.href = form.dataset.goto;
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = "Enter";
        }
        return;
      }

      // Forgot Password step 3 (reset-password.html): sets the new password
      // and clears the draft — the flow is done either way after this.
      if (form.dataset.forgotConfirm !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const password = form.querySelector('[name="password"]');
        const confirmPassword = form.querySelector('[name="confirmPassword"]');
        clearFormError(form);

        let draft = null;
        try {
          draft = JSON.parse(sessionStorage.getItem(RESET_DRAFT_KEY));
        } catch {
          draft = null;
        }
        if (!draft || !draft.email || !draft.code) {
          window.location.href = "forgot-password.html";
          return;
        }
        if (password.value !== confirmPassword.value) {
          showFormError(form, "Passwords do not match.");
          return;
        }
        const passwordError = getPasswordRequirementError(password.value, { email: draft.email });
        if (passwordError) {
          showFormError(form, passwordError);
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Resetting...";
        try {
          await apiConfirmPasswordReset(draft.email, draft.code, password.value);
          sessionStorage.removeItem(RESET_DRAFT_KEY);
          window.location.href = form.dataset.goto;
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = "Reset Password";
        }
        return;
      }

      // The login form hits the real API instead of just navigating. Login
      // is by email only — anything that isn't an email address (e.g. a
      // phone number) gets the same "Incorrect email or password." a wrong
      // password does, without a trip to the server.
      if (form.dataset.login !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const emailField = form.querySelector('[name="email"]');
        const passwordField = form.querySelector('[name="password"]');
        const rememberField = form.querySelector('[name="rememberMe"]');
        clearFormError(form);

        // A Staff/Administrator account an admin created (see
        // accounts/serializers.py's AdminCreateUserSerializer) has no password
        // yet, so its first login is just the email — leaving Password blank and
        // clicking Login Now starts that setup. A normal login (password filled
        // in) skips this entirely.
        if (!passwordField.value) {
          showFormError(form, "Enter your email and password to log in.");
          return;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim())) {
          showFormError(form, "Incorrect email or password.");
          return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Logging in...";
        try {
          const role = await apiLogin(emailField.value.trim(), passwordField.value, !!(rememberField && rememberField.checked));
          window.location.href = loginHome(role) || form.dataset.goto;
        } catch (err) {
          showFormError(form, err.message);
          submitBtn.disabled = false;
          submitBtn.textContent = "Login Now";
        }
        return;
      }

      window.location.href = form.dataset.goto;
    });
  });

  // ---- Account setup / first-login screen (account-setup.html) ----
  // Opened from the emailed link (#uid=...&token=...): checks the link, then
  // shows the details form — pre-filled for a citizen an Administrator
  // created with their details — plus the new password. Opened without a
  // link (the login page's "First time here?"), or with an expired one, it
  // offers to email a new link instead. Guarded on the forms existing since
  // this only ever runs on account-setup.html.
  const setupRequestForm = document.getElementById("setupRequestForm");
  const setupDetailsForm = document.getElementById("setupDetailsForm");
  if (setupRequestForm && setupDetailsForm) {
    const setupLoading = document.getElementById("setupLoading");
    const setupSent = document.getElementById("setupSent");
    const setupInvalid = document.getElementById("setupInvalid");
    const linkParams = new URLSearchParams(window.location.hash.slice(1));
    const uid = linkParams.get("uid");
    const token = linkParams.get("token");
    let setupEmail = "";

    // Take the token out of the address bar and history right away, so it
    // isn't left behind in the browser or caught in a screenshot.
    if (uid || token) history.replaceState(null, "", window.location.pathname + window.location.search);

    function showSetupStep(step) {
      [setupLoading, setupRequestForm, setupSent, setupInvalid, setupDetailsForm].forEach((el) => {
        el.hidden = el !== step;
      });
    }

    function fillSetupDetails(details) {
      setupEmail = details.email;
      document.getElementById("setupAccountEmail").textContent = details.email;
      document.getElementById("setupHintEmail").value = details.email;
      document.getElementById("setupFirstName").value = details.first_name || "";
      document.getElementById("setupMiddleInitial").value = details.middle_initial || "";
      document.getElementById("setupLastName").value = details.last_name || "";
      document.getElementById("setupPhone").value = details.contact_number || "";
      // Citizen address is stored as sign-up formats it: "Block, Lot, Street".
      const streetField = document.getElementById("setupStreet");
      if (streetField && details.address) {
        const split = details.address.lastIndexOf(", ");
        const street = split === -1 ? "" : details.address.slice(split + 2);
        if (STREETS.includes(street)) {
          streetField.value = street;
          document.getElementById("setupBlockLot").value = details.address.slice(0, split);
        } else {
          document.getElementById("setupBlockLot").value = details.address;
        }
      }
    }

    // The citizen street list loads asynchronously; wait for it before
    // splitting a pre-filled address into street + block/lot.
    const streetsReady =
      typeof ensureStreetsLoaded === "function" ? ensureStreetsLoaded().catch(() => {}) : Promise.resolve();

    if (uid && token) {
      showSetupStep(setupLoading);
      apiCheckSetupLink(uid, token)
        .then((details) => streetsReady.then(() => details))
        .then((details) => {
          fillSetupDetails(details);
          showSetupStep(setupDetailsForm);
          document.getElementById("setupLastName").focus();
        })
        .catch((err) => {
          document.getElementById("setupInvalidMessage").textContent = err.message;
          showSetupStep(setupInvalid);
        });
    } else {
      const emailFromQuery = new URLSearchParams(window.location.search).get("email");
      if (emailFromQuery) document.getElementById("setupEmail").value = emailFromQuery;
      showSetupStep(setupRequestForm);
    }

    setupRequestForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("setupEmail").value.trim();
      const submitBtn = setupRequestForm.querySelector('button[type="submit"]');
      clearFormError(setupRequestForm);
      if (!email) {
        showFormError(setupRequestForm, "Enter the email your account was created with.");
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";
      try {
        await apiRequestSetupLink({ email });
        showSetupStep(setupSent);
      } catch (err) {
        showFormError(setupRequestForm, err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Email Me a Setup Link";
      }
    });

    document.getElementById("setupNewLinkBtn").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        // The expired link still says whose it was, so no need to retype the email.
        await apiRequestSetupLink(uid ? { uid } : { email: setupEmail });
        showSetupStep(setupSent);
      } catch (err) {
        document.getElementById("setupInvalidMessage").textContent = err.message;
      } finally {
        btn.disabled = false;
      }
    });

    setupDetailsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const lastName = document.getElementById("setupLastName");
      const firstName = document.getElementById("setupFirstName");
      const middleInitial = document.getElementById("setupMiddleInitial");
      const phone = document.getElementById("setupPhone");
      const password = document.getElementById("setupPassword");
      const confirmPassword = document.getElementById("setupConfirmPassword");
      const submitBtn = setupDetailsForm.querySelector('button[type="submit"]');
      clearFormError(setupDetailsForm);
      clearFieldInvalid(phone);

      if (password.value !== confirmPassword.value) {
        showFormError(setupDetailsForm, "Passwords do not match.");
        return;
      }
      const passwordError = getPasswordRequirementError(password.value, {
        firstName: firstName.value,
        lastName: lastName.value,
        email: setupEmail,
      });
      if (passwordError) {
        showFormError(setupDetailsForm, passwordError);
        return;
      }

      // Citizen setup also asks for the address (sign-up's format: "Block, Lot, Street").
      const streetField = document.getElementById("setupStreet");
      let address;
      if (streetField) {
        clearFieldInvalid(streetField);
        const street = streetField.value.trim();
        if (!STREETS.includes(street)) {
          markFieldInvalid(streetField, "Please select a street from the list.");
          return;
        }
        address = `${document.getElementById("setupBlockLot").value.trim()}, ${street}`;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Setting up...";
      try {
        const role = await apiCompleteAccountSetup(uid, token, {
          first_name: firstName.value.trim(),
          middle_initial: middleInitial.value.trim(),
          last_name: lastName.value.trim(),
          contact_number: phone.value.trim(),
          password: password.value,
          address,
        });
        window.location.href = loginHome(role) || "index.html";
      } catch (err) {
        if (err.fields && err.fields.contact_number) {
          markFieldInvalid(phone, err.fields.contact_number[0]);
        } else {
          showFormError(setupDetailsForm, err.message);
        }
        submitBtn.disabled = false;
        submitBtn.textContent = "Complete Setup";
      }
    });
  }

  // Confirm-password validation
  const pw = document.querySelector('[name="password"]');
  const confirmPw = document.querySelector('[name="confirmPassword"]');
  if (pw && confirmPw) {
    const validate = () => {
      confirmPw.setCustomValidity(
        confirmPw.value && confirmPw.value !== pw.value ? "Passwords do not match" : ""
      );
    };
    pw.addEventListener("input", validate);
    confirmPw.addEventListener("input", validate);
  }

  // Numeric-only, auto-advancing feel for one-time-code fields
  document.querySelectorAll('[name="code"]').forEach((input) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });
  });

  // Footer (info section) only fades into view once scrolled into the viewport
  const infoSection = document.querySelector(".info-section");
  if (infoSection) {
    const revealOnScroll = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealOnScroll.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealOnScroll.observe(infoSection);
  }

  // Voter's ID upload preview (Sign Up verification step)
  const idInput = document.getElementById("idPhoto");
  if (idInput) {
    // The preview sits inside the dropzone label, replacing the camera icon;
    // clicking the photo reopens the picker to swap it.
    const preview = document.getElementById("idPreview");
    const drop = preview.closest(".upload-drop");
    idInput.addEventListener("change", () => {
      const file = idInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.hidden = false;
        if (drop) drop.classList.add("upload-drop--has-preview");
      };
      reader.readAsDataURL(file);
    });
    if (idInput.form) {
      idInput.form.addEventListener("reset", () => {
        preview.hidden = true;
        preview.removeAttribute("src");
        if (drop) drop.classList.remove("upload-drop--has-preview");
      });
    }
  }

  // Generic dropzone label text + drag-and-drop: shows the selected
  // filename(s), restores the placeholder copy on form reset, and actually
  // implements the "drag & drop" the dropzone copy invites (browsers don't
  // populate a hidden file input from a drop event on their own). Covers
  // Voter's ID, report, and suggestion uploads.
  //
  // Selects the LABEL first, then resolves its input via `.control` —
  // these labels reference their input through for="…"/id="…" as siblings,
  // not by wrapping it, so a selector like `.upload-drop input` (requiring
  // the input to be a descendant) would never match anything here.
  const MAX_EVIDENCE_FILES = 5;

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  document.querySelectorAll("label.upload-drop").forEach((label) => {
    const input = label.control;
    if (!input || input.type !== "file") return;
    const textEl = label.querySelector(".upload-drop__text");
    if (!textEl) return;
    const defaultText = textEl.textContent;

    // Multi-file inputs (report / suggestion evidence) get an "evidence tray"
    // below the dropzone: every chosen photo/video shows as a chip with a
    // thumbnail, a View link (opens the file in a new tab) and a Remove
    // button, so a resident can drop the wrong file and swap just that one
    // instead of clearing the whole selection. `picked` is the source of
    // truth; input.files is rebuilt from it via DataTransfer after every
    // add/remove. Single-file inputs (Voter's ID) keep the old behavior.
    const isMulti = input.multiple;
    let picked = [];
    let tray = null;
    const objectUrls = new Set();

    function releaseObjectUrls() {
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.clear();
    }

    function syncInputFiles() {
      const dt = new DataTransfer();
      picked.forEach((file) => dt.items.add(file));
      input.files = dt.files;
    }

    function updateLabelText() {
      const count = input.files.length;
      textEl.textContent = !count
        ? defaultText
        : count === 1
          ? input.files[0].name
          : `${count} files selected`;
    }

    function renderTray() {
      if (!isMulti) return;
      if (!tray) {
        tray = document.createElement("ul");
        tray.className = "evidence-list";
        input.insertAdjacentElement("afterend", tray);
      }
      releaseObjectUrls();
      tray.textContent = "";
      tray.hidden = picked.length === 0;

      if (picked.length) {
        const caption = document.createElement("li");
        caption.className = "evidence-list__caption";
        caption.textContent = `${picked.length} of ${MAX_EVIDENCE_FILES} files added`;
        tray.appendChild(caption);
      }

      picked.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        objectUrls.add(url);
        const isImage = file.type.startsWith("image/");

        const item = document.createElement("li");
        item.className = "evidence-list__item";

        const thumb = document.createElement("span");
        thumb.className = "evidence-list__thumb";
        if (isImage) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = "";
          thumb.appendChild(img);
        } else {
          thumb.textContent = "\u{1F3AC}";
        }

        const meta = document.createElement("span");
        meta.className = "evidence-list__meta";
        const name = document.createElement("span");
        name.className = "evidence-list__name";
        name.textContent = file.name;
        const size = document.createElement("span");
        size.className = "evidence-list__size";
        size.textContent = formatBytes(file.size);
        meta.append(name, size);

        const view = document.createElement("a");
        view.className = "evidence-list__view";
        view.href = url;
        view.target = "_blank";
        view.rel = "noopener";
        view.textContent = "View";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "evidence-list__remove";
        remove.setAttribute("aria-label", `Remove ${file.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          picked.splice(index, 1);
          syncInputFiles();
          updateLabelText();
          renderTray();
        });

        item.append(thumb, meta, view, remove);
        tray.appendChild(item);
      });
    }

    function addFiles(fileList) {
      const incoming = Array.from(fileList);
      if (!incoming.length) return;
      for (const file of incoming) {
        const dupe = picked.some(
          (f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified
        );
        if (!dupe && picked.length < MAX_EVIDENCE_FILES) picked.push(file);
      }
      syncInputFiles();
      updateLabelText();
      renderTray();
    }

    input.addEventListener("change", () => {
      if (!isMulti) {
        updateLabelText();
        return;
      }
      // A native re-pick replaces the FileList; fold it into `picked` so
      // earlier selections aren't lost, then re-sync from `picked`.
      addFiles(input.files);
    });

    if (input.form) {
      input.form.addEventListener("reset", () => {
        picked = [];
        releaseObjectUrls();
        if (tray) {
          tray.textContent = "";
          tray.hidden = true;
        }
        textEl.textContent = defaultText;
      });
    }

    ["dragenter", "dragover"].forEach((evt) => {
      label.addEventListener(evt, (e) => {
        e.preventDefault();
        label.classList.add("upload-drop--dragover");
      });
    });
    ["dragleave", "dragend", "drop"].forEach((evt) => {
      label.addEventListener(evt, (e) => {
        e.preventDefault();
        label.classList.remove("upload-drop--dragover");
      });
    });
    label.addEventListener("drop", (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      if (isMulti) {
        addFiles(e.dataTransfer.files);
      } else {
        input.files = e.dataTransfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  });

  // Forms that submit into a confirmation modal instead of a full page nav,
  // then redirect once the user confirms (File Report, Submit Suggestion).
  document.querySelectorAll("form[data-success-modal]").forEach((form) => {
    const modal = document.getElementById(form.dataset.successModal);
    if (!modal) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      modal.hidden = false;
    });
    modal.querySelectorAll("[data-modal-confirm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        window.location.href = form.dataset.redirect || "index.html";
      });
    });
  });

  // ---- Mobile nav (hamburger) ----
  // Injected via JS rather than duplicated into every page's navbar markup
  // (same approach as the admin sidebar's mobile backdrop). Below ~860px,
  // style.css hides .navbar__links by default and only shows it with
  // .is-open — this button is what toggles that.
  const navLinks = document.querySelector(".navbar__links");
  const navBrand = document.querySelector(".navbar__brand");
  if (navLinks && navBrand) {
    const navHamburger = document.createElement("button");
    navHamburger.type = "button";
    navHamburger.className = "navbar__hamburger";
    navHamburger.setAttribute("aria-label", "Toggle menu");
    navHamburger.setAttribute("aria-expanded", "false");
    navHamburger.innerHTML = "&#9776;";
    navBrand.insertAdjacentElement("afterend", navHamburger);

    const navbarEl = navLinks.closest(".navbar");

    const closeNavMenu = () => {
      navLinks.classList.remove("is-open");
      navHamburger.setAttribute("aria-expanded", "false");
    };

    navHamburger.addEventListener("click", () => {
      const isOpen = navLinks.classList.toggle("is-open");
      navHamburger.setAttribute("aria-expanded", String(isOpen));
    });

    // A tapped link (or an auth-gate link that opens a modal instead of
    // navigating) should close the menu rather than leave it open over
    // whatever comes next.
    navLinks.addEventListener("click", (e) => {
      if (e.target.closest("a")) closeNavMenu();
    });

    // Above the ~860px mobile breakpoint, .navbar__links lays out as a
    // normal (non-hamburger) flex row that wraps onto a second line once
    // the links no longer fit — e.g. a window narrower than "desktop" but
    // still wider than the mobile breakpoint. Rather than let that wrap
    // happen, detect it (first and last link landing at different
    // offsetTop means it wrapped) and switch to the same collapsed
    // hamburger treatment the mobile media query uses, via .navbar--compact
    // (see style.css) — so it "compresses" like the mobile view instead of
    // stacking onto a second row.
    function syncNavCompact() {
      if (!navbarEl || window.innerWidth <= 860) return; // CSS media query already handles this width
      navbarEl.classList.remove("navbar--compact");
      // Guests don't see the [data-auth-only] links (My Reports, My
      // Concerns/Suggestions) — they're still in the DOM, just [hidden], so
      // an unfiltered querySelectorAll would include their offsetTop (0,
      // since a hidden element isn't laid out) and always read as "wrapped"
      // against the visible ones, even at a wide desktop width.
      const anchors = Array.from(navLinks.querySelectorAll("a")).filter((a) => a.offsetParent !== null);
      const wrapped = anchors.length > 1 && anchors[0].offsetTop !== anchors[anchors.length - 1].offsetTop;
      navbarEl.classList.toggle("navbar--compact", wrapped);
    }
    syncNavCompact();
    window.addEventListener("load", syncNavCompact); // fonts/images can still shift link widths after first paint

    // Rotating a tablet/resizing past the mobile breakpoint while the menu
    // is open would otherwise leave it stuck open once desktop styles
    // (where .navbar__links is always visible) no longer apply .is-open.
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) closeNavMenu();
      syncNavCompact();
    });
  }

  // ---- Auth-aware nav + account popups ----
  const loggedIn = isLoggedIn();
  const user = getCurrentUser();

  // Bell + My Reports + My Concerns/Suggestions only show while logged in
  document.querySelectorAll("[data-auth-only]").forEach((el) => {
    el.hidden = !loggedIn;
  });

  // File Report / Submit Suggestion nav links: guests get a sign-up/login
  // prompt instead of the form.
  const authGateModal = document.getElementById("authGateModal");
  const authGateTitle = document.getElementById("authGateTitle");
  // Delegated so links added after load (the footer's quick links are rendered
  // by site-footer.js once the barangay details arrive) get the prompt too.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-auth-gate]");
    if (!link || loggedIn || !authGateModal || !authGateTitle) return;
    e.preventDefault();
    authGateTitle.textContent =
      link.dataset.authGate === "report"
        ? "Want to Submit a Report?"
        : "Want to Submit a Concern/Suggestion?";
    authGateModal.hidden = false;
  });

  // Profile icon: Guest Account card, or the logged-in account card
  const profileBtn = document.querySelector(".navbar__profile");
  const profileModal = document.getElementById("profileModal");
  const profileGuestView = document.getElementById("profileGuestView");
  const profileUserView = document.getElementById("profileUserView");
  if (profileBtn && profileModal) {
    if (loggedIn && user) {
      renderAvatar(profileBtn, user);
      // Mobile: with no Login/Sign Up to show, the brand/logo makes way for
      // the hamburger so the right side is just notifications + account —
      // see .navbar--authed in style.css (both the real mobile breakpoint
      // and the .navbar--compact fallback). It reappears as the first row
      // of the hamburger dropdown instead, cloned from the real brand
      // element so it stays in sync with it.
      const navbarEl = profileBtn.closest(".navbar");
      if (navbarEl) {
        navbarEl.classList.add("navbar--authed");
        const brand = navbarEl.querySelector(".navbar__brand");
        if (navLinks && brand) {
          const brandItem = document.createElement("li");
          brandItem.className = "navbar__links-brand";
          brandItem.style.cursor = "pointer";
          brandItem.innerHTML = brand.innerHTML;
          // Same destination as the top-row brand's own click handler
          // (set up earlier in this same DOMContentLoaded handler) — that
          // one only targets .navbar__brand, not this clone.
          brandItem.addEventListener("click", () => {
            window.location.href = "/citizen/about.html";
          });
          navLinks.insertBefore(brandItem, navLinks.firstChild);
        }
        // Logout, after My Concerns/Suggestions — same confirmation modal
        // as the profile popup's own Log Out button (#logoutBtn), just
        // reachable from the dropdown too.
        if (navLinks) {
          const logoutItem = document.createElement("li");
          logoutItem.className = "navbar__links-logout";
          const logoutLink = document.createElement("a");
          logoutLink.href = "#";
          logoutLink.innerHTML = "&#8618; Logout";
          logoutLink.addEventListener("click", (evt) => {
            evt.preventDefault();
            const confirmModal = document.getElementById("logoutConfirmModal");
            if (confirmModal) confirmModal.hidden = false;
          });
          logoutItem.appendChild(logoutLink);
          navLinks.appendChild(logoutItem);
        }
      }
    } else {
      const loginActive = window.location.pathname.startsWith("/citizen/login");
      const signUpActive = window.location.pathname.endsWith("/signup.html");

      // Desktop/wide: Login + Sign Up sit next to each other in the top
      // row, outside the main link list — both hidden below the mobile
      // breakpoint (see .navbar__profile--login in style.css), where they
      // move into the hamburger dropdown instead (below).
      profileBtn.textContent = "Login";
      profileBtn.classList.add("navbar__profile--login");
      if (loginActive) profileBtn.classList.add("active");

      const signUpLink = document.createElement("a");
      signUpLink.href = "/citizen/signup.html";
      signUpLink.textContent = "Sign Up";
      signUpLink.className = "navbar__profile--login";
      if (signUpActive) signUpLink.classList.add("active");
      profileBtn.insertAdjacentElement("afterend", signUpLink);

      // Mobile: Login and Sign Up live inside the hamburger dropdown after
      // Submit Suggestion instead (appended last — My Reports/My
      // Concerns/Suggestions are [hidden] for guests, so these land right
      // after Submit Suggestion visually) — hidden above the mobile
      // breakpoint (see .navbar__links-login/.navbar__links-signup).
      if (navLinks) {
        const addDropdownLink = (className, href, text, active) => {
          const item = document.createElement("li");
          item.className = className;
          const link = document.createElement("a");
          link.href = href;
          link.textContent = text;
          if (active) link.classList.add("active");
          item.appendChild(link);
          navLinks.appendChild(item);
        };
        addDropdownLink("navbar__links-login", "/citizen/login.html", "Login", loginActive);
        addDropdownLink("navbar__links-signup", "/citizen/signup.html", "Sign Up", signUpActive);
      }
    }

    const openProfileModal = () => {
      if (!(loggedIn && user)) {
        window.location.href = "/citizen/login.html";
        return;
      }
      if (loggedIn && user) {
        profileGuestView.hidden = true;
        profileUserView.hidden = false;
        document.getElementById("profileUserName").textContent = user.name;
        renderAvatar(document.getElementById("profileUserInitials"), user);
      } else {
        profileGuestView.hidden = false;
        profileUserView.hidden = true;
      }
      profileModal.hidden = false;
    };
    profileBtn.addEventListener("click", openProfileModal);
    profileBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProfileModal();
      }
    });
  }

  // Log Out -> confirmation popup -> clears auth and returns to login
  const logoutBtn = document.getElementById("logoutBtn");
  const logoutConfirmModal = document.getElementById("logoutConfirmModal");
  if (logoutBtn && logoutConfirmModal) {
    logoutBtn.addEventListener("click", () => {
      profileModal.hidden = true;
      logoutConfirmModal.hidden = false;
    });
  }
  const logoutYes = document.getElementById("logoutYes");
  const logoutNo = document.getElementById("logoutNo");
  if (logoutYes) {
    logoutYes.addEventListener("click", async () => {
      // Closes out the LoginSession for View Audit Logs — best-effort, since
      // the local session should clear either way. Must happen before
      // logOut() removes the token authFetch needs to authenticate this.
      try {
        await authFetch("/api/auth/logout/", { method: "POST" });
      } catch {
        // ignore — logging out locally still proceeds below
      }
      logOut();
      window.location.href = "/citizen/login.html";
    });
  }
  if (logoutNo) {
    logoutNo.addEventListener("click", () => {
      logoutConfirmModal.hidden = true;
    });
  }

  // Bell icon: toggles the notifications dropdown anchored beneath it, and
  // (while logged in) polls for real status updates on the citizen's own
  // reports/concerns to populate it.
  const notifBell = document.getElementById("notifBell");
  const notifDropdown = document.getElementById("notifDropdown");
  const notifBadge = document.getElementById("notifBadge");
  const notifList = document.getElementById("notifList");
  const notifClearAll = document.getElementById("notifClearAll");

  if (notifBell && notifDropdown && notifList) {
    const renderNotifications = () => {
      const notifications = getCitizenNotifications();
      if (notifBadge) notifBadge.hidden = notifications.length === 0;
      notifList.innerHTML = notifications.length
        ? notifications
            .map(
              (n) => `
              <li class="notif-dropdown__item">
                <div class="notif-dropdown__content" data-goto="${n.id}">
                  <span class="notif-dropdown__message">${n.message}</span>
                  <span class="notif-dropdown__time">${citizenTimeAgo(n.time)}</span>
                </div>
                <button type="button" class="notif-dropdown__dismiss" data-dismiss="${n.id}" aria-label="Dismiss notification">&times;</button>
              </li>`
            )
            .join("")
        : `<li class="notif-dropdown__item">No notifications yet</li>`;
    };
    renderNotifications();

    notifList.addEventListener("click", (e) => {
      const dismissBtn = e.target.closest("[data-dismiss]");
      if (dismissBtn) {
        e.stopPropagation();
        removeCitizenNotification(dismissBtn.dataset.dismiss);
        renderNotifications();
        return;
      }
      // Clicking the notification's content (not the dismiss button)
      // navigates to whatever it's about and clears it, same as reading and
      // acting on it — matches how a notification is a means to an end, not
      // something to keep around once you've followed it.
      const goto = e.target.closest("[data-goto]");
      if (!goto) return;
      const notification = getCitizenNotifications().find((n) => n.id === goto.dataset.goto);
      removeCitizenNotification(goto.dataset.goto);
      if (notification && notification.link) {
        window.location.href = notification.link;
      } else {
        renderNotifications();
      }
    });

    if (notifClearAll) {
      notifClearAll.addEventListener("click", (e) => {
        e.stopPropagation();
        clearAllCitizenNotifications();
        renderNotifications();
      });
    }

    if (loggedIn) {
      Promise.all([checkForReportUpdates(), checkForConcernUpdates()]).then(renderNotifications);
      setInterval(() => {
        Promise.all([checkForReportUpdates(), checkForConcernUpdates()]).then(renderNotifications);
      }, 30000);
    }

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

  // ---- Ask a Question (floating "?" button — on every citizen page) ----
  const askFab = document.getElementById("askQuestionFab");
  const askQuestionModal = document.getElementById("askQuestionModal");
  const askQuestionSentModal = document.getElementById("askQuestionSentModal");
  const askForm = document.getElementById("askQuestionForm");
  const questionInput = document.getElementById("questionInput");

  if (askFab && askQuestionModal) {
    askFab.addEventListener("click", () => {
      if (!isLoggedIn()) {
        if (authGateModal && authGateTitle) {
          authGateTitle.textContent = "Want to Ask a Question?";
          authGateModal.hidden = false;
        }
        return;
      }
      askQuestionModal.hidden = false;
    });
  }

  if (askForm) {
    askForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = askForm.querySelector('button[type="submit"]');
      const value = questionInput.value.trim();
      if (!value) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      try {
        await askQuestion(value);
        questionInput.value = "";
        if (askQuestionModal) askQuestionModal.hidden = true;
        if (askQuestionSentModal) askQuestionSentModal.hidden = false;
      } catch (err) {
        siteAlert(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Question";
      }
    });
  }

  if (askQuestionSentModal) {
    askQuestionSentModal.querySelectorAll("[data-modal-confirm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        askQuestionSentModal.hidden = true;
      });
    });
  }

  // Dismiss: explicit close buttons, or clicking the dimmed backdrop — except
  // [data-modal-mandatory] modals (the signup Terms & Conditions gate),
  // which can only be dismissed by actually agreeing.
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
    });
  });
  document.querySelectorAll(".modal-overlay:not([data-modal-mandatory])").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });

  // ---- Terms & Conditions / Data Privacy gate (Sign Up page only) ----
  const termsModal = document.getElementById("termsModal");
  const termsModalBody = document.getElementById("termsModalBody");
  const termsAgreeBtn = document.getElementById("termsAgreeBtn");
  const signupForm = document.querySelector("form[data-signup-step1]");

  if (signupForm) restoreSignupDraft(signupForm);

  if (termsModal && termsModalBody && termsAgreeBtn) {
    const signupFields = signupForm
      ? signupForm.querySelectorAll("input, select, button, textarea")
      : [];
    let agreed = false;
    try {
      agreed = sessionStorage.getItem(SIGNUP_TERMS_KEY) === "1";
    } catch {}
    if (!agreed) {
      signupFields.forEach((el) => (el.disabled = true));
      termsModal.hidden = false;
    }

    termsAgreeBtn.addEventListener("click", () => {
      termsModal.hidden = true;
      signupFields.forEach((el) => (el.disabled = false));
      try {
        sessionStorage.setItem(SIGNUP_TERMS_KEY, "1");
      } catch {}
    });
  }
});

// Coming back from the ID step ("Back to Sign Up") refills what was typed.
function restoreSignupDraft(form) {
  let draft = null;
  try {
    draft = JSON.parse(sessionStorage.getItem(SIGNUP_DRAFT_KEY));
  } catch {}
  if (!draft) return;
  const set = (selector, value) => {
    const el = form.querySelector(selector);
    if (el && value) el.value = value;
  };
  set('[name="last_name"]', draft.last_name);
  set('[name="first_name"]', draft.first_name);
  set('[name="middle_initial"]', draft.middle_initial);
  set('[name="email"]', draft.email);
  set('[name="phone"]', draft.contact_number);
  set('[name="password"]', draft.password);
  set('[name="confirmPassword"]', draft.password);
  const address = draft.address || "";
  const cut = address.lastIndexOf(", ");
  if (cut !== -1) {
    set("#signupBlockLot", address.slice(0, cut));
    set("#signupStreet", address.slice(cut + 2));
  }
}


// A Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes ignored).
function isValidPhMobile(value) {
  return /^(?:\+?63|0)9\d{9}$/.test(String(value || "").replace(/[\s\-()]/g, ""));
}


// A type-to-filter combobox over the fixed STREETS list (streets-data.js).
function wireStreetCombobox(inputId, listId) {
  const streetInput = document.getElementById(inputId);
  const streetList = document.getElementById(listId);
  if (!streetInput || !streetList) return;
  const renderStreetOptions = () => {
    const query = streetInput.value.trim().toLowerCase();
    const matches = query ? STREETS.filter((s) => s.toLowerCase().includes(query)) : STREETS;
    streetList.innerHTML = matches.length
      ? matches.map((s) => `<li data-value="${s}">${s}</li>`).join("")
      : `<li class="combobox__empty">No matching street</li>`;
    streetList.hidden = false;
  };
  streetInput.addEventListener("focus", renderStreetOptions);
  streetInput.addEventListener("input", renderStreetOptions);
  streetList.addEventListener("click", (e) => {
    const option = e.target.closest("li[data-value]");
    if (!option) return;
    streetInput.value = option.dataset.value;
    streetInput.dispatchEvent(new Event("input", { bubbles: true }));
    streetList.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!streetInput.contains(e.target) && !streetList.contains(e.target)) {
      streetList.hidden = true;
    }
  });
  streetInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") streetList.hidden = true;
  });
}


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
