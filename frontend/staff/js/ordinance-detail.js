// Ordinance detail (staff): shows an ordinance; the Secretary/Administrator can
// edit it and replace the PDF (PATCH /api/ordinances/<id>/).

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

  const canEdit = isDocumentManager(getCurrentUser());

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

  // The category list is loaded now; without it Edit is disabled. The author
  // suggestions are optional.
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

  // (The PDF preview and Download button are handled by renderDisplay().)
  const displayEls = [detailTitle, detailMeta, detailDescription];

  // ---- Unsaved changes ----
  // The values when Edit was opened; isDirty() compares the inputs with them.
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
    // If the category was renamed or retired, nothing is selected and one must be picked.
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

  // Saves the edit. Returns true on success.
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

  // What to do after the unsaved-changes popup: null = just leave edit mode.
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

  // Clicking any link while editing asks first (closing the tab shows the browser's warning).
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
