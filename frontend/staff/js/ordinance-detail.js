// Barangay Platero OVRMS — Ordinance detail: view real info, and (Secretary/Admin) edit
// it, including optionally replacing the PDF, via PATCH /api/ordinances/<id>/.

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");

  try {
    await ensureOrdinancesLoaded();
  } catch (err) {
    document.getElementById("detailTitle").textContent = err.message;
    document.getElementById("detailBody").hidden = true;
    return;
  }

  let ordinance = getOrdinanceById(id);

  if (!ordinance) {
    document.getElementById("detailTitle").textContent = "Document not found";
    document.getElementById("editOrdinanceBtn").hidden = true;
    return;
  }

  const detailTitle = document.getElementById("detailTitle");
  const detailMeta = document.getElementById("detailMeta");
  const detailDescription = document.getElementById("detailDescription");
  const detailDocPreview = document.getElementById("detailDocPreview");
  const pdfPreviewFrame = document.getElementById("pdfPreviewFrame");
  const pdfPreviewNote = document.getElementById("pdfPreviewNote");
  const detailDownload = document.getElementById("detailDownload");

  function renderDisplay() {
    document.title = `${ordinance.number} — Barangay Platero OVRMS`;
    detailTitle.textContent = `City Ordinance ${ordinance.number}`;
    document.getElementById("detailAuthor").textContent = ordinance.author;
    document.getElementById("detailDate").textContent = ordinance.dateApproved;
    document.getElementById("detailOrdinanceTitle").textContent = ordinance.title;
    document.getElementById("detailCategory").textContent = ordinance.category || "—";
    document.getElementById("detailUploadedBy").textContent = ordinance.uploadedBy || "—";

    detailDescription.innerHTML = "";
    ordinance.description.split("\n\n").forEach((para) => {
      const p = document.createElement("p");
      p.textContent = para;
      p.style.margin = "0 0 12px";
      detailDescription.appendChild(p);
    });

    if (ordinance.pdf) {
      renderPdfPreview(pdfPreviewFrame, ordinance.pdf);
      detailDocPreview.hidden = false;
      pdfPreviewNote.hidden = false;
      detailDownload.href = ordinance.pdf;
      detailDownload.target = "_blank";
      detailDownload.rel = "noopener";
      detailDownload.textContent = `Download ${ordinance.number}`;
      detailDownload.hidden = false;
    } else {
      detailDocPreview.hidden = true;
      pdfPreviewNote.hidden = true;
      detailDownload.hidden = true;
    }
  }

  renderDisplay();

  // ---- Edit mode (Secretary/Admin only — see ordinances-data.js) ----

  const canEdit = isDocumentManager(getAdminUser());

  const editBtn = document.getElementById("editOrdinanceBtn");
  editBtn.hidden = !canEdit;
  editBtn.setAttribute("aria-label", "Edit ordinance");

  if (!canEdit) return;

  const editForm = document.getElementById("editOrdinanceForm");
  const numberInput = document.getElementById("editNumberInput");
  const titleInput = document.getElementById("editTitleInput");
  const authorInput = document.getElementById("editAuthorInput");
  const authorSuggestions = document.getElementById("editAuthorSuggestions");
  const categoryInput = document.getElementById("editCategoryInput");
  const dateInput = document.getElementById("editDateInput");
  // An ordinance can't be approved on a date that hasn't happened yet.
  dateInput.max = new Date().toLocaleDateString("en-CA");
  const descriptionInput = document.getElementById("editDescriptionInput");
  const pdfInput = document.getElementById("editPdfInput");
  const pdfLabelText = document.getElementById("editPdfLabelText");
  const saveBtn = document.getElementById("editOrdinanceSave");
  const cancelBtn = document.getElementById("editOrdinanceCancel");
  const editError = document.getElementById("editOrdinanceError");
  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");

  // Category is a controlled dropdown (an Administrator maintains that list —
  // see ordinances/models.py's OrdinanceCategory), loaded up front rather than
  // on first "Edit" click so a slow request doesn't stall the click; failing
  // disables Edit entirely, since editing without it would mean falling back
  // to free text for a field meant to stay consistent. Author is free text
  // either way, so a failed suggestions fetch there just means no
  // autocomplete — not worth blocking Edit over.
  try {
    populateCategorySelect(categoryInput, await fetchOrdinanceCategories());
  } catch (err) {
    editBtn.hidden = true;
    return;
  }
  try {
    populateAuthorDatalist(authorSuggestions, await fetchOrdinanceAuthors());
  } catch {
    // No suggestions is a minor loss, not worth blocking Edit over.
  }

  // detailDocPreview/detailDownload are excluded here — their visibility
  // depends on whether ordinance.pdf exists, which renderDisplay() already
  // handles; blindly un-hiding them on exit would show an empty PDF preview
  // for an ordinance with no PDF.
  const displayEls = [detailTitle, detailMeta, detailDescription];

  // ---- Unsaved-changes tracking ----
  // Snapshotted right as edit mode opens; isDirty() compares the live
  // inputs against it. hasPdf rather than the File object itself, since two
  // different File objects are never === even for the same picked file.
  let savedSnapshot = null;

  function snapshotForm() {
    return {
      number: numberInput.value,
      title: titleInput.value,
      author: authorInput.value,
      category: categoryInput.value,
      date: dateInput.value,
      description: descriptionInput.value,
      hasPdf: pdfInput.files.length > 0,
    };
  }

  function isDirty() {
    if (editForm.hidden || !savedSnapshot) return false;
    const now = snapshotForm();
    return Object.keys(now).some((key) => now[key] !== savedSnapshot[key]);
  }

  function enterEditMode() {
    numberInput.value = ordinance.number;
    titleInput.value = ordinance.title;
    authorInput.value = ordinance.author;
    // Category was chosen from this same list at upload time, so it's a
    // direct match unless an Administrator has since renamed/retired it —
    // in that rare case this just leaves the placeholder selected, and
    // saving requires picking a currently-valid one (same as any other
    // required field here).
    categoryInput.value = ordinance.category;
    dateInput.value = ordinance.dateApprovedRaw;
    descriptionInput.value = ordinance.description;
    pdfInput.value = "";
    pdfLabelText.textContent = "Click to replace the PDF (optional)";
    editError.hidden = true;

    displayEls.forEach((el) => (el.hidden = true));
    detailDocPreview.hidden = true;
    pdfPreviewNote.hidden = true;
    detailDownload.hidden = true;
    editBtn.hidden = true;
    editForm.hidden = false;
    savedSnapshot = snapshotForm();
  }

  function exitEditMode() {
    displayEls.forEach((el) => (el.hidden = false));
    detailDocPreview.hidden = !ordinance.pdf;
    pdfPreviewNote.hidden = !ordinance.pdf;
    detailDownload.hidden = !ordinance.pdf;
    editBtn.hidden = false;
    editForm.hidden = true;
    savedSnapshot = null;
  }

  editBtn.addEventListener("click", enterEditMode);
  pdfInput.addEventListener("change", () => {
    pdfLabelText.textContent = pdfInput.files[0] ? pdfInput.files[0].name : "Click to replace the PDF (optional)";
  });

  // Returns true on success — shared between the Save Changes button and
  // the unsaved-changes modal's own "Save Changes" option.
  async function commitSave() {
    const fields = {
      number: numberInput.value.trim(),
      title: titleInput.value.trim(),
      author: authorInput.value.trim(),
      category: categoryInput.value,
      dateApproved: dateInput.value,
      description: descriptionInput.value.trim(),
      pdfFile: pdfInput.files[0],
    };

    if (!fields.number || !fields.title || !fields.author || !fields.category || !fields.dateApproved || !fields.description) {
      editError.textContent = "Please fill in every field.";
      editError.hidden = false;
      return false;
    }
    if (fields.pdfFile && !isAcceptableOrdinancePdf(fields.pdfFile)) {
      editError.textContent = ORDINANCE_FILE_ERROR;
      editError.hidden = false;
      return false;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      ordinance = await updateOrdinanceById(ordinance.id, fields);
      renderDisplay();
      return true;
    } catch (err) {
      editError.textContent = err.message;
      editError.hidden = false;
      return false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }

  saveBtn.addEventListener("click", async () => {
    if (await commitSave()) exitEditMode();
  });

  // What to do once the unsaved-changes modal resolves (Save/Discard) —
  // null just exits edit mode in place (Cancel button), or a real
  // navigation when a sidebar/other in-page link triggered it.
  let pendingAction = null;

  cancelBtn.addEventListener("click", () => {
    if (isDirty()) {
      pendingAction = null;
      unsavedChangesModal.hidden = false;
    } else {
      exitEditMode();
    }
  });

  unsavedSaveBtn.addEventListener("click", async () => {
    unsavedChangesModal.hidden = true;
    const saved = await commitSave();
    if (saved) {
      exitEditMode();
      if (pendingAction) pendingAction();
    }
    pendingAction = null;
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    exitEditMode();
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

  // Catches every in-page link (sidebar, navbar, etc.) while mid-edit —
  // beforeunload below is the fallback for anything that isn't a click
  // (browser back/refresh/close).
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

  window.addEventListener("beforeunload", (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });
});
