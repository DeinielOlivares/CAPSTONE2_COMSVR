// Ordinance Categories (admin, part of the Ordinance Setup page): add, rename,
// retire or remove categories. Retire old ones; delete only mistakes.

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("categoriesTableBody");
  const addBtn = document.getElementById("addCategoryBtn");

  const formModal = document.getElementById("categoryFormModal");
  const formTitle = document.getElementById("categoryFormTitle");
  const form = document.getElementById("categoryForm");
  const nameInput = document.getElementById("categoryNameInput");
  const formError = document.getElementById("categoryFormError");
  const saveBtn = document.getElementById("categoryFormSave");

  const deleteModal = document.getElementById("deleteCategoryModal");
  const deleteMessage = document.getElementById("deleteCategoryMessage");
  const deleteConfirm = document.getElementById("deleteCategoryConfirm");

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function render() {
    const categories = liveOrdinanceCategories();
    if (!categories.length) {
      tbody.innerHTML = `<tr><td colspan="3" class="ordinances-empty">No categories yet — add at least one before anyone can upload an ordinance.</td></tr>`;
      return;
    }
    tbody.innerHTML = categories
      .map(
        (c) => `
        <tr data-id="${c.id}">
          <td>${escapeHtml(c.name)}</td>
          <td>${
            c.is_active
              ? `<span class="status-badge status-badge--resolved">Active</span>`
              : `<span class="status-badge status-badge--submitted">Inactive</span>`
          }</td>
          <td>
            <div class="table-row-actions">
              <button type="button" data-edit="${c.id}">Rename</button>
              <button type="button" data-toggle="${c.id}">${c.is_active ? "Retire" : "Reactivate"}</button>
              <button type="button" class="table-row-actions__danger" data-delete="${c.id}">Delete</button>
            </div>
          </td>
        </tr>`
      )
      .join("");
  }

  tbody.innerHTML = skeletonTableRows(4, 3);
  try {
    await ensureAllOrdinanceCategoriesLoaded();
    render();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" class="ordinances-empty">${err.message}</td></tr>`;
    return;
  }

  // ---- Add/Edit modal ----

  let editingId = null;

  function openAddModal() {
    editingId = null;
    formTitle.textContent = "Add Category";
    form.reset();
    clearFormError(form);
    formModal.hidden = false;
    nameInput.focus();
  }

  function openEditModal(category) {
    editingId = category.id;
    formTitle.textContent = "Rename Category";
    nameInput.value = category.name;
    clearFormError(form);
    formModal.hidden = false;
    nameInput.focus();
  }

  addBtn.addEventListener("click", openAddModal);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);

    const name = nameInput.value.trim();
    if (!name) {
      showFormError(form, "Please enter a name.");
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      if (editingId) {
        await updateOrdinanceCategory(editingId, { name });
      } else {
        await createOrdinanceCategory({ name });
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

  // ---- Row buttons (one listener on the table; rows are re-drawn on every change) ----

  tbody.addEventListener("click", async (e) => {
    const editId = e.target.dataset.edit;
    const toggleId = e.target.dataset.toggle;
    const deleteId = e.target.dataset.delete;

    if (editId) {
      const category = liveOrdinanceCategories().find((c) => c.id === editId);
      if (category) openEditModal(category);
      return;
    }

    if (toggleId) {
      const category = liveOrdinanceCategories().find((c) => c.id === toggleId);
      if (!category) return;
      e.target.disabled = true;
      try {
        await updateOrdinanceCategory(toggleId, { is_active: !category.is_active });
        render();
      } catch (err) {
        siteAlert(err.message);
      } finally {
        e.target.disabled = false;
      }
      return;
    }

    if (deleteId) {
      const category = liveOrdinanceCategories().find((c) => c.id === deleteId);
      if (!category) return;
      deleteMessage.textContent = `This removes "${category.name}" entirely. Ordinances already filed under it are unaffected — if it's just falling out of use, Retire instead.`;
      deleteConfirm.dataset.id = deleteId;
      deleteModal.hidden = false;
    }
  });

  deleteConfirm.addEventListener("click", async () => {
    const id = deleteConfirm.dataset.id;
    deleteConfirm.disabled = true;
    try {
      await deleteOrdinanceCategory(id);
      render();
      deleteModal.hidden = true;
    } catch (err) {
      siteAlert(err.message);
    } finally {
      deleteConfirm.disabled = false;
    }
  });
});
