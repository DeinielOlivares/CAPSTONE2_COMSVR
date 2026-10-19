// About Us Setup (admin): edits the citizen About Us page — barangay details
// (also used by the footer), council members and logos.

const COUNCIL_GROUP_ORDER = ["chairman", "member", "officer"];
const COUNCIL_GROUP_LABELS = {
  chairman: "Punong Barangay",
  member: "Member",
  officer: "Officer",
};

document.addEventListener("DOMContentLoaded", async () => {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  // =========================== Barangay details ===========================

  const profileForm = document.getElementById("profileForm");
  const profileSave = document.getElementById("profileSave");
  const profileStatus = document.getElementById("profileStatus");
  const profileFields = Array.from(profileForm.querySelectorAll("[name]"));
  let savedProfile = null;

  function fillProfileForm(profile) {
    savedProfile = profile;
    profileFields.forEach((input) => {
      input.value = profile[input.name] || "";
    });
  }

  function changedProfileFields() {
    const changes = {};
    profileFields.forEach((input) => {
      const value = input.value.trim();
      if (value !== (savedProfile[input.name] || "")) changes[input.name] = value;
    });
    return changes;
  }

  profileForm.addEventListener("input", () => {
    profileStatus.textContent = isProfileDirty() ? "Unsaved changes" : "";
  });

  function isProfileDirty() {
    return !!(savedProfile && Object.keys(changedProfileFields()).length);
  }

  // Saves the barangay details. Returns true on success.
  async function commitProfileSave() {
    clearFormError(profileForm);
    const changes = changedProfileFields();
    if (!Object.keys(changes).length) {
      profileStatus.textContent = "Nothing to save.";
      return true;
    }
    if ("name" in changes && !changes.name) {
      showFormError(profileForm, "The barangay name can't be empty.");
      return false;
    }
    profileSave.disabled = true;
    profileSave.textContent = "Saving...";
    try {
      fillProfileForm(await saveBarangayProfile(changes));
      profileStatus.textContent = "Saved. The About Us page is updated.";
      return true;
    } catch (err) {
      showFormError(profileForm, err.message);
      return false;
    } finally {
      profileSave.disabled = false;
      profileSave.textContent = "Save Details";
    }
  }

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await commitProfileSave();
  });

  // ---- Leaving with unsaved details: clicking a link asks "Save Changes?" ----
  window.addEventListener("beforeunload", (e) => {
    if (!isProfileDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");
  let pendingAction = null;

  document.addEventListener(
    "click",
    (e) => {
      if (!isProfileDirty()) return;
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
    const saved = await commitProfileSave();
    if (saved && pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    fillProfileForm(savedProfile);
    if (pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedCancelBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    pendingAction = null;
  });
  unsavedChangesModal.addEventListener("click", (e) => {
    if (e.target === unsavedChangesModal) {
      unsavedChangesModal.hidden = true;
      pendingAction = null;
    }
  });

  // ============================ Shared helpers ============================

  const deleteModal = document.getElementById("setupDeleteModal");
  const deleteTitle = document.getElementById("setupDeleteTitle");
  const deleteMessage = document.getElementById("setupDeleteMessage");
  const deleteConfirm = document.getElementById("setupDeleteConfirm");
  let pendingDelete = null;

  function askToDelete({ title, message, run }) {
    deleteTitle.textContent = title;
    deleteMessage.textContent = message;
    pendingDelete = run;
    deleteModal.hidden = false;
  }

  deleteConfirm.addEventListener("click", async () => {
    if (!pendingDelete) return;
    deleteConfirm.disabled = true;
    try {
      await pendingDelete();
      deleteModal.hidden = true;
      pendingDelete = null;
    } catch (err) {
      siteAlert(err.message);
    } finally {
      deleteConfirm.disabled = false;
    }
  });

  // The server's upload limits, checked before uploading.
  const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const IMAGE_MIN_SIDE = 400;

  // Warnings for a picked image. A hard problem (wrong type, too big) also
  // clears the pick; soft ones (small, not square) just advise.
  function checkPickedImage(file, img, { isLogo }) {
    if (!IMAGE_TYPES.includes(file.type)) return { error: "Use a JPG, PNG or WebP image." };
    if (file.size > IMAGE_MAX_BYTES) {
      return { error: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Use an image up to 5 MB.` };
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const notes = [];
    if (Math.min(w, h) < IMAGE_MIN_SIDE) {
      notes.push(`This image is ${w} × ${h} px, smaller than the recommended ${IMAGE_MIN_SIDE} × ${IMAGE_MIN_SIDE} px, so it may look blurry.`);
    }
    if (Math.abs(w - h) / Math.max(w, h) > 0.1) {
      notes.push(
        isLogo
          ? "It isn't square, so it will be shrunk to fit and look smaller than the other logos."
          : "It isn't square, so the edges will be cropped off in the circle. Check that the face is still centered."
      );
    }
    if (isLogo && file.type !== "image/png") {
      notes.push("A JPG has no transparent background, so a white box may show around the logo on the green strip.");
    }
    return { notes };
  }

  // Previews a chosen image; returns a function that clears it.
  // `framed`: add the green ring, as About Us does for uploaded portraits.
  function wireImagePicker(input, preview, empty, warn, options) {
    let objectUrl = null;
    let previousFramed = false;
    function show(url, framed) {
      if (objectUrl && url !== objectUrl) URL.revokeObjectURL(objectUrl);
      preview.src = url || "";
      preview.hidden = !url;
      empty.hidden = !!url;
      preview.classList.toggle("is-framed", !!(url && framed && !options.isLogo));
    }
    function setWarning(text, isError) {
      warn.textContent = text || "";
      warn.hidden = !text;
      warn.classList.toggle("setup-photo__warn--error", !!isError);
    }
    let previousUrl = "";
    input.addEventListener("change", () => {
      const file = input.files[0];
      setWarning("");
      if (!file) return;
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const { error, notes } = checkPickedImage(file, probe, options);
        if (error) {
          URL.revokeObjectURL(url);
          input.value = "";
          show(previousUrl, previousFramed);
          setWarning(error, true);
          return;
        }
        objectUrl = url;
        show(url, true);
        setWarning(notes.join(" "));
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        input.value = "";
        show(previousUrl, previousFramed);
        setWarning("That file couldn't be opened as an image. Try a JPG, PNG or WebP.", true);
      };
      probe.src = url;
    });
    return (existingUrl, existingFramed) => {
      input.value = "";
      previousUrl = existingUrl || "";
      previousFramed = !!existingFramed;
      setWarning("");
      show(previousUrl, previousFramed);
    };
  }

  // Swap an item with its neighbour inside `list`, then save the whole order.
  async function moveItem(list, id, direction, save) {
    const index = list.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= list.length) return false;
    [list[index], list[target]] = [list[target], list[index]];
    await save(list.map((item) => item.id));
    return true;
  }

  // ============================ Council members ============================

  const membersBody = document.getElementById("membersTableBody");
  const memberModal = document.getElementById("memberFormModal");
  const memberForm = document.getElementById("memberForm");
  const memberTitle = document.getElementById("memberFormTitle");
  const memberName = document.getElementById("memberNameInput");
  const memberPosition = document.getElementById("memberPositionInput");
  const memberGroup = document.getElementById("memberGroupInput");
  const memberVisible = document.getElementById("memberVisibleInput");
  const memberPhoto = document.getElementById("memberPhotoInput");
  const memberSave = document.getElementById("memberFormSave");
  const resetMemberPhoto = wireImagePicker(
    memberPhoto,
    document.getElementById("memberPhotoPreview"),
    document.getElementById("memberPhotoEmpty"),
    document.getElementById("memberPhotoWarn"),
    { isLogo: false }
  );
  let members = [];
  let editingMemberId = null;

  function sortMembers() {
    members.sort(
      (a, b) =>
        COUNCIL_GROUP_ORDER.indexOf(a.group) - COUNCIL_GROUP_ORDER.indexOf(b.group) ||
        a.order - b.order ||
        a.name.localeCompare(b.name)
    );
  }

  function renderMembers() {
    sortMembers();
    if (!members.length) {
      membersBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">No officials yet. Add the Punong Barangay to get started.</td></tr>`;
      return;
    }
    membersBody.innerHTML = members
      .map((m) => {
        const row = members.filter((x) => x.group === m.group);
        const pos = row.indexOf(m);
        return `
        <tr>
          <td>${
            m.photoUrl
              ? `<img class="setup-thumb${m.hasCustomPhoto ? " setup-thumb--framed" : ""}" src="${escapeHtml(m.photoUrl)}" alt="" />`
              : `<span class="setup-thumb setup-thumb--empty"></span>`
          }</td>
          <td><strong>${escapeHtml(m.name)}</strong><br /><span class="setup-sub">${escapeHtml(m.position)}</span></td>
          <td>${COUNCIL_GROUP_LABELS[m.group] || escapeHtml(m.group_display)}</td>
          <td>
            <div class="table-row-actions">
              <button type="button" data-member-up="${m.id}" ${pos === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(m.name)} up">&uarr;</button>
              <button type="button" data-member-down="${m.id}" ${pos === row.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(m.name)} down">&darr;</button>
              <button type="button" data-member-edit="${m.id}">Edit</button>
              <button type="button" data-member-toggle="${m.id}">${m.is_visible ? "Hide" : "Show"}</button>
              <button type="button" class="table-row-actions__danger" data-member-delete="${m.id}">Delete</button>
            </div>
          </td>
        </tr>`;
      })
      .join("");
  }

  function openMemberModal(member) {
    editingMemberId = member ? member.id : null;
    memberTitle.textContent = member ? "Edit Member" : "Add Member";
    clearFormError(memberForm);
    memberName.value = member ? member.name : "";
    memberPosition.value = member ? member.position : "";
    memberGroup.value = member ? member.group : "member";
    memberVisible.checked = member ? member.is_visible : true;
    resetMemberPhoto(member ? member.photoUrl : "", member ? member.hasCustomPhoto : false);
    memberModal.hidden = false;
    memberName.focus();
  }

  document.getElementById("addMemberBtn").addEventListener("click", () => openMemberModal(null));

  memberForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(memberForm);
    const fields = {
      name: memberName.value.trim(),
      position: memberPosition.value.trim(),
      group: memberGroup.value,
      is_visible: memberVisible.checked,
    };
    if (!fields.name || !fields.position) {
      showFormError(memberForm, "Please enter the name and position.");
      return;
    }
    if (memberPhoto.files[0]) fields.photo = memberPhoto.files[0];

    memberSave.disabled = true;
    memberSave.textContent = "Saving...";
    try {
      if (editingMemberId) {
        const updated = await updateCouncilMember(editingMemberId, fields);
        members = members.map((m) => (m.id === updated.id ? updated : m));
      } else {
        members.push(await createCouncilMember(fields));
      }
      renderMembers();
      memberModal.hidden = true;
    } catch (err) {
      showFormError(memberForm, err.message);
    } finally {
      memberSave.disabled = false;
      memberSave.textContent = "Save";
    }
  });

  membersBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { memberUp, memberDown, memberEdit, memberToggle, memberDelete } = btn.dataset;
    const id = memberUp || memberDown || memberEdit || memberToggle || memberDelete;
    const member = members.find((m) => m.id === id);
    if (!member) return;

    if (memberEdit) {
      openMemberModal(member);
      return;
    }
    if (memberDelete) {
      askToDelete({
        title: "Remove this official?",
        message: `This removes ${member.name} from the About Us page and deletes their photo. To keep them for later, use Hide instead.`,
        run: async () => {
          await deleteCouncilMember(member.id);
          members = members.filter((m) => m.id !== member.id);
          renderMembers();
        },
      });
      return;
    }

    btn.disabled = true;
    try {
      if (memberToggle) {
        const updated = await updateCouncilMember(member.id, { is_visible: !member.is_visible });
        members = members.map((m) => (m.id === updated.id ? updated : m));
      } else {
        const row = members.filter((m) => m.group === member.group);
        const moved = await moveItem(row, member.id, memberUp ? -1 : 1, reorderCouncilMembers);
        if (moved) row.forEach((m, i) => (m.order = i));
      }
      renderMembers();
    } catch (err) {
      siteAlert(err.message);
      btn.disabled = false;
    }
  });

  // ================================= Logos =================================

  const logosBody = document.getElementById("logosTableBody");
  const logoModal = document.getElementById("logoFormModal");
  const logoForm = document.getElementById("logoForm");
  const logoTitle = document.getElementById("logoFormTitle");
  const logoAlt = document.getElementById("logoAltInput");
  const logoVisible = document.getElementById("logoVisibleInput");
  const logoImage = document.getElementById("logoImageInput");
  const logoSave = document.getElementById("logoFormSave");
  const resetLogoImage = wireImagePicker(
    logoImage,
    document.getElementById("logoPreview"),
    document.getElementById("logoEmpty"),
    document.getElementById("logoWarn"),
    { isLogo: true }
  );
  let logos = [];
  let editingLogoId = null;

  function renderLogos() {
    logos.sort((a, b) => a.order - b.order);
    if (!logos.length) {
      logosBody.innerHTML = `<tr><td colspan="3" class="admin-table__empty">No logos yet.</td></tr>`;
      return;
    }
    logosBody.innerHTML = logos
      .map(
        (l, i) => `
        <tr>
          <td><img class="setup-thumb setup-thumb--logo" src="${escapeHtml(l.imageUrl)}" alt="" /></td>
          <td>${escapeHtml(l.alt_text)}</td>
          <td>
            <div class="table-row-actions">
              <button type="button" data-logo-up="${l.id}" ${i === 0 ? "disabled" : ""} aria-label="Move left">&larr;</button>
              <button type="button" data-logo-down="${l.id}" ${i === logos.length - 1 ? "disabled" : ""} aria-label="Move right">&rarr;</button>
              <button type="button" data-logo-edit="${l.id}">Edit</button>
              <button type="button" data-logo-toggle="${l.id}">${l.is_visible ? "Hide" : "Show"}</button>
              <button type="button" class="table-row-actions__danger" data-logo-delete="${l.id}">Delete</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  function openLogoModal(logo) {
    editingLogoId = logo ? logo.id : null;
    logoTitle.textContent = logo ? "Edit Logo" : "Add Logo";
    clearFormError(logoForm);
    logoAlt.value = logo ? logo.alt_text : "";
    logoVisible.checked = logo ? logo.is_visible : true;
    resetLogoImage(logo ? logo.imageUrl : "");
    logoModal.hidden = false;
  }

  document.getElementById("addLogoBtn").addEventListener("click", () => openLogoModal(null));

  logoForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(logoForm);
    const fields = { alt_text: logoAlt.value.trim(), is_visible: logoVisible.checked };
    if (!fields.alt_text) {
      showFormError(logoForm, "Please describe the logo.");
      return;
    }
    if (logoImage.files[0]) fields.image = logoImage.files[0];
    if (!editingLogoId && !fields.image) {
      showFormError(logoForm, "Choose an image for this logo.");
      return;
    }

    logoSave.disabled = true;
    logoSave.textContent = "Saving...";
    try {
      if (editingLogoId) {
        const updated = await updateAboutLogo(editingLogoId, fields);
        logos = logos.map((l) => (l.id === updated.id ? updated : l));
      } else {
        logos.push(await createAboutLogo(fields));
      }
      renderLogos();
      logoModal.hidden = true;
    } catch (err) {
      showFormError(logoForm, err.message);
    } finally {
      logoSave.disabled = false;
      logoSave.textContent = "Save";
    }
  });

  logosBody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const { logoUp, logoDown, logoEdit, logoToggle, logoDelete } = btn.dataset;
    const id = logoUp || logoDown || logoEdit || logoToggle || logoDelete;
    const logo = logos.find((l) => l.id === id);
    if (!logo) return;

    if (logoEdit) {
      openLogoModal(logo);
      return;
    }
    if (logoDelete) {
      askToDelete({
        title: "Remove this logo?",
        message: `This removes "${logo.alt_text}" from the About Us page. To keep it for later, use Hide instead.`,
        run: async () => {
          await deleteAboutLogo(logo.id);
          logos = logos.filter((l) => l.id !== logo.id);
          renderLogos();
        },
      });
      return;
    }

    btn.disabled = true;
    try {
      if (logoToggle) {
        const updated = await updateAboutLogo(logo.id, { is_visible: !logo.is_visible });
        logos = logos.map((l) => (l.id === updated.id ? updated : l));
      } else {
        const moved = await moveItem(logos, logo.id, logoUp ? -1 : 1, reorderAboutLogos);
        if (moved) logos.forEach((l, i) => (l.order = i));
      }
      renderLogos();
    } catch (err) {
      siteAlert(err.message);
      btn.disabled = false;
    }
  });

  // ================================= Load ==================================

  membersBody.innerHTML = skeletonTableRows(4, 5);
  logosBody.innerHTML = skeletonTableRows(3, 4);
  const [profileResult, membersResult, logosResult] = await Promise.allSettled([
    getBarangayProfile(),
    listCouncilMembers(),
    listAboutLogos(),
  ]);

  if (profileResult.status === "fulfilled") {
    fillProfileForm(profileResult.value);
  } else {
    showFormError(profileForm, profileResult.reason.message);
    profileSave.disabled = true;
  }
  if (membersResult.status === "fulfilled") {
    members = membersResult.value;
    renderMembers();
  } else {
    membersBody.innerHTML = `<tr><td colspan="5" class="admin-table__empty">${escapeHtml(membersResult.reason.message)}</td></tr>`;
  }
  if (logosResult.status === "fulfilled") {
    logos = logosResult.value;
    renderLogos();
  } else {
    logosBody.innerHTML = `<tr><td colspan="4" class="admin-table__empty">${escapeHtml(logosResult.reason.message)}</td></tr>`;
  }
});
