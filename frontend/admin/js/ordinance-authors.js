// Barangay Platero OVRMS — Ordinance Authors: Administrator-only management of the roster
// behind Upload/Edit Ordinance's Author autocomplete suggestions (see
// ordinance-authors-data.js — the field itself stays free text). List, add,
// edit (name/position/active), and remove — deactivating (rather than
// deleting) is the normal way a term ends, since it keeps the entry around
// for past ordinances' history; delete is only for an entry added by
// mistake (see the backend's docstring).

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("authorsTableBody");
  const addBtn = document.getElementById("addAuthorBtn");

  const formModal = document.getElementById("authorFormModal");
  const formTitle = document.getElementById("authorFormTitle");
  const form = document.getElementById("authorForm");
  const nameInput = document.getElementById("authorNameInput");
  const positionInput = document.getElementById("authorPositionInput");
  const formError = document.getElementById("authorFormError");
  const saveBtn = document.getElementById("authorFormSave");

  const deleteModal = document.getElementById("deleteAuthorModal");
  const deleteMessage = document.getElementById("deleteAuthorMessage");
  const deleteConfirm = document.getElementById("deleteAuthorConfirm");

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function render() {
    const authors = liveOrdinanceAuthors();
    if (!authors.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="ordinances-empty">No authors yet — add the current Kagawad and Barangay Captain to get started.</td></tr>`;
      return;
    }
    tbody.innerHTML = authors
      .map(
        (a) => `
        <tr data-id="${a.id}">
          <td>${escapeHtml(a.name)}</td>
          <td>${escapeHtml(a.position_display)}</td>
          <td>${
            a.is_active
              ? `<span class="status-badge status-badge--resolved">Active</span>`
              : `<span class="status-badge status-badge--submitted">Inactive</span>`
          }</td>
          <td>
            <div class="table-row-actions">
              <button type="button" data-edit="${a.id}">Edit</button>
              <button type="button" data-toggle="${a.id}">${a.is_active ? "Deactivate" : "Reactivate"}</button>
              <button type="button" class="table-row-actions__danger" data-delete="${a.id}">Delete</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  tbody.innerHTML = skeletonTableRows(4, 4);
  try {
    await ensureAllOrdinanceAuthorsLoaded();
    render();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="ordinances-empty">${err.message}</td></tr>`;
    return;
  }

  // ---- Add/Edit modal ----

  let editingId = null;

  function openAddModal() {
    editingId = null;
    formTitle.textContent = "Add Author";
    form.reset();
    clearFormError(form);
    formModal.hidden = false;
    nameInput.focus();
  }

  function openEditModal(author) {
    editingId = author.id;
    formTitle.textContent = "Edit Author";
    nameInput.value = author.name;
    positionInput.value = author.position;
    clearFormError(form);
    formModal.hidden = false;
    nameInput.focus();
  }

  addBtn.addEventListener("click", openAddModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);

    const fields = { name: nameInput.value.trim(), position: positionInput.value };
    if (!fields.name || !fields.position) {
      showFormError(form, "Please fill in both fields.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      if (editingId) {
        await updateOrdinanceAuthor(editingId, fields);
      } else {
        await createOrdinanceAuthor(fields);
      }
      render();
      formModal.hidden = true;
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  });

  // ---- Row actions (event delegation — rows are re-rendered wholesale on every change) ----

  tbody.addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const toggleId = e.target.dataset.toggle;
    const deleteId = e.target.dataset.delete;

    if (editId) {
      const author = liveOrdinanceAuthors().find((a) => a.id === editId);
      if (author) openEditModal(author);
      return;
    }

    if (toggleId) {
      const author = liveOrdinanceAuthors().find((a) => a.id === toggleId);
      if (!author) return;
      e.target.disabled = true;
      try {
        await updateOrdinanceAuthor(toggleId, { is_active: !author.is_active });
        render();
      } catch (err) {
        siteAlert(err.message);
      } finally {
        e.target.disabled = false;
      }
      return;
    }

    if (deleteId) {
      const author = liveOrdinanceAuthors().find((a) => a.id === deleteId);
      if (!author) return;
      deleteMessage.textContent = `This removes ${author.name} from the roster entirely. Ordinances already uploaded under this name are unaffected — if their term just ended, Deactivate instead.`;
      deleteConfirm.dataset.id = deleteId;
      deleteModal.hidden = false;
    }
  });

  deleteConfirm.addEventListener("click", async () => {
    const id = deleteConfirm.dataset.id;
    deleteConfirm.disabled = true;
    try {
      await deleteOrdinanceAuthor(id);
      render();
      deleteModal.hidden = true;
    } catch (err) {
      siteAlert(err.message);
    } finally {
      deleteConfirm.disabled = false;
    }
  });
});
