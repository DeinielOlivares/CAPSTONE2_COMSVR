// Barangay Platero OVRMS — Upload Ordinance: a dedicated page (not a modal). Secretary/
// Admin only — everyone else with access to ordinances.html is sent back,
// same as OrdinanceListCreateView's IsDocumentManager check on the backend.

document.addEventListener("DOMContentLoaded", async () => {
  if (!isDocumentManager(getAdminUser())) {
    window.location.href = "ordinances.html";
    return;
  }

  const form = document.getElementById("uploadOrdinanceForm");
  const numberInput = document.getElementById("ordNumberInput");
  const titleInput = document.getElementById("ordTitleInput");
  const authorCombobox = document.getElementById("ordAuthorCombobox");
  const authorBox = document.getElementById("ordAuthorBox");
  const authorTagsEl = document.getElementById("ordAuthorTags");
  const authorPanel = document.getElementById("ordAuthorPanel");
  const authorRosterList = document.getElementById("ordAuthorRosterList");
  const authorCustomInput = document.getElementById("ordAuthorCustomInput");
  const categoryInput = document.getElementById("ordCategoryInput");
  const dateInput = document.getElementById("ordDateInput");
  // An ordinance can't be approved on a date that hasn't happened yet.
  dateInput.max = new Date().toLocaleDateString("en-CA");
  const descriptionInput = document.getElementById("ordDescriptionInput");
  const pdfInput = document.getElementById("ordPdfInput");
  const pdfLabelText = document.getElementById("ordPdfLabelText");
  const uploadConfirm = document.getElementById("uploadOrdinanceConfirm");
  const uploadError = document.getElementById("uploadOrdinanceError");

  // ---- Multi-author select ----
  // Picked from the Councilors/Kagawad/Barangay Captain roster (see
  // ordinances-data.js's fetchOrdinanceAuthors) via the checklist, or typed
  // in directly for anyone not yet on that roster — then joined into the
  // single Ordinance.author field on submit (e.g. "Hon. A, Hon. B").
  let authorRoster = [];
  let authors = [];

  function escapeAuthorHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderAuthorTags() {
    authorTagsEl.innerHTML = authors
      .map(
        (name, i) => `
        <span class="author-tag">
          ${escapeAuthorHtml(name)}
          <button type="button" class="author-tag__remove" data-remove-author="${i}" aria-label="Remove ${escapeAuthorHtml(name)}">&times;</button>
        </span>`
      )
      .join("");
    authorTagsEl.querySelectorAll("[data-remove-author]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        authors.splice(Number(btn.dataset.removeAuthor), 1);
        renderAuthorTags();
        renderAuthorRoster();
      });
    });
  }

  // Adds a name whether it came from the roster checklist or was typed —
  // duplicates (case-insensitively) are ignored rather than added twice.
  function addAuthor(name) {
    const trimmed = name.trim();
    if (!trimmed || authors.some((a) => a.toLowerCase() === trimmed.toLowerCase())) return;
    authors.push(trimmed);
    renderAuthorTags();
    renderAuthorRoster();
  }

  function toggleAuthor(name) {
    const idx = authors.findIndex((a) => a.toLowerCase() === name.toLowerCase());
    if (idx === -1) authors.push(name);
    else authors.splice(idx, 1);
    renderAuthorTags();
    renderAuthorRoster();
  }

  // The typed name doubles as a live filter on the roster list below it —
  // this is a short, already-loaded local array, not a paginated list, so
  // filtering as-you-type (rather than only on Enter) is just a normal
  // combobox, not the "search-on-submit" pattern used for staff work queues.
  function renderAuthorRoster() {
    const query = authorCustomInput.value.trim().toLowerCase();
    const matches = query ? authorRoster.filter((a) => a.name.toLowerCase().includes(query)) : authorRoster;

    if (matches.length) {
      authorRosterList.innerHTML = matches
        .map((a) => {
          const selected = authors.some((added) => added.toLowerCase() === a.name.toLowerCase());
          return `
        <li data-name="${escapeAuthorHtml(a.name)}" class="${selected ? "is-selected" : ""}">
          <span class="author-select__check">${selected ? "&#10003;" : ""}</span>
          <span>${escapeAuthorHtml(a.name)}<small>${escapeAuthorHtml(a.position_display)}</small></span>
        </li>`;
        })
        .join("");
    } else if (query) {
      authorRosterList.innerHTML = `<li class="author-select__panel__empty">No roster match for "${escapeAuthorHtml(authorCustomInput.value.trim())}" — press Enter to add it as a new author.</li>`;
    } else {
      authorRosterList.innerHTML = `<li class="author-select__panel__empty">No roster entries yet — add them under Ordinance Setup (Admin Portal), or just type a name above.</li>`;
    }
    authorRosterList.querySelectorAll("li[data-name]").forEach((li) => {
      li.addEventListener("click", () => toggleAuthor(li.dataset.name));
    });
  }

  function openAuthorPanel() {
    authorPanel.hidden = false;
    authorBox.setAttribute("aria-expanded", "true");
    authorCustomInput.focus();
  }
  function closeAuthorPanel() {
    authorPanel.hidden = true;
    authorBox.setAttribute("aria-expanded", "false");
  }

  authorBox.addEventListener("click", () => {
    if (authorPanel.hidden) openAuthorPanel();
    else closeAuthorPanel();
  });
  authorBox.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (authorPanel.hidden) openAuthorPanel();
      else closeAuthorPanel();
    } else if (e.key === "Escape") {
      closeAuthorPanel();
    }
  });
  authorCustomInput.addEventListener("input", renderAuthorRoster);
  authorCustomInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const typed = authorCustomInput.value.trim();
      if (typed) {
        // Cleared before adding (not after) so addAuthor's own re-render of
        // the roster list picks up the now-empty filter and shows the full
        // list again, instead of staying stuck on the just-added query.
        authorCustomInput.value = "";
        addAuthor(typed);
      }
    } else if (e.key === "Backspace" && !authorCustomInput.value && authors.length) {
      authors.pop();
      renderAuthorTags();
      renderAuthorRoster();
    } else if (e.key === "Escape") {
      closeAuthorPanel();
    }
  });
  // composedPath(), not .contains(e.target) — toggling a roster author
  // re-renders authorRosterList's innerHTML from inside its own click
  // handler, which detaches the clicked <li> mid-bubble; a plain .contains()
  // check on the (now detached) target would wrongly think the click landed
  // outside and close the panel after every single selection. composedPath()
  // is captured at dispatch time, before that removal, so it isn't fooled.
  document.addEventListener("click", (e) => {
    if (!e.composedPath().includes(authorCombobox)) closeAuthorPanel();
  });

  // Category IS a controlled dropdown (an Administrator maintains that list —
  // see accounts.views.IsAdmin and ordinances/models.py's OrdinanceCategory),
  // so it needs loading before the form is usable; a failed author-roster
  // fetch isn't fatal the same way, since the rest of the form still works.
  try {
    populateCategorySelect(categoryInput, await fetchOrdinanceCategories());
  } catch (err) {
    uploadError.textContent = err.message;
    uploadError.hidden = false;
    uploadConfirm.disabled = true;
  }
  try {
    authorRoster = await fetchOrdinanceAuthors();
  } catch {
    // An empty roster just means nothing to pick from yet.
  }
  renderAuthorRoster();

  // The Secretary types every detail in by hand — picking the PDF only
  // attaches it. A wrong type/oversize file is flagged right away, rather
  // than only once Upload is pressed.
  pdfInput.addEventListener("change", () => {
    const file = pdfInput.files[0];
    pdfLabelText.textContent = file ? file.name : "Click to browse for the ordinance PDF";
    if (file && !isAcceptableOrdinancePdf(file)) {
      uploadError.textContent = ORDINANCE_FILE_ERROR;
      uploadError.hidden = false;
    } else if (uploadError.textContent === ORDINANCE_FILE_ERROR) {
      uploadError.hidden = true;
    }
  });

  const unsavedGuard = guardUnsavedForm(form, () => authors.length > 0 || formHasEntries(form));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    uploadError.hidden = true;

    const fields = {
      number: numberInput.value.trim(),
      // Collapsed to a single line — the field is now a wrapping textarea
      // (so a long title is never scrolled out of view while typing), but
      // the title itself is still conceptually one line, not a paragraph.
      title: titleInput.value.replace(/\s+/g, " ").trim(),
      author: authors.join(", "),
      category: categoryInput.value,
      dateApproved: dateInput.value,
      description: descriptionInput.value.trim(),
      pdfFile: pdfInput.files[0],
    };

    if (!authors.length || !fields.category) {
      uploadError.textContent = "Please add at least one author and select a category.";
      uploadError.hidden = false;
      return;
    }

    if (!fields.pdfFile) {
      uploadError.textContent = "Please attach the ordinance PDF.";
      uploadError.hidden = false;
      return;
    }
    if (!isAcceptableOrdinancePdf(fields.pdfFile)) {
      uploadError.textContent = ORDINANCE_FILE_ERROR;
      uploadError.hidden = false;
      return;
    }

    uploadConfirm.disabled = true;
    uploadConfirm.textContent = "Uploading...";
    try {
      await createOrdinance(fields);
      unsavedGuard.allowLeave();
      window.location.href = "ordinances.html";
    } catch (err) {
      uploadError.textContent = err.message;
      uploadError.hidden = false;
      uploadConfirm.disabled = false;
      uploadConfirm.textContent = "Upload";
    }
  });
});
