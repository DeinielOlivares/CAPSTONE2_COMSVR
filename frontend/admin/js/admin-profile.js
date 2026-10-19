// My Profile (admin): two tabs — Edit Account Information and Change
// Password. Saves with PATCH /api/auth/me/ and POST /api/auth/change-password/.

document.addEventListener("DOMContentLoaded", async () => {
  const avatarUpload = document.getElementById("avatarUpload");
  const avatarImg = document.getElementById("editAvatarImg");
  const avatarInitials = document.getElementById("editAvatarInitials");
  const firstNameInput = document.getElementById("profileFirstName");
  const middleInitialInput = document.getElementById("profileMiddleInitial");
  const lastNameInput = document.getElementById("profileLastName");
  const emailInput = document.getElementById("profileEmail");
  const mobileInput = document.getElementById("profileMobile");
  const addressInput = document.getElementById("profileAddress");
  const editForm = document.getElementById("editProfileForm");

  function initialsFor(firstName, lastName) {
    return [firstName, lastName]
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }

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
    middleInitialInput.value = user.middleInitial || "";
    lastNameInput.value = user.lastName || "";
    emailInput.value = user.email || "";
    mobileInput.value = user.mobile || "";
    addressInput.value = user.address || "";

    // Hidden fields used by the password checklist's "too similar to your name/email" rule.
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
        middleInitial: fresh.middle_initial,
        lastName: fresh.last_name,
        email: fresh.email,
        mobile: fresh.contact_number,
        address: fresh.address,
      });
    }
  } catch {
    // Network problem: keep the saved-session values shown above.
  }

  // ---- Unsaved changes ----
  // The values as last saved; isEditDirty() compares the inputs with them.
  let savedSnapshot = {
    firstName: firstNameInput.value,
    middleInitial: middleInitialInput.value,
    lastName: lastNameInput.value,
    email: emailInput.value,
    mobile: mobileInput.value,
    address: addressInput.value,
  };

  function isEditDirty() {
    return (
      firstNameInput.value !== savedSnapshot.firstName ||
      middleInitialInput.value !== savedSnapshot.middleInitial ||
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

  // What to do after the unsaved-changes popup is answered (open a link or switch tab).
  let pendingAction = null;
  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");

  // Closing the tab or going back with unsaved changes shows the browser's own warning.
  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Shows the chosen profile picture right away (it is uploaded on Apply Changes).
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

  // ---- Code check for email / mobile / address changes ----
  // The server emails a code to the current email address; the user types it
  // into this popup and it is sent along with the save (the server checks it).
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
      // If sending failed, the save will reject the code and show why.
    }
    return openVerifyCodeModal();
  }

  // Saves Edit Account Information. Returns true on success.
  async function commitEditSave() {
    clearFormError(editForm);
    const submitBtn = editForm.querySelector('button[type="submit"]');

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
    formData.append("middle_initial", middleInitialInput.value.trim());
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

      // Update the saved session so the top bar shows the change right away.
      authStorage().setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          ...(getCurrentUser() || {}),
          name: updated.name,
          firstName: updated.first_name,
          middleInitial: updated.middle_initial,
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
        middleInitial: middleInitialInput.value,
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
        window.location.href = "approve-accounts.html";
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

  // ---- Leaving with unsaved changes ----
  // Clicking any link while something is unsaved opens the Save / Discard / Cancel popup.
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
