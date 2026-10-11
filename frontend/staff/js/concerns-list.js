// Barangay Platero OVRMS — Concerns/Suggestions list: search, status filter, folder
// filter/create/rename/delete, and pagination — all wired to the real API
// (concerns-data.js). Folder membership is a separate axis from status;
// selecting a folder narrows the list the same way the status dropdown does.

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const searchForm = document.getElementById("concernSearchForm");
  const searchInput = document.getElementById("concernSearchInput");
  const statusFilter = document.getElementById("statusFilter");
  const list = document.getElementById("concernsList");
  const pagination = document.getElementById("concernsPagination");
  const pageSizeSelect = document.getElementById("concernsPageSize");
  const foldersList = document.getElementById("foldersList");
  const allFoldersBtn = document.getElementById("allFoldersBtn");
  const addFolderBtn = document.getElementById("addFolderBtn");

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  const folderNameModal = document.getElementById("folderNameModal");
  const folderNameModalTitle = document.getElementById("folderNameModalTitle");
  const folderNameInput = document.getElementById("folderNameInput");
  const folderNameConfirm = document.getElementById("folderNameConfirm");
  const folderNameCancel = document.getElementById("folderNameCancel");

  const folderDeleteModal = document.getElementById("folderDeleteModal");
  const folderDeleteName = document.getElementById("folderDeleteName");
  const folderDeleteConfirm = document.getElementById("folderDeleteConfirm");
  const folderDeleteCancel = document.getElementById("folderDeleteCancel");

  // Concerns/Suggestions is the Secretary's section (see
  // frontend/staff/js/admin.js's STAFF_NAV_ACCESS + ConcernFolder*View's
  // IsSecretaryOrAdmin check) — Barangay Captain can reach this list too,
  // but strictly to view: no creating/renaming/deleting categories. Per-
  // concern responding is gated the same way in concern-detail.js.
  const currentUser = getAdminUser();
  const isSecretary = currentUser && currentUser.position === "Secretary";
  if (!isSecretary) addFolderBtn.hidden = true;

  let page = 1;
  // Only re-filters on Search (or pressing Enter in the field), not on every
  // keystroke — this tracks the query that was actually searched for.
  let appliedQuery = "";
  let activeFolderId = null; // null = "All Concerns/Suggestions"
  let folderModalMode = "create"; // "create" | "rename"
  let renameTargetId = null;
  let deleteTargetId = null;

  list.innerHTML = `<div class="ordinances-empty">Loading concerns/suggestions...</div>`;
  try {
    await Promise.all([ensureConcernsLoaded(), ensureFoldersLoaded()]);
  } catch (err) {
    list.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    return;
  }

  const badgeClass = {
    Submitted: "status-badge--submitted",
    Reviewed: "status-badge--resolved",
  };

  function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  // ---- Folders sidebar ----

  function renderFolders() {
    foldersList.innerHTML = liveFolders()
      .map(
        (f) => `
        <div class="folder-row">
          <button type="button" class="folder-chip${activeFolderId === f.id ? " active" : ""}" data-folder="${f.id}">
            <span><svg class="nav-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A1.5 1.5 0 014.5 5h4.4a1.5 1.5 0 011.1.5l1.3 1.4a1.5 1.5 0 001.1.5H19.5A1.5 1.5 0 0121 9v8.5A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z"/></svg> ${f.name}</span>
            <span class="folder-chip__count">(${f.count})</span>
          </button>
          ${
            isSecretary
              ? `<button type="button" class="folder-icon-btn" data-rename="${f.id}" aria-label="Rename ${f.name}"><svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20H5.5a1.5 1.5 0 01-1.5-1.5V12"/><path d="M17.4 3.6a2.1 2.1 0 013 3L10 17l-4.5 1.2L6.8 13.7z"/></svg></button>
          <button type="button" class="folder-icon-btn folder-icon-btn--delete" data-delete="${f.id}" aria-label="Delete ${f.name}"><svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2"/><path d="M6.5 7l1 12a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12"/><path d="M10 11v6M14 11v6"/></svg></button>`
              : ""
          }
        </div>`
      )
      .join("");

    foldersList.querySelectorAll(".folder-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeFolderId = btn.dataset.folder;
        allFoldersBtn.classList.remove("active");
        page = 1;
        renderFolders();
        render();
      });
    });
    foldersList.querySelectorAll("[data-rename]").forEach((btn) => {
      btn.addEventListener("click", () => openRenameModal(btn.dataset.rename));
    });
    foldersList.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", () => openDeleteModal(btn.dataset.delete));
    });
  }

  allFoldersBtn.addEventListener("click", () => {
    activeFolderId = null;
    allFoldersBtn.classList.add("active");
    page = 1;
    renderFolders();
    render();
  });

  // ---- Create / rename folder modal ----

  function openCreateModal() {
    folderModalMode = "create";
    folderNameModalTitle.textContent = "Create Category";
    folderNameConfirm.textContent = "Create";
    folderNameInput.value = "";
    folderNameModal.hidden = false;
    folderNameInput.focus();
  }

  function openRenameModal(id) {
    const folder = liveFolders().find((f) => f.id === id);
    if (!folder) return;
    folderModalMode = "rename";
    renameTargetId = id;
    folderNameModalTitle.textContent = "Rename Category";
    folderNameConfirm.textContent = "Rename";
    folderNameInput.value = folder.name;
    folderNameModal.hidden = false;
    folderNameInput.focus();
  }

  addFolderBtn.addEventListener("click", openCreateModal);
  folderNameCancel.addEventListener("click", () => {
    folderNameModal.hidden = true;
  });
  folderNameConfirm.addEventListener("click", async () => {
    const name = folderNameInput.value.trim();
    if (!name) return;

    folderNameConfirm.disabled = true;
    try {
      if (folderModalMode === "create") {
        await createFolder(name);
      } else {
        await renameFolder(renameTargetId, name);
      }
      folderNameModal.hidden = true;
      renderFolders();
      render();
    } catch (err) {
      siteAlert(err.message);
    } finally {
      folderNameConfirm.disabled = false;
    }
  });
  folderNameModal.addEventListener("click", (e) => {
    if (e.target === folderNameModal) folderNameModal.hidden = true;
  });
  folderNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      folderNameConfirm.click();
    }
  });

  // ---- Delete folder modal ----

  function openDeleteModal(id) {
    const folder = liveFolders().find((f) => f.id === id);
    if (!folder) return;
    deleteTargetId = id;
    folderDeleteName.textContent = folder.name;
    folderDeleteModal.hidden = false;
  }

  folderDeleteCancel.addEventListener("click", () => {
    folderDeleteModal.hidden = true;
  });
  folderDeleteConfirm.addEventListener("click", async () => {
    folderDeleteConfirm.disabled = true;
    try {
      await deleteFolder(deleteTargetId);
      if (activeFolderId === deleteTargetId) {
        activeFolderId = null;
        allFoldersBtn.classList.add("active");
      }
      folderDeleteModal.hidden = true;
      renderFolders();
      render();
    } catch (err) {
      siteAlert(err.message);
    } finally {
      folderDeleteConfirm.disabled = false;
    }
  });
  folderDeleteModal.addEventListener("click", (e) => {
    if (e.target === folderDeleteModal) folderDeleteModal.hidden = true;
  });

  // ---- List: search, status filter, folder filter, paginate ----

  function getFiltered() {
    let rows = liveConcerns();
    if (activeFolderId) {
      rows = rows.filter((c) => c.folderId === activeFolderId);
    }
    if (statusFilter.value !== "all") {
      rows = rows.filter((c) => c.status === statusFilter.value);
    }
    if (appliedQuery) {
      rows = rows.filter(
        (c) =>
          c.concernText.toLowerCase().includes(appliedQuery) ||
          (c.location && c.location.toLowerCase().includes(appliedQuery)) ||
          c.reporter.toLowerCase().includes(appliedQuery)
      );
    }
    return rows;
  }

  function render() {
    const rows = getFiltered();
    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    list.innerHTML = pageRows.length
      ? pageRows
          .map(
            (c) => `
        <div class="concern-row">
          <span class="concern-row__title">${truncate(c.concernText, 60)}</span>
          <span class="concern-row__date">${formatConcernDate(c.dateSubmitted)}</span>
          <a class="concern-row__link" href="concern-detail.html?id=${encodeURIComponent(c.id)}">View Details</a>
          <span class="status-badge ${badgeClass[c.status] || ""}">${c.status}</span>
        </div>`
          )
          .join("")
      : `<div class="ordinances-empty">${liveConcerns().length ? "No concerns/suggestions match your search or filters." : "No concerns/suggestions submitted yet."}</div>`;

    renderPaginationControls(pagination, page, totalPages, (n) => {
      page = n;
      render();
    });
  }

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    appliedQuery = searchInput.value.trim().toLowerCase();
    page = 1;
    render();
  });
  statusFilter.addEventListener("change", () => {
    page = 1;
    render();
  });

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
      page = 1;
      render();
    });
  }

  renderFolders();
  render();
});
