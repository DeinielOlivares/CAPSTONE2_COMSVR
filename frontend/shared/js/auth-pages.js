// auth-pages.js — the "account" pages of the citizen and staff portals:
//
//   Login .................. login.html (citizen), index.html (staff)
//   Sign Up (3 steps) ...... signup.html -> verify-email.html -> verify-signup.html (citizen only)
//   Forgot Password ........ forgot-password.html -> verify-code.html -> reset-password.html
//   Account setup .......... account-setup.html (opened from the emailed setup link)
//   Admin reset link ....... new-password.html (staff only)
//
// Each part only runs if its form is on the page. Load after common.js.

// The portal this page belongs to ("citizen" or "staff"), sent with the login
// so each login page only accepts its own kind of account.
const AUTH_PORTAL = window.location.pathname.startsWith("/staff/") ? "staff" : "citizen";

// Where each kind of account goes right after logging in.
const ROLE_HOME = {
  citizen: "/citizen/home.html",
  staff: "/staff/reports-dashboard.html",
  admin: "/admin/approve-accounts.html",
};
const STAFF_POSITION_HOME = {
  "Barangay Captain": "/staff/reports-dashboard.html",
  Secretary: "/staff/secretary-dashboard.html",
  Investigator: "/staff/investigator-dashboard.html",
};

function loginHome(role) {
  if (role === "staff") {
    const user = getCurrentUser();
    return (user && STAFF_POSITION_HOME[user.position]) || ROLE_HOME.staff;
  }
  return ROLE_HOME[role];
}

// Sign Up keeps step 1's fields here while the person picks their ID photo on step 2.
const SIGNUP_DRAFT_KEY = "orms_signup_draft";
const SIGNUP_TERMS_KEY = "orms_signup_terms_agreed";
// Forgot Password keeps the email (and later the verified code) here between its 3 pages.
const RESET_DRAFT_KEY = "orms_reset_draft";

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

// ---------------------------------------------------------------------------
// API calls (all under /api/auth/)
// ---------------------------------------------------------------------------

// POST to /api/auth/<path>. Throws a readable Error if the server can't be
// reached, or (when the answer isn't OK) with the server's message.
// `fallback` is used when the server sent no message we can show.
async function postAuth(path, body, fallback, { useDetail = true, json = true } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}/${path}`, {
      method: "POST",
      headers: json ? { "Content-Type": "application/json" } : {},
      body: json ? JSON.stringify(body) : body,
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = Object.values(data)[0];
    const fieldMessage = Array.isArray(firstError) ? firstError[0] : null;
    const err = new Error((useDetail && data.detail) || fieldMessage || fallback);
    err.fields = data;
    throw err;
  }
  return data;
}

async function apiLogin(email, password, remember) {
  let response;
  try {
    response = await fetch(`${API_BASE}/login/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, portal: AUTH_PORTAL }),
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (!response.ok) {
    // Shows the server's reason (e.g. "still under verification").
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Incorrect email or password.");
  }
  return storeAuthSession(await response.json(), remember);
}

// Sign Up step 1: is the email / phone number still free? Returns {} if both
// are free, otherwise {field: [message]}.
async function apiCheckAvailability(email, contact_number) {
  let response;
  try {
    response = await fetch(`${API_BASE}/check-availability/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, contact_number }),
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }
  if (response.ok) return {};
  if (response.status !== 400) throw new Error("Could not check that information. Please try again.");
  return response.json();
}

// Sign Up email check: emails a 6-digit code to the address typed on step 1.
function apiRequestSignupCode(email) {
  return postAuth("signup/request-code/", { email }, "Could not send a verification code.", { useDetail: false });
}

// Returns { email_verification_token } once the code is right; /register/ needs it.
function apiVerifySignupCode(email, code) {
  return postAuth("signup/verify-code/", { email, code }, "Invalid or expired code.", { useDetail: false });
}

// Sign Up step 2: creates the account (text fields + voter's ID photo).
function apiRegister(formData) {
  return postAuth("register/", formData, "Could not create your account.", { useDetail: false, json: false });
}

function apiRequestPasswordReset(email) {
  return postAuth("password-reset/request/", { email }, "Could not send a reset code.", { useDetail: false });
}

function apiVerifyPasswordResetCode(email, code) {
  return postAuth("password-reset/verify/", { email, code }, "Invalid or expired code.", { useDetail: false });
}

function apiConfirmPasswordReset(email, code, password) {
  return postAuth("password-reset/confirm/", { email, code, password }, "Could not reset your password.", { useDetail: false });
}

// Account setup link: returns the details to pre-fill, or throws "expired / already used".
function apiCheckSetupLink(uid, token) {
  return postAuth("account-setup/check/", { uid, token }, "This setup link isn't valid.");
}

// Emails a new setup link, by { email } or { uid } (of an expired link).
function apiRequestSetupLink(body) {
  return postAuth("account-setup/request-link/", body, "Could not send a setup link. Please try again.");
}

// Saves the details + password and logs the person in.
async function apiCompleteAccountSetup(uid, token, details) {
  const data = await postAuth("account-setup/", { uid, token, ...details }, "Could not complete account setup.");
  return storeAuthSession(data, false);
}

// Administrator-sent reset link (staff/administrator accounts).
function apiCheckResetLink(uid, token) {
  return postAuth("password-link/check/", { uid, token }, "This reset link isn't valid.");
}

function apiConfirmResetLink(uid, token, password) {
  return postAuth("password-link/", { uid, token, password }, "Could not reset your password.");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function readDraft(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

// Disables a submit button while a request runs and puts its label back after.
function setBusy(button, busyText, idleText) {
  button.disabled = !!busyText;
  button.textContent = busyText || idleText;
}

// ---------------------------------------------------------------------------
// Login, Sign Up and Forgot Password forms (<form data-goto="next.html" data-...>)
// ---------------------------------------------------------------------------

async function handleLogin(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const emailField = form.querySelector('[name="email"]');
  const passwordField = form.querySelector('[name="password"]');
  const rememberField = form.querySelector('[name="rememberMe"]');
  clearFormError(form);

  if (AUTH_PORTAL === "citizen" && !passwordField.value) {
    showFormError(form, "Enter your email and password to log in.");
    return;
  }
  // Anything that isn't an email gets the same answer as a wrong password.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim())) {
    showFormError(form, "Incorrect email or password.");
    return;
  }

  setBusy(submitBtn, "Logging in...");
  try {
    const role = await apiLogin(emailField.value.trim(), passwordField.value, !!(rememberField && rememberField.checked));
    window.location.href = loginHome(role) || form.dataset.goto;
  } catch (err) {
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Login Now");
  }
}

// Sign Up step 1: check everything, then keep the fields for step 2.
async function handleSignupStep1(form) {
  const password = form.querySelector('[name="password"]');
  const confirmPassword = form.querySelector('[name="confirmPassword"]');
  const middleInitialField = form.querySelector('[name="middle_initial"]');
  const emailField = form.querySelector('[name="email"]');
  const phoneField = form.querySelector('[name="phone"]');
  const firstName = form.querySelector('[name="first_name"]').value.trim();
  const lastName = form.querySelector('[name="last_name"]').value.trim();
  const middleInitial = middleInitialField ? middleInitialField.value.trim() : "";
  const email = emailField.value.trim();
  const streetField = document.getElementById("signupStreet");
  const blockLotField = document.getElementById("signupBlockLot");

  clearFormError(form);
  [emailField, phoneField, form.querySelector('[name="address"]'), streetField].forEach(clearFieldInvalid);

  if (password.value !== confirmPassword.value) {
    showFormError(form, "Passwords do not match.");
    return;
  }
  // The rule checklist is hidden until now; show the rules that are still missing.
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

  if (!isValidPhMobile(phoneField.value)) {
    markFieldInvalid(phoneField, "Enter a valid mobile number, like 09XXXXXXXXX.");
    return;
  }

  // The street must be picked from the list, not just typed.
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

  // Coming back from a later step with the same email keeps its verification;
  // a changed email has to be verified again.
  const previous = readDraft(SIGNUP_DRAFT_KEY);
  const alreadyVerified = !!(previous && previous.email_verification_token && previous.email === email);
  if (!alreadyVerified) {
    setBusy(submitBtn, "Sending code...");
    try {
      await apiRequestSignupCode(email);
    } catch (err) {
      if (err.fields && err.fields.email) markFieldInvalid(emailField, err.fields.email[0]);
      else showFormError(form, err.message);
      setBusy(submitBtn, null, "Next");
      return;
    }
  }

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
      ...(alreadyVerified ? { email_verification_token: previous.email_verification_token } : {}),
    })
  );
  window.location.href = alreadyVerified ? "verify-signup.html" : form.dataset.goto;
}

// Sign Up email check: the 6-digit code emailed in step 1.
async function handleSignupVerifyEmail(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const code = form.querySelector('[name="code"]').value.trim();
  clearFormError(form);

  const draft = readDraft(SIGNUP_DRAFT_KEY);
  if (!draft || !draft.email) {
    window.location.href = "signup.html";
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    showFormError(form, "Enter the 6-digit code from the email.");
    return;
  }

  setBusy(submitBtn, "Verifying...");
  try {
    const { email_verification_token } = await apiVerifySignupCode(draft.email, code);
    sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify({ ...draft, email_verification_token }));
    window.location.href = form.dataset.goto;
  } catch (err) {
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Verify");
  }
}

// Sign Up step 2: step 1's fields + the voter's ID photo create the account.
async function handleSignupStep2(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const fileInput = form.querySelector('[name="idPhoto"]');
  clearFormError(form);

  const draft = readDraft(SIGNUP_DRAFT_KEY);
  if (!draft) {
    window.location.href = "signup.html";
    return;
  }
  if (!draft.email_verification_token) {
    window.location.href = "verify-email.html";
    return;
  }
  if (!fileInput.files.length) {
    const drop = form.querySelector(".upload-drop");
    if (drop) drop.classList.add("upload-drop--invalid");
    markFieldInvalid(fileInput, "You must upload a photo of your Voter's ID first.");
    fileInput.addEventListener(
      "change",
      () => {
        clearFieldInvalid(fileInput);
        if (drop) drop.classList.remove("upload-drop--invalid");
      },
      { once: true }
    );
    return;
  }

  const formData = new FormData();
  Object.entries(draft).forEach(([key, value]) => formData.append(key, value));
  formData.append("voter_id_image", fileInput.files[0]);

  setBusy(submitBtn, "Submitting...");
  try {
    await apiRegister(formData);
    sessionStorage.removeItem(SIGNUP_DRAFT_KEY);
    window.location.href = form.dataset.goto;
  } catch (err) {
    if (err.fields && err.fields.email_verification_token) {
      // Took too long (or the token was already used): verify the email again.
      delete draft.email_verification_token;
      sessionStorage.setItem(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
      window.location.href = "verify-email.html?expired=1";
      return;
    }
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Submit");
  }
}

// Forgot Password 1/3: email a code.
async function handleForgotRequest(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const email = form.querySelector('[name="email"]').value.trim();
  clearFormError(form);

  setBusy(submitBtn, "Sending...");
  try {
    await apiRequestPasswordReset(email);
    sessionStorage.setItem(RESET_DRAFT_KEY, JSON.stringify({ email }));
    window.location.href = form.dataset.goto;
  } catch (err) {
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Get Code");
  }
}

// Forgot Password 2/3: check the code.
async function handleForgotVerify(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const code = form.querySelector('[name="code"]').value.trim();
  clearFormError(form);

  const draft = readDraft(RESET_DRAFT_KEY);
  if (!draft || !draft.email) {
    window.location.href = "forgot-password.html";
    return;
  }

  setBusy(submitBtn, "Verifying...");
  try {
    await apiVerifyPasswordResetCode(draft.email, code);
    sessionStorage.setItem(RESET_DRAFT_KEY, JSON.stringify({ email: draft.email, code }));
    window.location.href = form.dataset.goto;
  } catch (err) {
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Enter");
  }
}

// Forgot Password 3/3: save the new password.
async function handleForgotConfirm(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const password = form.querySelector('[name="password"]');
  const confirmPassword = form.querySelector('[name="confirmPassword"]');
  clearFormError(form);

  const draft = readDraft(RESET_DRAFT_KEY);
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

  setBusy(submitBtn, "Resetting...");
  try {
    await apiConfirmPasswordReset(draft.email, draft.code, password.value);
    sessionStorage.removeItem(RESET_DRAFT_KEY);
    window.location.href = form.dataset.goto;
  } catch (err) {
    showFormError(form, err.message);
    setBusy(submitBtn, null, "Reset Password");
  }
}

const FORM_HANDLERS = {
  login: handleLogin,
  signupStep1: handleSignupStep1,
  signupVerifyEmail: handleSignupVerifyEmail,
  signupStep2: handleSignupStep2,
  forgotRequest: handleForgotRequest,
  forgotVerify: handleForgotVerify,
  forgotConfirm: handleForgotConfirm,
};

function wireAccountForms() {
  document.querySelectorAll("form[data-goto]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const kind = Object.keys(FORM_HANDLERS).find((name) => form.dataset[name] !== undefined);
      if (kind) FORM_HANDLERS[kind](form);
    });
  });
}

// Coming back from the ID step ("Back to Sign Up") fills in what was typed.
function restoreSignupDraft(form) {
  const draft = readDraft(SIGNUP_DRAFT_KEY);
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

// Sign Up: the form stays disabled until the Terms & Data Privacy notice is accepted.
function wireSignupTermsGate() {
  const termsModal = document.getElementById("termsModal");
  const termsModalBody = document.getElementById("termsModalBody");
  const termsAgreeBtn = document.getElementById("termsAgreeBtn");
  const signupForm = document.querySelector("form[data-signup-step1]");

  if (signupForm) restoreSignupDraft(signupForm);
  if (!termsModal || !termsModalBody || !termsAgreeBtn) return;

  const signupFields = signupForm ? signupForm.querySelectorAll("input, select, button, textarea") : [];
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

// Sign Up email check page: shows where the code went, and "Send a new code".
function wireSignupVerifyEmail() {
  const form = document.querySelector("form[data-signup-verify-email]");
  if (!form) return;
  const draft = readDraft(SIGNUP_DRAFT_KEY);
  if (!draft || !draft.email) {
    window.location.href = "signup.html";
    return;
  }
  if (draft.email_verification_token) {
    window.location.href = form.dataset.goto;
    return;
  }

  const emailShown = document.getElementById("signupVerifyEmailAddress");
  const resendLink = document.getElementById("signupResendCode");
  const status = document.getElementById("signupResendStatus");
  if (emailShown) emailShown.textContent = draft.email;

  async function sendNewCode(message) {
    clearFormError(form);
    resendLink.hidden = true;
    status.textContent = "Sending a new code...";
    try {
      await apiRequestSignupCode(draft.email);
      status.textContent = message || "We've sent a new code. Use the newest email — earlier codes no longer work.";
    } catch (err) {
      status.textContent = "";
      showFormError(form, err.message);
    }
    resendLink.hidden = false;
  }

  if (resendLink && status) {
    resendLink.addEventListener("click", (e) => {
      e.preventDefault();
      sendNewCode();
    });
    // Sent back from the ID step because the verification ran out.
    if (new URLSearchParams(window.location.search).has("expired")) {
      sendNewCode("Your email verification expired, so we've sent you a new code.");
    }
  }
}

// Sign Up step 2: preview of the chosen voter's ID photo.
function wireIdPhotoPreview() {
  const idInput = document.getElementById("idPhoto");
  if (!idInput) return;
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

// ---------------------------------------------------------------------------
// Account setup (account-setup.html#uid=...&token=...)
// ---------------------------------------------------------------------------
// With a valid link: shows the details form (pre-filled when an Administrator
// already entered the details) and the new password. Without a link, or with
// an expired one: offers to email a new link.

function wireAccountSetup() {
  const setupRequestForm = document.getElementById("setupRequestForm");
  const setupDetailsForm = document.getElementById("setupDetailsForm");
  if (!setupRequestForm || !setupDetailsForm) return;

  const setupLoading = document.getElementById("setupLoading");
  const setupSent = document.getElementById("setupSent");
  const setupInvalid = document.getElementById("setupInvalid");
  const linkParams = new URLSearchParams(window.location.hash.slice(1));
  const uid = linkParams.get("uid");
  const token = linkParams.get("token");
  let setupEmail = "";

  // Remove the token from the address bar and history right away.
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
    // A citizen's address is saved as "Block/Lot, Street".
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

  // The street list loads from the server; wait for it before splitting the address.
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
    setBusy(submitBtn, "Sending...");
    try {
      await apiRequestSetupLink({ email });
      showSetupStep(setupSent);
    } catch (err) {
      showFormError(setupRequestForm, err.message);
    } finally {
      setBusy(submitBtn, null, "Email Me a Setup Link");
    }
  });

  document.getElementById("setupNewLinkBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      // An expired link still knows whose account it was.
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

    // Citizen setup also asks for the address.
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

    setBusy(submitBtn, "Setting up...");
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
      setBusy(submitBtn, null, "Complete Setup");
    }
  });
}

// ---------------------------------------------------------------------------
// Administrator-sent password reset link (staff/new-password.html#uid=...&token=...)
// ---------------------------------------------------------------------------

function wireResetLinkForm() {
  const resetLinkForm = document.getElementById("resetLinkForm");
  if (!resetLinkForm) return;

  const resetLoading = document.getElementById("resetLinkLoading");
  const resetInvalid = document.getElementById("resetLinkInvalid");
  const resetParams = new URLSearchParams(window.location.hash.slice(1));
  const resetUid = resetParams.get("uid");
  const resetToken = resetParams.get("token");
  let resetAccount = {};
  if (resetUid || resetToken) history.replaceState(null, "", window.location.pathname);

  const showResetInvalid = (message) => {
    document.getElementById("resetLinkInvalidMessage").textContent = message;
    resetLoading.hidden = true;
    resetInvalid.hidden = false;
  };

  if (!resetUid || !resetToken) {
    showResetInvalid("This page only works from the reset link in your email.");
  } else {
    apiCheckResetLink(resetUid, resetToken)
      .then((account) => {
        resetAccount = account;
        document.getElementById("resetLinkEmail").textContent = account.email;
        document.getElementById("resetHintEmail").value = account.email;
        document.getElementById("resetHintFirstName").value = account.first_name || "";
        document.getElementById("resetHintLastName").value = account.last_name || "";
        resetLoading.hidden = true;
        resetLinkForm.hidden = false;
        document.getElementById("resetNewPassword").focus();
      })
      .catch((err) => showResetInvalid(err.message));
  }

  resetLinkForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("resetNewPassword");
    const confirmPassword = document.getElementById("resetConfirmPassword");
    const submitBtn = resetLinkForm.querySelector('button[type="submit"]');
    clearFormError(resetLinkForm);

    if (password.value !== confirmPassword.value) {
      showFormError(resetLinkForm, "Passwords do not match.");
      return;
    }
    const passwordError = getPasswordRequirementError(password.value, {
      firstName: resetAccount.first_name,
      lastName: resetAccount.last_name,
      email: resetAccount.email,
    });
    if (passwordError) {
      showFormError(resetLinkForm, passwordError);
      return;
    }

    setBusy(submitBtn, "Saving...");
    try {
      await apiConfirmResetLink(resetUid, resetToken, password.value);
      window.location.href = "reset-success.html";
    } catch (err) {
      showFormError(resetLinkForm, err.message);
      setBusy(submitBtn, null, "Save New Password");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  expireStaleSession();
  setupPasswordHints();
  setupPasswordVisibilityToggles();
  wireAccountForms();
  wireAccountSetup();
  wireResetLinkForm();
  wireConfirmPasswordCheck();
  wireCodeInputs();
  wireIdPhotoPreview();
  wireSignupVerifyEmail();
  wireSignupTermsGate();
});
