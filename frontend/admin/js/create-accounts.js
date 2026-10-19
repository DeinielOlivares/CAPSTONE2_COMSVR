// Create Accounts page. "Account Type" chooses the form:
//   Barangay Staff   — just an email and a role
//   Barangay Citizen — all the citizen's details
// Either way the person is emailed a one-time link to finish the account
// and choose their own password.

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

      createdMessage.textContent = "We've emailed them a one-time setup link to finish their account and choose their own password.";
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
  const citizenBlockLot = document.getElementById("ccBlockLot");
  const citizenSubmitBtn = citizenForm.querySelector('button[type="submit"]');

  // Street picker (see /shared/js/streets.js).
  ensureStreetsLoaded()
    .then(() => wireStreetCombobox("ccStreet", "ccStreetList", { announceChange: false }))
    .catch(() => {}); // the picker just shows no streets

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
      createdMessage.textContent = "We've emailed them a one-time setup link to finish their account and choose their own password.";
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
