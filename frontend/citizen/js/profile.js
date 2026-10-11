// Barangay Platero OVRMS — Citizen Profile: tab switching, real field population from the
// API, a real Apply Changes save (including profile picture upload) to
// PATCH /api/auth/me/, and a real Change Password to POST /api/auth/change-password/.

document.addEventListener("DOMContentLoaded", async () => {
  const avatarUpload = document.getElementById("avatarUpload");
  const avatarImg = document.getElementById("editAvatarImg");
  const avatarInitials = document.getElementById("editAvatarInitials");
  const firstNameInput = document.getElementById("profileFirstName");
  const lastNameInput = document.getElementById("profileLastName");
  const emailInput = document.getElementById("profileEmail");
  const mobileInput = document.getElementById("profileMobile");
  const addressInput = document.getElementById("profileAddress");
  const streetInput = document.getElementById("profileStreet");
  const blockLotInput = document.getElementById("profileBlockLot");

  // The address is saved as "Block, Lot, Street" (same as sign-up). The hidden
  // addressInput holds that combined value; the two visible fields feed it.
  function splitAddress(address) {
    const parts = String(address || "").split(",").map((part) => part.trim());
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    if (last && STREETS.includes(last)) {
      streetInput.value = last;
      blockLotInput.value = parts.slice(0, -1).join(", ");
    } else {
      streetInput.value = "";
      blockLotInput.value = address || "";
    }
  }

  function syncAddress() {
    const blockLot = blockLotInput.value.trim();
    const street = streetInput.value.trim();
    addressInput.value = blockLot || street ? `${blockLot}, ${street}` : "";
  }
  const editForm = document.getElementById("editProfileForm");

  function initialsFor(firstName, lastName) {
    return [firstName, lastName]
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

  // Populates both the form and the avatar preview from a user object —
  // called once with whatever's cached (fast paint), then again once the
  // real API response comes back (in case it's changed since login).
  function populate(user) {
    document.getElementById("passwordAvatar").textContent = user.initials || "";
    if (user.profilePicture) {
      avatarImg.src = user.profilePicture;
      avatarImg.hidden = false;
      avatarInitials.hidden = true;
    } else {
      avatarInitials.textContent = user.initials || "";
      avatarInitials.hidden = false;
      avatarImg.hidden = true;
    }
    firstNameInput.value = user.firstName || "";
    lastNameInput.value = user.lastName || "";
    emailInput.value = user.email || "";
    mobileInput.value = user.mobile || "";
    splitAddress(user.address);
    syncAddress();

    // Feeds the New Password field's "too similar to your name/email" hint
    // (see setupPasswordHints in main.js) — Change Password has no visible
    // name/email fields of its own to read those from.
    document.getElementById("passwordHintFirstName").value = user.firstName || "";
    document.getElementById("passwordHintLastName").value = user.lastName || "";
    document.getElementById("passwordHintEmail").value = user.email || "";
  }

  const cached = getCurrentUser();
  if (cached) populate(cached);

  try {
    const res = await authFetch("/api/auth/me/");
    if (res.ok) {
      const fresh = await res.json();
      populate({
        initials: initialsFor(fresh.first_name, fresh.last_name),
        profilePicture: fresh.profile_picture,
        firstName: fresh.first_name,
        lastName: fresh.last_name,
        email: fresh.email,
        mobile: fresh.contact_number,
        address: fresh.address,
      });
    }
  } catch {
    // Network hiccup — the cached values already painted above are fine to leave.
  }

  // ---- Unsaved-changes tracking ----
  // Snapshotted right after the form is populated from the server, then
  // re-snapshotted after every successful save — isDirty() just compares
  // the live inputs against whichever snapshot is current.
  let savedSnapshot = {
    firstName: firstNameInput.value,
    lastName: lastNameInput.value,
    email: emailInput.value,
    mobile: mobileInput.value,
    address: addressInput.value,
  };

  function isEditDirty() {
    syncAddress();
    return (
      firstNameInput.value !== savedSnapshot.firstName ||
      lastNameInput.value !== savedSnapshot.lastName ||
      emailInput.value !== savedSnapshot.email ||
      mobileInput.value !== savedSnapshot.mobile ||
      addressInput.value !== savedSnapshot.address ||
      avatarUpload.files.length > 0
    );
  }

  function isPasswordDirty() {
    return !!(currentPasswordInput.value || newPasswordInput.value || confirmNewPasswordInput.value);
  }

  function isDirty() {
    return isEditDirty() || isPasswordDirty();
  }

  // What to actually do once the user resolves the unsaved-changes modal
  // (Save/Discard) — either "go to this link" or "switch to this tab". Set
  // right before the modal opens, read by its buttons further down.
  let pendingAction = null;
  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");

  // Catch-all for navigation this page doesn't otherwise intercept (navbar
  // links, browser back/refresh/close) — the Cancel button below gets a
  // nicer custom modal instead of this native browser prompt.
  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Profile picture upload preview (Edit Account Information only) — shows the
  // newly-picked file immediately; the actual upload happens on submit.
  avatarUpload.addEventListener("change", () => {
    const file = avatarUpload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      avatarImg.src = e.target.result;
      avatarImg.hidden = false;
      avatarInitials.hidden = true;
    };
    reader.readAsDataURL(file);
  });

  const tabs = document.querySelectorAll(".profile-tab");
  const views = {
    edit: document.getElementById("editView"),
    password: document.getElementById("passwordView"),
  };

  function switchToTab(key) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === key));
    Object.entries(views).forEach(([k, view]) => {
      view.hidden = k !== key;
    });
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const key = tab.dataset.tab;
      if (tab.classList.contains("active")) return;
      if (isDirty()) {
        pendingAction = () => switchToTab(key);
        unsavedChangesModal.hidden = false;
        return;
      }
      switchToTab(key);
    });
  });

  const updatedModal = document.getElementById("profileUpdatedModal");
  const updatedTitle = document.getElementById("profileUpdatedTitle");
  const updatedConfirm = document.getElementById("profileUpdatedConfirm");
  let onUpdatedConfirm = () => switchToTab("edit");

  updatedConfirm.addEventListener("click", () => {
    updatedModal.hidden = true;
    onUpdatedConfirm();
  });

  // ---- Email verification for sensitive changes ----
  // Changing email/mobile/address requires a code emailed to the address
  // already on file (see accounts.views.MeView.patch) — a profile photo
  // change alone doesn't. openVerifyCodeModal() just collects the code the
  // user was emailed; the real check happens server-side on the PATCH itself.
  function openVerifyCodeModal() {
    return new Promise((resolve) => {
      const modal = document.getElementById("verifyEditModal");
      const form = document.getElementById("verifyEditForm");
      const input = document.getElementById("verifyEditCode");
      const cancelBtn = document.getElementById("verifyEditCancel");
      input.value = "";
      modal.hidden = false;
      input.focus();

      function cleanup(result) {
        modal.hidden = true;
        form.removeEventListener("submit", onSubmit);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }
      function onSubmit(e) {
        e.preventDefault();
        const code = input.value.trim();
        if (code) cleanup(code);
      }
      function onCancel() {
        cleanup(null);
      }
      form.addEventListener("submit", onSubmit);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  async function promptForVerificationCode() {
    try {
      await authFetch("/api/auth/profile-edit/request-code/", { method: "POST" });
    } catch {
      // Best-effort — if sending failed, the PATCH below will just reject
      // whatever code the user enters, which surfaces its own error.
    }
    return openVerifyCodeModal();
  }

  // Returns true on success — shared between the form's own submit handler
  // and the unsaved-changes modal's "Save Changes" button.
  async function commitEditSave() {
    clearFormError(editForm);
    const submitBtn = editForm.querySelector('button[type="submit"]');

    syncAddress();
    if (!STREETS.includes(streetInput.value.trim())) {
      showFormError(editForm, "Please select a street from the list.");
      return false;
    }
    if (!blockLotInput.value.trim()) {
      showFormError(editForm, "Enter your block and lot.");
      return false;
    }
    if (!isValidPhMobile(mobileInput.value)) {
      showFormError(editForm, "Enter a valid mobile number, like 09XXXXXXXXX.");
      return false;
    }

    const sensitiveChanged =
      emailInput.value.trim() !== savedSnapshot.email ||
      mobileInput.value.trim() !== savedSnapshot.mobile ||
      addressInput.value.trim() !== savedSnapshot.address;
    let verificationCode = null;
    if (sensitiveChanged) {
      verificationCode = await promptForVerificationCode();
      if (!verificationCode) return false;
    }

    const formData = new FormData();
    formData.append("first_name", firstNameInput.value.trim());
    formData.append("last_name", lastNameInput.value.trim());
    formData.append("email", emailInput.value.trim());
    formData.append("contact_number", mobileInput.value.trim());
    formData.append("address", addressInput.value.trim());
    if (avatarUpload.files[0]) formData.append("profile_picture", avatarUpload.files[0]);
    if (verificationCode) formData.append("verification_code", verificationCode);

    submitBtn.disabled = true;
    submitBtn.textContent = "Saving...";
    try {
      const response = await authFetch("/api/auth/me/", { method: "PATCH", body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (typeof data.detail === "string") throw new Error(data.detail);
        const firstError = Object.values(data)[0];
        throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not update your profile.");
      }
      const updated = await response.json();

      // Refresh the cached session so the navbar/profile popup reflect the
      // change immediately, without needing to log in again. Writes back to
      // whichever bucket (session/local) the session is actually in — see
      // authStorage() in main.js — rather than always localStorage, or a
      // non-"Stay signed in" session would end up with a stale cached user
      // in sessionStorage and an orphaned copy in localStorage.
      authStorage().setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          ...(getCurrentUser() || {}),
          name: updated.name,
          firstName: updated.first_name,
          lastName: updated.last_name,
          initials: initialsFor(updated.first_name, updated.last_name),
          email: updated.email,
          mobile: updated.contact_number,
          address: updated.address,
          profilePicture: updated.profile_picture,
        })
      );

      savedSnapshot = {
        firstName: firstNameInput.value,
        lastName: lastNameInput.value,
        email: emailInput.value,
        mobile: mobileInput.value,
        address: addressInput.value,
      };
      avatarUpload.value = "";
      return true;
    } catch (err) {
      showFormError(editForm, err.message);
      return false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Apply Changes";
    }
  }

  editForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await commitEditSave()) {
      updatedTitle.textContent = "Information Changed!";
      onUpdatedConfirm = () => {
        window.location.href = "ordinances.html";
      };
      updatedModal.hidden = false;
    }
  });

  const passwordForm = document.getElementById("changePasswordForm");
  const currentPasswordInput = document.getElementById("currentPassword");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmNewPasswordInput = document.getElementById("confirmNewPassword");

  async function commitPasswordSave() {
    clearFormError(passwordForm);

    if (newPasswordInput.value !== confirmNewPasswordInput.value) {
      showFormError(passwordForm, "New password and confirm password don't match.");
      return false;
    }

    const passwordError = getPasswordRequirementError(newPasswordInput.value, {
      firstName: firstNameInput.value,
      lastName: lastNameInput.value,
      email: emailInput.value,
    });
    if (passwordError) {
      showFormError(passwordForm, passwordError);
      return false;
    }

    const submitBtn = passwordForm.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = "Changing...";
    try {
      const response = await authFetch("/api/auth/change-password/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          current_password: currentPasswordInput.value,
          new_password: newPasswordInput.value,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const firstError = Object.values(data)[0];
        throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not change your password.");
      }
      passwordForm.reset();
      return true;
    } catch (err) {
      showFormError(passwordForm, err.message);
      return false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Change Password";
    }
  }

  passwordForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await commitPasswordSave()) {
      updatedTitle.textContent = "Password Changed!";
      onUpdatedConfirm = () => switchToTab("edit");
      updatedModal.hidden = false;
    }
  });

  // ---- Delete Account ----
  // Permanent and self-service — Report/Concern/Question all CASCADE off
  // User (see accounts.views.MeView.delete), so this wipes everything the
  // citizen ever submitted along with the account itself. Requires the
  // current password, same reasoning as Change Password above.
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");
  const deleteAccountModal = document.getElementById("deleteAccountModal");
  const deleteAccountForm = document.getElementById("deleteAccountForm");
  const deleteAccountPasswordInput = document.getElementById("deleteAccountPassword");
  const deleteAccountConfirmBtn = document.getElementById("deleteAccountConfirm");
  const deleteAccountCancel = document.getElementById("deleteAccountCancel");
  const deleteAccountDoneModal = document.getElementById("deleteAccountDoneModal");
  const deleteAccountDoneConfirm = document.getElementById("deleteAccountDoneConfirm");

  deleteAccountBtn.addEventListener("click", () => {
    deleteAccountPasswordInput.value = "";
    clearFormError(deleteAccountForm);
    deleteAccountModal.hidden = false;
    deleteAccountPasswordInput.focus();
  });
  deleteAccountCancel.addEventListener("click", () => {
    deleteAccountModal.hidden = true;
  });
  deleteAccountModal.addEventListener("click", (e) => {
    if (e.target === deleteAccountModal) deleteAccountModal.hidden = true;
  });

  deleteAccountForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(deleteAccountForm);
    deleteAccountConfirmBtn.disabled = true;
    deleteAccountConfirmBtn.textContent = "Deleting...";
    try {
      const response = await authFetch("/api/auth/me/", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deleteAccountPasswordInput.value }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const firstError = Object.values(data)[0];
        throw new Error(
          Array.isArray(firstError) ? firstError[0] : data.detail || "Could not delete your account."
        );
      }
      // Neutralizes any unsaved Edit/Password form changes so beforeunload's
      // isDirty() check doesn't throw up a native "leave site?" prompt on
      // the way out, right after the account was just deleted on purpose.
      savedSnapshot = {
        firstName: firstNameInput.value,
        lastName: lastNameInput.value,
        email: emailInput.value,
        mobile: mobileInput.value,
        address: addressInput.value,
      };
      deleteAccountModal.hidden = true;
      deleteAccountDoneModal.hidden = false;
    } catch (err) {
      showFormError(deleteAccountForm, err.message);
    } finally {
      deleteAccountConfirmBtn.disabled = false;
      deleteAccountConfirmBtn.textContent = "Delete My Account";
    }
  });

  deleteAccountDoneConfirm.addEventListener("click", () => {
    logOut();
    window.location.href = "/citizen/login.html";
  });

  // ---- Leaving with unsaved changes ----
  // Catches every in-page link on the page (navbar, Cancel, the profile
  // popup, notification "View All", etc.) while something's unsaved — not
  // just the Cancel button — so there's no way to click away from an
  // unsaved edit without being asked first. beforeunload above is the
  // fallback for anything that isn't a click (browser back/refresh/close).
  // Switching from Edit Account Information to Change Password (or back)
  // while dirty goes through the same modal — see the tabs handler above.
  document.addEventListener(
    "click",
    (e) => {
      if (!isDirty()) return;
      const link = e.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      e.preventDefault();
      e.stopPropagation();
      pendingAction = () => {
        window.location.href = href;
      };
      unsavedChangesModal.hidden = false;
    },
    true
  );

  unsavedSaveBtn.addEventListener("click", async () => {
    unsavedChangesModal.hidden = true;
    const saved = isEditDirty() ? await commitEditSave() : await commitPasswordSave();
    if (saved && pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    if (pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedCancelBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    pendingAction = null;
  });
  unsavedChangesModal.addEventListener("click", (e) => {
    if (e.target === unsavedChangesModal) unsavedChangesModal.hidden = true;
  });
});
