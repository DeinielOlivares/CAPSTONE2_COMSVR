// Barangay Platero OVRMS — Create Account: Account Type picks which form shows —
// "Barangay Staff" (just an email + role, see AdminCreateUserSerializer)
// or "Barangay Citizen" (full details entered directly, created and
// pre-verified right away with an auto-generated password emailed to them,
// see StaffCreateCitizenSerializer). Citizens can still self-register
// through the Citizen portal's own Sign Up flow too — this is just the
// admin-direct path for either.

// Highlights one input/select red with an inline message underneath it —
// same pattern as frontend/citizen/js/main.js's markFieldInvalid,
// duplicated here since this page doesn't load that file.
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

// Same client-checkable password rules as Citizen Sign Up (frontend/citizen/js/main.js) —
// kept here too since this page loads admin.js rather than main.js.
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

function getPasswordRequirementError(pw, attrs = {}) {
  const status = getPasswordRuleStatus(pw, attrs);
  if (!status.length) return "Password must be at least 8 characters.";
  if (!status.numeric) return "Password can't be entirely numbers.";
  if (!status.common) return "That password is too common. Please choose a less predictable one.";
  if (!status.similar) return "Password is too similar to the account's name or email.";
  return null;
}

document.addEventListener("DOMContentLoaded", () => {
  const accountType = document.getElementById("caAccountType");
  const accountTypeField = document.getElementById("caAccountTypeField");
  const staffForm = document.getElementById("createStaffAccountForm");
  const citizenForm = document.getElementById("createCitizenAccountForm");
  const createdModal = document.getElementById("accountCreatedModal");
  const createdMessage = document.getElementById("accountCreatedMessage");
  const createdConfirm = document.getElementById("accountCreatedConfirm");

  function syncFormVisibility() {
    const isCitizen = accountType.value === "citizen";
    staffForm.hidden = isCitizen;
    citizenForm.hidden = !isCitizen;
    // The Account Type field lives inside whichever card is currently shown,
    // instead of sitting in its own separate section above both forms.
    const card = (isCitizen ? citizenForm : staffForm).querySelector(".create-account-card");
    card.insertBefore(accountTypeField, card.firstChild);
  }
  accountType.addEventListener("change", syncFormVisibility);
  syncFormVisibility();

  // ---- Barangay Staff form ----
  const email = document.getElementById("caEmail");
  const role = document.getElementById("caRole");
  const roleWarning = document.getElementById("caRoleWarning");
  const staffSubmitBtn = staffForm.querySelector('button[type="submit"]');

  // Live warning (before submit) when picking a role that's limited to one
  // active holder at a time — the server enforces this too (see
  // validate_staff_role_uniqueness in accounts/serializers.py), this is just
  // an earlier heads-up using the same account list Manage Accounts shows.
  const UNIQUE_STAFF_ROLES = new Set(["Barangay Captain", "Secretary"]);
  role.addEventListener("change", async () => {
    roleWarning.hidden = true;
    if (!UNIQUE_STAFF_ROLES.has(role.value)) return;
    try {
      const accounts = await getAllAccounts();
      const taken = accounts.some((a) => a.active && (a.position || "").toLowerCase() === role.value.toLowerCase());
      if (taken) {
        roleWarning.textContent = `There's already an active ${role.value}. Only one is allowed at a time.`;
        roleWarning.hidden = false;
      }
    } catch (err) {
      // Non-blocking: the server-side check on submit still catches it.
    }
  });

  staffForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!staffForm.reportValidity()) return;

    clearFormError(staffForm);
    clearFieldInvalid(email);
    staffSubmitBtn.disabled = true;
    staffSubmitBtn.textContent = "Creating...";

    try {
      const created = await createAccount({ email: email.value.trim(), staffRole: role.value });

      addAdminNotification(`New account created: ${created.email} (${role.value})`, "manage-accounts.html");

      createdMessage.textContent = "We've emailed them their login — their email and an auto-generated password.";
      createdModal.hidden = false;
      staffForm.reset();
      syncFormVisibility();
    } catch (err) {
      if (err.fields && err.fields.email) {
        markFieldInvalid(email, err.fields.email[0]);
      } else {
        showFormError(staffForm, err.message);
      }
    } finally {
      staffSubmitBtn.disabled = false;
      staffSubmitBtn.textContent = "Create Account";
    }
  });

  // ---- Barangay Citizen form: full details entered directly ----
  const citizenFirstName = document.getElementById("ccFirstName");
  const citizenMiddleInitial = document.getElementById("ccMiddleInitial");
  const citizenLastName = document.getElementById("ccLastName");
  const citizenEmail = document.getElementById("ccEmail");
  const citizenPhone = document.getElementById("ccPhone");
  const citizenStreetInput = document.getElementById("ccStreet");
  const citizenStreetList = document.getElementById("ccStreetList");
  const citizenBlockLot = document.getElementById("ccBlockLot");
  const citizenSubmitBtn = citizenForm.querySelector('button[type="submit"]');

  // Street: type-to-filter combobox over the real street list (see
  // streets-data.js) — same pattern as citizen Sign Up's street field.
  ensureStreetsLoaded()
    .then(() => {
      const renderOptions = () => {
        const query = citizenStreetInput.value.trim().toLowerCase();
        const matches = query ? STREETS.filter((s) => s.toLowerCase().includes(query)) : STREETS;
        citizenStreetList.innerHTML = matches.length
          ? matches.map((s) => `<li data-value="${s}">${s}</li>`).join("")
          : `<li class="combobox__empty">No matching street</li>`;
        citizenStreetList.hidden = false;
      };
      citizenStreetInput.addEventListener("focus", renderOptions);
      citizenStreetInput.addEventListener("input", renderOptions);
      citizenStreetList.addEventListener("click", (e) => {
        const option = e.target.closest("li[data-value]");
        if (!option) return;
        citizenStreetInput.value = option.dataset.value;
        citizenStreetList.hidden = true;
      });
      document.addEventListener("click", (e) => {
        if (!citizenStreetInput.contains(e.target) && !citizenStreetList.contains(e.target)) {
          citizenStreetList.hidden = true;
        }
      });
      citizenStreetInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") citizenStreetList.hidden = true;
      });
    })
    .catch(() => {
      // Best-effort — the combobox just shows no options if this fails.
    });

  citizenForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!citizenForm.reportValidity()) return;
    clearFormError(citizenForm);
    [citizenEmail, citizenPhone, citizenStreetInput].forEach(clearFieldInvalid);

    if (!STREETS.includes(citizenStreetInput.value.trim())) {
      markFieldInvalid(citizenStreetInput, "Please select a street from the list.");
      return;
    }

    const payload = {
      first_name: citizenFirstName.value.trim(),
      middle_initial: citizenMiddleInitial.value.trim(),
      last_name: citizenLastName.value.trim(),
      email: citizenEmail.value.trim(),
      contact_number: citizenPhone.value.trim(),
      address: `${citizenBlockLot.value.trim()}, ${citizenStreetInput.value.trim()}`,
    };

    citizenSubmitBtn.disabled = true;
    citizenSubmitBtn.textContent = "Creating...";
    try {
      const created = await createCitizenAccount(payload);
      addAdminNotification(`New account created: ${created.email} (Barangay Citizen)`, "manage-accounts.html");
      createdMessage.textContent = "We've emailed them their login — their email and an auto-generated password.";
      createdModal.hidden = false;
      citizenForm.reset();
    } catch (err) {
      if (err.fields && err.fields.email) markFieldInvalid(citizenEmail, err.fields.email[0]);
      if (err.fields && err.fields.contact_number) markFieldInvalid(citizenPhone, err.fields.contact_number[0]);
      if (!(err.fields && (err.fields.email || err.fields.contact_number))) {
        showFormError(citizenForm, err.message);
      }
    } finally {
      citizenSubmitBtn.disabled = false;
      citizenSubmitBtn.textContent = "Create Account";
    }
  });

  createdConfirm.addEventListener("click", () => {
    createdModal.hidden = true;
    window.location.href = "manage-accounts.html";
  });
});
