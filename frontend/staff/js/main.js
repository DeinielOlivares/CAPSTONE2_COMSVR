// Barangay Platero OVRMS — shared front-end behavior, wired to the Django REST API.

// The API is served from the same host as this frontend (see
// WHITENOISE_ROOT in settings.py), so a relative path works both in local
// dev and once deployed — no hardcoded domain to update later.
const API_BASE = "/api/auth";

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
  citizen: "/citizen/ordinances.html",
  staff: "/staff/reports-dashboard.html",
  admin: "/admin/approve-accounts.html",
};

// Each Barangay Staff role sees a different slice of the Staff Portal (see
// frontend/staff/js/admin.js's STAFF_NAV_ACCESS for the full breakdown) —
// this is just where they land right after logging in/finishing setup.
const STAFF_POSITION_HOME = {
  "Barangay Captain": "/staff/reports-dashboard.html",
  Secretary: "/staff/secretary-dashboard.html",
  Investigator: "/staff/investigator-dashboard.html",
};

// Works out where to send someone right after apiLogin/apiCompleteStaffSetup
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

// Ordinances are a shared/global list rather than something a citizen owns,
// so unlike the report/concern checks above, the very first-ever poll
// (localStorage key never set at all) silently baselines every ordinance
// that already exists — otherwise a brand-new citizen would get flooded
// with "new ordinance" notices for the whole existing library.
const ORDINANCE_SNAPSHOT_KEY = "orms_citizen_ordinance_snapshot";

async function checkForOrdinanceUpdates() {
  let list;
  try {
    const res = await fetch("/api/ordinances/");
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  const neverChecked = localStorage.getItem(ORDINANCE_SNAPSHOT_KEY) === null;
  const snapshot = getNotifSnapshot(ORDINANCE_SNAPSHOT_KEY);
  list.forEach((o) => {
    const hash = `${o.title}|${o.description}|${o.updated_at}`;
    const isFirstSight = !(o.id in snapshot);
    if (isFirstSight) {
      if (!neverChecked) addCitizenNotification(`A new ordinance was uploaded: ${o.number} — ${o.title}`, `ordinance-detail.html?id=${o.id}`);
    } else if (snapshot[o.id] !== hash) {
      addCitizenNotification(`Ordinance ${o.number} — ${o.title} was updated.`, `ordinance-detail.html?id=${o.id}`);
    }
    snapshot[o.id] = hash;
  });
  setNotifSnapshot(ORDINANCE_SNAPSHOT_KEY, snapshot);
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

// Shared by apiLogin and apiCompleteStaffSetup below — both endpoints
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
      body: JSON.stringify({ email, password, portal: "staff" }),
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

// Staff account setup (Barangay Staff/Administrator accounts an admin
// created with just an email + role — see accounts/serializers.py's
// AdminCreateUserSerializer) — frontend/staff/account-setup.html's flow.

// Step 1: emails a code to an account still waiting on setup. The answer is the
// same whether or not the email matches one — the backend deliberately doesn't
// reveal which staff emails exist — so the UI just tells the person to check
// their inbox. The code is then checked with apiVerifyPasswordResetCode.
async function apiRequestStaffSetupCode(email) {
  let response;
  try {
    response = await fetch(`${API_BASE}/staff-setup/request-code/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  } catch {
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not send a setup code. Please try again.");
  }
  return response.json();
}

// Step 2: supplies name/phone/password, and logs the account straight in —
// same session-storing behavior as apiLogin, since the response is shaped
// identically (see StaffAccountSetupView).
async function apiCompleteStaffSetup(email, code, details) {
  let response;
  try {
    response = await fetch(`${API_BASE}/staff-setup/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, ...details }),
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

// Highlights one input red with an inline message underneath it — for
// mistakes tied to a specific field (e.g. a duplicate phone number) rather
// than the whole form.
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

document.addEventListener("DOMContentLoaded", () => {
  expireStaleSession();
  enforcePortalAccess();
  setupPasswordHints();
  setupPasswordVisibilityToggles();

  // Sign Up's Street field: a type-to-filter combobox over the fixed
  // STREETS list (streets-data.js), same pattern as File Report's location
  // field. Guarded on STREETS existing since not every page that loads
  // main.js also loads streets-data.js.
  if (typeof STREETS !== "undefined") {
    const streetInput = document.getElementById("signupStreet");
    const streetList = document.getElementById("signupStreetList");
    if (streetInput && streetList) {
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
        const firstName = form.querySelector('[name="first_name"]').value.trim();
        const lastName = form.querySelector('[name="last_name"]').value.trim();
        const email = form.querySelector('[name="email"]').value.trim();
        clearFormError(form);
        if (password.value !== confirmPassword.value) {
          showFormError(form, "Passwords do not match.");
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
        const streetField = document.getElementById("signupStreet");
        const blockLotField = document.getElementById("signupBlockLot");
        const street = streetField ? streetField.value.trim() : "";
        const blockLot = blockLotField ? blockLotField.value.trim() : "";
        if (streetField && typeof STREETS !== "undefined" && !STREETS.includes(street)) {
          showFormError(form, "Please select a street from the list.");
          return;
        }

        sessionStorage.setItem(
          SIGNUP_DRAFT_KEY,
          JSON.stringify({
            email,
            password: password.value,
            first_name: firstName,
            last_name: lastName,
            contact_number: form.querySelector('[name="phone"]').value.trim(),
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
          showFormError(form, "Please upload a photo of your Voter's ID.");
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

      // The login form hits the real API instead of just navigating.
      // (Note: "Email or Phone" field currently requires an email — phone
      // login isn't implemented on the backend yet.)
      if (form.dataset.login !== undefined) {
        const submitBtn = form.querySelector('button[type="submit"]');
        const emailField = form.querySelector('[name="emailOrPhone"]');
        const passwordField = form.querySelector('[name="password"]');
        const rememberField = form.querySelector('[name="rememberMe"]');
        clearFormError(form);

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

  // ---- Staff account setup (frontend/staff/account-setup.html) ----
  // Step 1: email -> a code is emailed (if the email has an account waiting on
  // setup; the page can't tell, by design). Step 2: enter the code. Step 3:
  // name/phone/password, then logs the account straight in. Guarded on the
  // forms existing since this only ever runs on account-setup.html.
  const staffSetupEmailForm = document.getElementById("staffSetupEmailForm");
  const staffSetupCodeForm = document.getElementById("staffSetupCodeForm");
  const staffSetupDetailsForm = document.getElementById("staffSetupDetailsForm");
  if (staffSetupEmailForm && staffSetupCodeForm && staffSetupDetailsForm) {
    let setupEmail = "";
    let setupCode = "";
    const setupEmailField = document.getElementById("setupEmail");
    const setupCodeField = document.getElementById("setupCode");

    async function sendCodeAndAdvance(email) {
      const submitBtn = staffSetupEmailForm.querySelector('button[type="submit"]');
      clearFormError(staffSetupEmailForm);
      if (!email) {
        showFormError(staffSetupEmailForm, "Enter the email your account was created with.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Sending...";
      try {
        await apiRequestStaffSetupCode(email);
        setupEmail = email;
        document.getElementById("setupCodeEmail").textContent = email;
        staffSetupEmailForm.hidden = true;
        staffSetupCodeForm.hidden = false;
        setupCodeField.focus();
      } catch (err) {
        showFormError(staffSetupEmailForm, err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Code";
      }
    }

    // Coming from the Staff Portal's own login form (Password left blank —
    // see main.js's login handler above) skips retyping the email: it's
    // passed along in the URL. The code is only sent once they confirm here,
    // not automatically, so following a link can't trigger emails.
    const emailFromQuery = new URLSearchParams(window.location.search).get("email");
    if (emailFromQuery) setupEmailField.value = emailFromQuery;
    // The link in the account-creation email already has a code sent, so go
    // straight to the code step rather than sending another (which would
    // invalidate the one in the email).
    if (emailFromQuery && new URLSearchParams(window.location.search).get("sent")) {
      setupEmail = emailFromQuery;
      document.getElementById("setupCodeEmail").textContent = emailFromQuery;
      staffSetupEmailForm.hidden = true;
      staffSetupCodeForm.hidden = false;
      setupCodeField.focus();
    }

    staffSetupEmailForm.addEventListener("submit", (e) => {
      e.preventDefault();
      sendCodeAndAdvance(setupEmailField.value.trim());
    });

    document.getElementById("setupResendCode").addEventListener("click", async (e) => {
      e.preventDefault();
      clearFormError(staffSetupCodeForm);
      try {
        await apiRequestStaffSetupCode(setupEmail);
        showFormError(staffSetupCodeForm, "A new code has been sent. Only the newest one works.");
      } catch (err) {
        showFormError(staffSetupCodeForm, err.message);
      }
    });

    staffSetupCodeForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = staffSetupCodeForm.querySelector('button[type="submit"]');
      clearFormError(staffSetupCodeForm);
      const code = setupCodeField.value.trim();
      if (code.length !== 6) {
        showFormError(staffSetupCodeForm, "Enter the 6-digit code from the email.");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Checking...";
      try {
        await apiVerifyPasswordResetCode(setupEmail, code);
        setupCode = code;
        staffSetupCodeForm.hidden = true;
        staffSetupDetailsForm.hidden = false;
      } catch (err) {
        showFormError(staffSetupCodeForm, err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Verify Code";
      }
    });

    staffSetupDetailsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const lastName = document.getElementById("setupLastName");
      const firstName = document.getElementById("setupFirstName");
      const middleInitial = document.getElementById("setupMiddleInitial");
      const phone = document.getElementById("setupPhone");
      const password = document.getElementById("setupPassword");
      const confirmPassword = document.getElementById("setupConfirmPassword");
      const submitBtn = staffSetupDetailsForm.querySelector('button[type="submit"]');
      clearFormError(staffSetupDetailsForm);
      clearFieldInvalid(phone);

      if (password.value !== confirmPassword.value) {
        showFormError(staffSetupDetailsForm, "Passwords do not match.");
        return;
      }
      const passwordError = getPasswordRequirementError(password.value, {
        firstName: firstName.value,
        lastName: lastName.value,
        email: setupEmail,
      });
      if (passwordError) {
        showFormError(staffSetupDetailsForm, passwordError);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = "Setting up...";
      try {
        const role = await apiCompleteStaffSetup(setupEmail, setupCode, {
          first_name: firstName.value.trim(),
          middle_initial: middleInitial.value.trim(),
          last_name: lastName.value.trim(),
          contact_number: phone.value.trim(),
          password: password.value,
        });
        window.location.href = loginHome(role) || "index.html";
      } catch (err) {
        if (err.fields && err.fields.contact_number) {
          markFieldInvalid(phone, err.fields.contact_number[0]);
        } else {
          showFormError(staffSetupDetailsForm, err.message);
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
    const preview = document.getElementById("idPreview");
    idInput.addEventListener("change", () => {
      const file = idInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.hidden = false;
      };
      reader.readAsDataURL(file);
    });
    if (idInput.form) {
      idInput.form.addEventListener("reset", () => {
        preview.hidden = true;
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

    // Rotating a tablet/resizing past the mobile breakpoint while the menu
    // is open would otherwise leave it stuck open once desktop styles
    // (where .navbar__links is always visible) no longer apply .is-open.
    window.addEventListener("resize", () => {
      if (window.innerWidth > 860) closeNavMenu();
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
  if (authGateModal && authGateTitle) {
    document.querySelectorAll("[data-auth-gate]").forEach((link) => {
      link.addEventListener("click", (e) => {
        if (loggedIn) return;
        e.preventDefault();
        authGateTitle.textContent =
          link.dataset.authGate === "report"
            ? "Want to Submit a Report?"
            : "Want to Submit a Concern/Suggestion?";
        authGateModal.hidden = false;
      });
    });
  }

  // Profile icon: Guest Account card, or the logged-in account card
  const profileBtn = document.querySelector(".navbar__profile");
  const profileModal = document.getElementById("profileModal");
  const profileGuestView = document.getElementById("profileGuestView");
  const profileUserView = document.getElementById("profileUserView");
  if (profileBtn && profileModal) {
    if (loggedIn && user) renderAvatar(profileBtn, user);

    const openProfileModal = () => {
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
      window.location.href = "index.html";
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
      Promise.all([checkForReportUpdates(), checkForConcernUpdates(), checkForOrdinanceUpdates()]).then(renderNotifications);
      setInterval(() => {
        Promise.all([checkForReportUpdates(), checkForConcernUpdates(), checkForOrdinanceUpdates()]).then(renderNotifications);
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

  // Dismiss: explicit close buttons, or clicking the dimmed backdrop
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
});
