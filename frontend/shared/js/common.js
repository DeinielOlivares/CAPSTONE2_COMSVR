// common.js — helpers used by the pages of all three portals (citizen, staff, admin).
// Every page loads this file FIRST, before the portal's own scripts.
//
//   1. Login session (stored tokens, current user, authFetch)
//   2. Form messages (form errors, field errors)
//   3. Pop-up dialogs (siteAlert, siteConfirm)
//   4. Loading placeholders (skeletons)
//   5. Lists (filter dropdown, remembered filters, page size)
//   6. "Save Changes?" prompt before leaving a form
//   7. Passwords (rules, live checklist, show/hide button)
//   8. Branding, avatar, favicon, small helpers
//   9. Notifications (the bell)

// ===========================================================================
// 1. Login session
// ===========================================================================
// After logging in, the JWT tokens and a copy of the user's profile are kept
// in sessionStorage (cleared when the tab closes) — or in localStorage if the
// person ticked "Stay signed in".

const API_BASE = "/api/auth";
const AUTH_STORAGE_KEY = "orms_auth_user";
const ACCESS_TOKEN_KEY = "orms_access_token";
const REFRESH_TOKEN_KEY = "orms_refresh_token";
const REMEMBER_KEY = "orms_remember_me"; // "1" = Stay signed in
const LOGIN_AT_KEY = "orms_login_at";
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // a session without "Stay signed in" ends after 1 day

// Which storage holds the session: localStorage ("Stay signed in") or sessionStorage.
function authStorage() {
  return localStorage.getItem(REMEMBER_KEY) === "1" ? localStorage : sessionStorage;
}

function getCurrentUser() {
  try {
    return JSON.parse(authStorage().getItem(AUTH_STORAGE_KEY));
  } catch {
    return null;
  }
}

function getAccessToken() {
  return authStorage().getItem(ACCESS_TOKEN_KEY);
}

function isLoggedIn() {
  return !!getAccessToken();
}

// Removes the session from both storages.
function logOut() {
  [localStorage, sessionStorage].forEach((store) => {
    store.removeItem(AUTH_STORAGE_KEY);
    store.removeItem(ACCESS_TOKEN_KEY);
    store.removeItem(REFRESH_TOKEN_KEY);
    store.removeItem(LOGIN_AT_KEY);
  });
  localStorage.removeItem(REMEMBER_KEY);
}

// Logs out a session without "Stay signed in" that is older than 1 day.
function expireStaleSession() {
  if (localStorage.getItem(REMEMBER_KEY) === "1") return;
  const loginAt = Number(sessionStorage.getItem(LOGIN_AT_KEY));
  if (loginAt && Date.now() - loginAt > SESSION_MAX_AGE_MS) {
    logOut();
  }
}

// Saves the {access, refresh, user} answer of login / account setup.
// Returns the user's role so the caller knows where to go next.
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
      // First + last initial (the full name may include a middle initial).
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

// The access token only lasts 1 hour; this gets a new one using the refresh
// token. Returns true if it worked.
async function refreshAccessToken() {
  const refreshToken = authStorage().getItem(REFRESH_TOKEN_KEY);
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
    // The server also sends a new refresh token (the old one stops working).
    if (data.refresh) store.setItem(REFRESH_TOKEN_KEY, data.refresh);
    return true;
  } catch {
    return false;
  }
}

// fetch() with the logged-in user's token. If the token has expired it is
// refreshed once and the request is sent again. Use this for every API call
// that needs a login.
async function authFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${getAccessToken()}` };
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401 && (await refreshAccessToken())) {
    const retryHeaders = { ...(options.headers || {}), Authorization: `Bearer ${getAccessToken()}` };
    return fetch(path, { ...options, headers: retryHeaders });
  }
  return response;
}

// ===========================================================================
// 2. Form messages
// ===========================================================================

// A red message under the whole form (created the first time it's needed).
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

// Outlines one field in red with a message under it. Cleared when the user types.
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

// A Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces and dashes ignored).
function isValidPhMobile(value) {
  return /^(?:\+?63|0)9\d{9}$/.test(String(value || "").replace(/[\s\-()]/g, ""));
}

// Confirm Password field: marks itself invalid while it differs from Password.
function wireConfirmPasswordCheck() {
  const pw = document.querySelector('[name="password"]');
  const confirmPw = document.querySelector('[name="confirmPassword"]');
  if (!pw || !confirmPw || confirmPw.dataset.checkWired) return;
  confirmPw.dataset.checkWired = "1";
  const validate = () => {
    confirmPw.setCustomValidity(confirmPw.value && confirmPw.value !== pw.value ? "Passwords do not match" : "");
  };
  pw.addEventListener("input", validate);
  confirmPw.addEventListener("input", validate);
}

// 6-digit code fields accept digits only.
function wireCodeInputs() {
  document.querySelectorAll('[name="code"]').forEach((input) => {
    if (input.dataset.codeWired) return;
    input.dataset.codeWired = "1";
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });
  });
}

// ===========================================================================
// 3. Pop-up dialogs — site-styled versions of alert() and confirm()
// ===========================================================================

// Shows a dialog and resolves with the `value` of the button pressed
// (Escape / clicking outside counts as Cancel).
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

// Resolves true (confirmed) or false.
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

// ===========================================================================
// 4. Loading placeholders (grey shimmering bars — see .skeleton in style.css)
// ===========================================================================

function skeletonTableRows(count, columns) {
  const row = `<tr>${Array.from({ length: columns }, () => `<td><span class="skeleton skeleton-text"></span></td>`).join("")}</tr>`;
  return Array.from({ length: count }).fill(row).join("");
}

function skeletonCards(count) {
  const card = `
    <div class="skeleton-card">
      <span class="skeleton skeleton-text skeleton-text--medium"></span>
      <span class="skeleton skeleton-text skeleton-text--short"></span>
    </div>`;
  return Array.from({ length: count }).fill(card).join("");
}

// ===========================================================================
// 5. Lists
// ===========================================================================

// Opens/closes a ".filters-dropdown" panel (sort/filter/page-size selects
// behind one button). The panel's "Clear" button puts every select back to
// its default and fires its change event.
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

// Remembers a list page's filters, search and page number for this browser
// tab (per user, per page), so coming back to the page shows it as it was left.
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
      // Storage blocked (e.g. private mode): filters just aren't remembered.
    }
  }
  return {
    get(field, fallback) {
      return Object.prototype.hasOwnProperty.call(saved, field) ? saved[field] : fallback;
    },
    set,
    // Restores a <select>'s saved choice (if that option still exists) and saves later changes.
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

// ===========================================================================
// 6. "Save Changes?" prompt before leaving a form
// ===========================================================================

// True if anything in the form differs from how the page loaded it.
function formHasEntries(form) {
  return Array.from(form.elements).some((el) => {
    if (el.disabled || el.readOnly) return false;
    if (el.type === "file") return el.files.length > 0;
    if (el.type === "checkbox" || el.type === "radio") return el.checked !== el.defaultChecked;
    if (el.tagName === "SELECT") {
      // Options added by script have no default; the first option counts as it.
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

// When the user clicks any link while the form has unsaved entries, asks
// "Save Changes?" (Save / Discard / Cancel). Closing the tab shows the
// browser's own warning. Call allowLeave() before the page navigates by
// itself (e.g. after a successful submit).
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
      leaving = true; // logging out already asked for confirmation
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

// ===========================================================================
// 7. Passwords
// ===========================================================================
// The same rules the server checks (AUTH_PASSWORD_VALIDATORS in settings.py),
// so most mistakes are caught before submitting. The server still has the
// final say (e.g. its common-password list is much longer than this one).

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

// Checks every rule separately: { length: true, lowercase: false, ... }.
// attrs = the person's firstName/lastName/email (the password can't be too similar).
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

// The first broken rule as a message, or null if the password looks fine.
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

// Live checklist: every <li data-rule="..."> inside a ".password-hint" list
// gets ticked as soon as its rule is met. The list follows the form's first
// password field, or the one named in data-password-field="<id>".
// A list with the class "password-hint--missing-only" (Sign Up) stays hidden
// until data-prompted is set, then shows only the unmet rules.
function setupPasswordHints() {
  document.querySelectorAll(".password-hint").forEach((hintList) => {
    if (hintList.dataset.hintsWired) return;
    const form = hintList.closest("form");
    if (!form) return;
    const passwordField = hintList.dataset.passwordField
      ? document.getElementById(hintList.dataset.passwordField)
      : form.querySelector('input[type="password"]');
    if (!passwordField) return;
    hintList.dataset.hintsWired = "1";
    const firstNameField = form.querySelector('[name="first_name"]');
    const lastNameField = form.querySelector('[name="last_name"]');
    const emailField = form.querySelector('[name="email"]');
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

const EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.2A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a16.6 16.6 0 01-3.4 4.4M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.3 0 2.5-.2 3.6-.6"/><path d="M9.9 10.1a3 3 0 004.1 4.1"/></svg>';

// Adds a show/hide (eye) button to every password field on the page.
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

// ===========================================================================
// 8. Branding, avatar, favicon, small helpers
// ===========================================================================

// Shows the user's uploaded photo in an avatar circle, or their initials.
function renderAvatar(container, user) {
  if (!container) return;
  if (user && user.profilePicture) {
    container.innerHTML = `<img class="avatar-img" src="${user.profilePicture}" alt="" />`;
  } else if (user && user.initials) {
    container.textContent = user.initials;
  }
}

// Sets the browser tab icon.
function setFavicon(url) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = url;
}

// Replaces the brand name and logo (citizen navbar or staff/admin sidebar)
// with the ones set in Admin > Website Setup. If loading fails, the brand
// written in the HTML stays.
function applySiteBranding() {
  fetch("/api/site/branding/")
    .then((r) => (r.ok ? r.json() : null))
    .then((branding) => {
      if (!branding) return;
      if (branding.site_name) {
        // "Name | Kind of system": the part after the bar goes on a smaller second line.
        const [name, ...rest] = branding.site_name.split("|");
        const sub = rest.join("|").trim();
        document.querySelectorAll(".navbar__brand-text, .admin-sidebar__brand-text").forEach((el) => {
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
        document.querySelectorAll(".navbar__logo, .admin-sidebar__logo").forEach((el) => {
          el.style.backgroundImage = `url("${branding.site_logo_url}")`;
        });
        setFavicon(branding.site_logo_url);
      }
    })
    .catch(() => {});
}

// Citizen pages call this right after the navbar markup, so a logged-in
// visitor's navbar is styled correctly before the page is first drawn.
function markNavbarIfLoggedIn() {
  if (!isLoggedIn() || !getCurrentUser()) return;
  const navbar = document.querySelector(".navbar");
  if (navbar) navbar.classList.add("navbar--authed");
}

// "Just now", "5 minutes ago", "2 hours ago", "3 days ago".
function timeAgo(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

// ===========================================================================
// 9. Notifications (the bell)
// ===========================================================================
// Notifications are kept in the browser's localStorage, so they stay while
// moving between pages. Each portal makes its own store (with its own key)
// and decides when to add notifications.

function makeNotifId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A list of {id, message, link, time} saved under `key`, newest first.
function createNotificationStore(key, max = 20) {
  function save(items) {
    localStorage.setItem(key, JSON.stringify(items));
  }
  function list() {
    let items;
    try {
      items = JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      items = [];
    }
    // Old saved notifications may have no id; give them one so they can be dismissed.
    let changed = false;
    items = items.map((n) => {
      if (n.id) return n;
      changed = true;
      return { ...n, id: makeNotifId() };
    });
    if (changed) save(items);
    return items;
  }
  return {
    list,
    // link (optional): the page to open when the notification is clicked.
    add(message, link) {
      const items = list();
      items.unshift({ id: makeNotifId(), message, link: link || null, time: Date.now() });
      save(items.slice(0, max));
    },
    remove(id) {
      save(list().filter((n) => n.id !== id));
    },
    clear() {
      save([]);
    },
  };
}

// HTML for a list of notifications (used by the bell dropdown and the Notifications page).
function notificationItemsHtml(items, itemClass, emptyHtml) {
  if (!items.length) return emptyHtml;
  return items
    .map(
      (n) => `
              <li class="${itemClass}">
                <div class="notif-dropdown__content" data-goto="${n.id}">
                  <span class="notif-dropdown__message">${n.message}</span>
                  <span class="notif-dropdown__time">${timeAgo(n.time)}</span>
                </div>
                <button type="button" class="notif-dropdown__dismiss" data-dismiss="${n.id}" aria-label="Dismiss notification">&times;</button>
              </li>`
    )
    .join("");
}

// Clicking × removes one notification; clicking the text opens its link.
function handleNotificationClick(e, store, render) {
  const dismissBtn = e.target.closest("[data-dismiss]");
  if (dismissBtn) {
    e.stopPropagation(); // don't let the click also close the dropdown
    store.remove(dismissBtn.dataset.dismiss);
    render();
    return;
  }
  const goto = e.target.closest("[data-goto]");
  if (!goto) return;
  const notification = store.list().find((n) => n.id === goto.dataset.goto);
  store.remove(goto.dataset.goto);
  if (notification && notification.link) {
    window.location.href = notification.link;
  } else {
    render();
  }
}

// Wires the bell (#notifBell) and its dropdown, which have the same markup on
// every portal. Returns { render, open } so the portal can refresh it after
// checking for new notifications, or null if the page has no bell.
function setupNotificationBell(store) {
  const bell = document.getElementById("notifBell");
  const dropdown = document.getElementById("notifDropdown");
  const badge = document.getElementById("notifBadge");
  const listEl = document.getElementById("notifList");
  const clearAllBtn = document.getElementById("notifClearAll");
  if (!bell || !dropdown || !listEl) return null;

  function render() {
    const items = store.list();
    if (badge) badge.hidden = items.length === 0;
    listEl.innerHTML = notificationItemsHtml(items, "notif-dropdown__item", `<li class="notif-dropdown__item">No notifications yet</li>`);
  }
  render();

  listEl.addEventListener("click", (e) => handleNotificationClick(e, store, render));

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.clear();
      render();
    });
  }

  const toggle = () => {
    dropdown.hidden = !dropdown.hidden;
    if (!dropdown.hidden) render();
  };
  bell.addEventListener("click", (e) => {
    e.stopPropagation();
    toggle();
  });
  bell.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.hidden && !bell.contains(e.target)) dropdown.hidden = true;
  });

  return {
    render,
    // Opens the dropdown and briefly pulses the bell (for brand-new items).
    open() {
      dropdown.hidden = false;
      bell.classList.remove("navbar__bell--flash");
      void bell.offsetWidth; // restarts the animation if it's still running
      bell.classList.add("navbar__bell--flash");
    },
    dropdown,
  };
}
