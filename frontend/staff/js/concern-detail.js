// Barangay Platero OVRMS — Concern/Suggestion detail: view real info, leave remarks and
// assign a category (PATCH /api/concerns/staff/<id>/). Status isn't edited
// here: the server marks it Reviewed once it's categorized or given remarks.

const CONCERN_EVIDENCE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

// Opens the clicked thumbnail full-size in an overlay on this same page,
// instead of navigating to it in a new tab.
function openMediaLightbox(url, isVideo) {
  const lightbox = document.getElementById("mediaLightbox");
  const body = document.getElementById("mediaLightboxBody");
  if (!lightbox || !body) return;
  body.innerHTML = isVideo
    ? `<video src="${url}" controls autoplay></video>`
    : `<img src="${url}" alt="Uploaded evidence" />`;
  lightbox.hidden = false;
}

function renderConcernDetailEvidence(container, urls) {
  if (!urls || !urls.length) {
    container.innerHTML = `<div class="evidence-photo">No uploaded evidence</div>`;
    return;
  }
  container.className = "evidence-photo-grid";
  container.innerHTML = urls
    .map((url) => {
      const isVideo = CONCERN_EVIDENCE_VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
      const media = isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="Uploaded evidence" />`;
      return `<button type="button" class="evidence-photo-grid__item" data-lightbox-url="${url}" data-lightbox-video="${isVideo}">${media}</button>`;
    })
    .join("");
  container.querySelectorAll("[data-lightbox-url]").forEach((btn) => {
    btn.addEventListener("click", () => openMediaLightbox(btn.dataset.lightboxUrl, btn.dataset.lightboxVideo === "true"));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");
  const main = document.querySelector(".report-detail-main");

  try {
    await Promise.all([ensureConcernsLoaded(), ensureFoldersLoaded()]);
  } catch (err) {
    main.innerHTML = `<p>${err.message}</p>`;
    return;
  }

  const concern = getConcernById(id);

  if (!concern) {
    main.innerHTML = "<p>Concern/Suggestion not found.</p>";
    return;
  }

  document.title = `Concern/Suggestion — Barangay Platero OVRMS`;

  document.getElementById("concernName").value = concern.reporter;
  document.getElementById("concernContact").value = concern.contactNumber || "";
  document.getElementById("concernLocation").value = concern.location || "";
  document.getElementById("concernText").value = concern.concernText;

  const evidenceEl = document.getElementById("concernEvidence");
  if (evidenceEl) renderConcernDetailEvidence(evidenceEl, concern.attachments);

  const timelineItems = document.getElementById("timelineItems");
  const submittedTime = concern.dateSubmitted.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  timelineItems.innerHTML = `
    <div class="status-timeline__item">
      <span class="status-timeline__dot"></span>
      <div>
        <div class="status-timeline__meta">
          <span class="status-timeline__label">Submitted</span>
          <span class="status-timeline__date">${formatConcernDate(concern.dateSubmitted)}, ${submittedTime}</span>
        </div>
        <p class="status-timeline__desc">The concern/suggestion was submitted.</p>
      </div>
    </div>`;

  const STATUS_PILL_CLASS = { Submitted: "status-pill--new", Reviewed: "status-pill--resolved" };

  const statusPill = document.getElementById("statusPill");
  const statusAutoHint = document.getElementById("statusAutoHint");
  const remarksInput = document.getElementById("remarksInput");
  const saveBtn = document.getElementById("saveChangesBtn");
  const backBtn = document.getElementById("backToConcernsBtn");

  const saveConfirmModal = document.getElementById("saveConfirmModal");
  const saveConfirmOk = document.getElementById("saveConfirmOk");
  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");

  // Concerns/Suggestions is the Secretary's section (see
  // frontend/staff/js/admin.js's STAFF_NAV_ACCESS + StaffConcernDetailView.
  // patch's IsSecretaryOrAdmin check) — Barangay Captain reaching this page
  // from their read-only dashboard just sees it, no editing.
  const currentUser = getAdminUser();
  const isSecretary = currentUser && currentUser.position === "Secretary";
  if (!isSecretary) saveBtn.hidden = true;

  remarksInput.value = concern.remarks || "";
  remarksInput.disabled = !isSecretary;

  let savedRemarks = remarksInput.value.trim();

  function applyPill(status) {
    statusPill.className = `status-pill ${STATUS_PILL_CLASS[status] || "status-pill--new"}`;
    statusPill.textContent = status;
    statusAutoHint.hidden = !isSecretary || status !== "Submitted";
  }

  applyPill(concern.status);

  // ---- Folder assignment — saves immediately on Assign/Remove, independent
  // of the Status/Remarks Save Changes flow below. ----

  const folderAssigned = document.getElementById("folderAssigned");
  const folderChip = document.getElementById("folderChip");
  const folderUnassignBtn = document.getElementById("folderUnassignBtn");
  const assignFolderBtn = document.getElementById("assignFolderBtn");
  const assignFolderModal = document.getElementById("assignFolderModal");
  const assignFolderSelect = document.getElementById("assignFolderSelect");
  const assignFolderNewInput = document.getElementById("assignFolderNewInput");
  const assignFolderConfirm = document.getElementById("assignFolderConfirm");
  const assignFolderCancel = document.getElementById("assignFolderCancel");

  function renderFolderAssignment() {
    if (concern.folderId) {
      folderAssigned.hidden = false;
      assignFolderBtn.hidden = true;
      folderChip.innerHTML = `<svg class="nav-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 014.5 5h4.4a1.5 1.5 0 011.1.5l1.3 1.4a1.5 1.5 0 001.1.5H19.5A1.5 1.5 0 0121 9v8.5A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/></svg> ${concern.folderName}`;
      // Only the Secretary can remove a folder assignment — Barangay
      // Captain sees the same chip, read-only.
      folderUnassignBtn.hidden = !isSecretary;
    } else {
      folderAssigned.hidden = true;
      assignFolderBtn.hidden = !isSecretary;
    }
  }
  renderFolderAssignment();

  function populateFolderSelect() {
    assignFolderSelect.innerHTML =
      `<option value="">&mdash; Select a category &mdash;</option>` +
      liveFolders().map((f) => `<option value="${f.id}">${f.name}</option>`).join("");
  }

  assignFolderBtn.addEventListener("click", () => {
    populateFolderSelect();
    assignFolderNewInput.value = "";
    assignFolderModal.hidden = false;
  });
  folderUnassignBtn.addEventListener("click", async () => {
    try {
      await assignConcernFolder(concern.id, null);
      concern.folderId = null;
      concern.folderName = null;
      renderFolderAssignment();
    } catch (err) {
      siteAlert(err.message);
    }
  });
  assignFolderCancel.addEventListener("click", () => {
    assignFolderModal.hidden = true;
  });
  assignFolderModal.addEventListener("click", (e) => {
    if (e.target === assignFolderModal) assignFolderModal.hidden = true;
  });
  assignFolderConfirm.addEventListener("click", async () => {
    const newName = assignFolderNewInput.value.trim();
    assignFolderConfirm.disabled = true;
    try {
      let folderId = assignFolderSelect.value;
      let folderName;
      if (newName) {
        await createFolder(newName);
        const created = liveFolders().find((f) => f.name.toLowerCase() === newName.toLowerCase());
        if (!created) throw new Error("Could not create this category.");
        folderId = created.id;
        folderName = created.name;
      } else if (folderId) {
        folderName = liveFolders().find((f) => f.id === folderId)?.name;
      } else {
        assignFolderConfirm.disabled = false;
        return;
      }

      const updated = await assignConcernFolder(concern.id, folderId);
      concern.folderId = folderId;
      concern.folderName = folderName;
      concern.status = updated.status;
      applyPill(concern.status);
      renderFolderAssignment();
      assignFolderModal.hidden = true;
    } catch (err) {
      siteAlert(err.message);
    } finally {
      assignFolderConfirm.disabled = false;
    }
  });

  function isDirty() {
    return remarksInput.value.trim() !== savedRemarks;
  }

  async function commitSave() {
    const patch = { remarks: remarksInput.value.trim() };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      const updated = await updateConcernStatus(concern.id, patch);
      savedRemarks = patch.remarks;
      concern.status = updated.status;
      applyPill(concern.status);
      return true;
    } catch (err) {
      siteAlert(err.message);
      return false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }

  saveBtn.addEventListener("click", async () => {
    if (await commitSave()) saveConfirmModal.hidden = false;
  });
  saveConfirmOk.addEventListener("click", () => {
    saveConfirmModal.hidden = true;
  });

  // Back to the page this was opened from (Concerns/Suggestions, the
  // dashboard, Notifications...); opened directly, Concerns/Suggestions.
  function goToConcerns() {
    let target = "concerns.html";
    try {
      const from = new URL(document.referrer);
      if (
        from.origin === window.location.origin &&
        from.pathname.includes("/staff/") &&
        !/\/staff\/(index\.html)?$/.test(from.pathname) &&
        from.pathname !== window.location.pathname
      ) {
        target = from.href;
      }
    } catch {
      // No referrer (opened directly / from a bookmark).
    }
    window.location.href = target;
  }

  backBtn.addEventListener("click", () => {
    if (isDirty()) {
      unsavedChangesModal.hidden = false;
    } else {
      goToConcerns();
    }
  });
  unsavedSaveBtn.addEventListener("click", async () => {
    unsavedChangesModal.hidden = true;
    if (await commitSave()) goToConcerns();
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    goToConcerns();
  });
  unsavedCancelBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
  });
  [saveConfirmModal, unsavedChangesModal].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
});
