// Barangay Platero OVRMS — Announcements (Secretary / Barangay Captain): post, edit and
// remove barangay-wide announcements. Posting emails every citizen (server-side,
// see announcements/views.py) — editing doesn't; the post date is set by the
// server when it's first saved and an edit leaves it alone.

document.addEventListener("DOMContentLoaded", () => {
  const user = getAdminUser();
  const canManage = !!user && user.role === "staff" && ["Secretary", "Barangay Captain"].includes(user.position);

  const listEl = document.getElementById("announcementsList");
  const newBtn = document.getElementById("newAnnouncementBtn");
  const formModal = document.getElementById("announcementFormModal");
  const form = document.getElementById("announcementForm");
  const titleInput = document.getElementById("announcementTitleInput");
  const descriptionInput = document.getElementById("announcementDescriptionInput");
  const imageInput = document.getElementById("announcementImageInput");
  const saveBtn = document.getElementById("announcementSave");
  const dateNote = document.getElementById("announcementDateNote");
  const deleteModal = document.getElementById("announcementDeleteModal");
  const deleteName = document.getElementById("announcementDeleteName");
  const deleteConfirm = document.getElementById("announcementDeleteConfirm");
  const formTitle = document.getElementById("announcementFormTitle");
  let pendingDeleteId = null;
  let announcements = [];
  // The announcement being edited, or null while posting a new one.
  let editing = null;
  // Editing only: the current picture was taken off without picking another.
  let removeExistingImage = false;

  if (!canManage) newBtn.hidden = true;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  async function readError(response, fallback) {
    const data = await response.json().catch(() => null);
    if (data && typeof data.detail === "string") throw new Error(data.detail);
    if (data) {
      const first = Object.values(data)[0];
      if (Array.isArray(first)) throw new Error(first[0]);
      if (typeof first === "string") throw new Error(first);
    }
    throw new Error(`${fallback} (server responded ${response.status})`);
  }

  async function loadAnnouncements() {
    const response = await authFetch("/api/announcements/staff/");
    if (!response.ok) await readError(response, "Could not load announcements.");
    return response.json();
  }

  function render(items) {
    announcements = items;
    if (!announcements.length) {
      listEl.innerHTML = `<div class="ordinances-empty">No announcements posted yet.</div>`;
      return;
    }
    listEl.innerHTML = announcements
      .map((a) => {
        const date = new Date(a.created_at).toLocaleDateString("en-US", {
          month: "long", day: "numeric", year: "numeric",
        });
        return `
        <div class="announcement-row" data-id="${a.id}">
          ${
            a.image_url
              ? `<img class="announcement-row__image" src="${escapeHtml(a.image_url)}" alt="" />`
              : `<span class="announcement-row__image announcement-row__image--empty" aria-hidden="true"></span>`
          }
          <div class="announcement-row__info">
            <span class="announcement-row__title">${escapeHtml(a.title)}</span>
            <span class="announcement-row__date">${date}${a.posted_by_name ? ` &middot; ${escapeHtml(a.posted_by_name)}` : ""}${a.is_edited ? ` &middot; <em>(edited)</em>` : ""}</span>
          </div>
          ${
            canManage
              ? `<div class="announcement-row__actions">
                  <button type="button" class="btn" data-edit="${a.id}">Edit</button>
                  <button type="button" class="btn btn-danger" data-delete="${a.id}" data-title="${escapeHtml(a.title)}">Delete</button>
                </div>`
              : ""
          }
        </div>`;
      })
      .join("");
  }

  listEl.addEventListener("click", (e) => {
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const announcement = announcements.find((a) => a.id === editBtn.dataset.edit);
      if (announcement) openForm(announcement);
      return;
    }
    const btn = e.target.closest("[data-delete]");
    if (!btn) return;
    pendingDeleteId = btn.dataset.delete;
    deleteName.textContent = btn.dataset.title;
    deleteModal.hidden = false;
  });

  deleteConfirm.addEventListener("click", async () => {
    deleteConfirm.disabled = true;
    try {
      const response = await authFetch(`/api/announcements/staff/${encodeURIComponent(pendingDeleteId)}/`, { method: "DELETE" });
      if (!response.ok && response.status !== 204) await readError(response, "Could not delete this announcement.");
      deleteModal.hidden = true;
      render(await loadAnnouncements());
    } catch (err) {
      siteAlert(err.message);
    } finally {
      deleteConfirm.disabled = false;
    }
  });

  const filePreview = document.getElementById("announcementFilePreview");
  const fileThumb = document.getElementById("announcementFileThumb");
  const fileName = document.getElementById("announcementFileName");
  const fileSize = document.getElementById("announcementFileSize");
  const fileView = document.getElementById("announcementFileView");
  const fileRemove = document.getElementById("announcementFileRemove");
  let pickedUrl = null;

  function clearPickedFile() {
    imageInput.value = "";
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    pickedUrl = null;
    filePreview.hidden = true;
    fileThumb.removeAttribute("src");
    fileView.removeAttribute("href");
  }

  function showPickedFile(file) {
    if (pickedUrl) URL.revokeObjectURL(pickedUrl);
    pickedUrl = URL.createObjectURL(file);
    fileThumb.src = pickedUrl;
    fileName.textContent = file.name;
    fileSize.textContent = `${Math.max(1, Math.round(file.size / 1024))} KB`;
    fileView.href = pickedUrl;
    filePreview.hidden = false;
  }

  // Editing: the picture already on the announcement, shown in the same
  // preview row as a freshly picked file.
  function showExistingImage(url) {
    fileThumb.src = url;
    fileName.textContent = "Current picture";
    fileSize.textContent = "";
    fileView.href = url;
    filePreview.hidden = false;
  }

  imageInput.addEventListener("change", () => {
    if (imageInput.files[0]) showPickedFile(imageInput.files[0]);
    else clearPickedFile();
  });
  fileRemove.addEventListener("click", () => {
    if (editing && editing.image_url) removeExistingImage = true;
    clearPickedFile();
  });

  const exitModal = document.getElementById("announcementExitModal");

  function hasUnsavedAnnouncement() {
    if (editing) {
      return (
        titleInput.value.trim() !== editing.title ||
        descriptionInput.value.trim() !== editing.description ||
        imageInput.files.length > 0 ||
        removeExistingImage
      );
    }
    return titleInput.value.trim() !== "" || descriptionInput.value.trim() !== "" || imageInput.files.length > 0;
  }

  function requestCloseForm() {
    if (!hasUnsavedAnnouncement()) {
      formModal.hidden = true;
      return;
    }
    exitModal.hidden = false;
  }

  document.getElementById("announcementCancel").addEventListener("click", requestCloseForm);
  document.getElementById("announcementX").addEventListener("click", requestCloseForm);
  formModal.addEventListener("click", (e) => {
    if (e.target === formModal) requestCloseForm();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !formModal.hidden && exitModal.hidden) requestCloseForm();
  });
  document.getElementById("announcementExitConfirm").addEventListener("click", () => {
    exitModal.hidden = true;
    formModal.hidden = true;
  });
  document.getElementById("announcementExitStay").addEventListener("click", () => {
    exitModal.hidden = true;
  });

  // With an announcement, opens the same form pre-filled to edit it;
  // without one, a blank form to post a new one.
  function openForm(announcement) {
    editing = announcement || null;
    removeExistingImage = false;
    form.reset();
    clearPickedFile();
    document.getElementById("announcementFormError").hidden = true;
    formTitle.textContent = editing ? "Edit Announcement" : "New Announcement";
    saveBtn.textContent = editing ? "Save" : "Post";
    const formatDate = (value) => new Date(value).toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    });
    if (editing) {
      titleInput.value = editing.title;
      descriptionInput.value = editing.description;
      if (editing.image_url) showExistingImage(editing.image_url);
      dateNote.textContent = `Posted ${formatDate(editing.created_at)}. Saving changes keeps that date and doesn't email citizens again.`;
    } else {
      dateNote.textContent = `This will be posted today (${formatDate(Date.now())}).`;
    }
    formModal.hidden = false;
    titleInput.focus();
  }

  if (newBtn) newBtn.addEventListener("click", () => openForm());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("announcementFormError");
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    if (!title || !description) {
      errorEl.textContent = "Add a title and a description.";
      errorEl.hidden = false;
      return;
    }
    const body = new FormData();
    body.append("title", title);
    body.append("description", description);
    if (imageInput.files[0]) body.append("image", imageInput.files[0]);
    else if (editing && removeExistingImage) body.append("remove_image", "true");

    const wasEditing = !!editing;
    saveBtn.disabled = true;
    saveBtn.textContent = wasEditing ? "Saving..." : "Posting...";
    try {
      const response = wasEditing
        ? await authFetch(`/api/announcements/staff/${encodeURIComponent(editing.id)}/`, { method: "PATCH", body })
        : await authFetch("/api/announcements/staff/", { method: "POST", body });
      if (!response.ok) {
        await readError(response, wasEditing ? "Could not save this announcement." : "Could not post this announcement.");
      }
      formModal.hidden = true;
      render(await loadAnnouncements());
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = wasEditing ? "Save" : "Post";
    }
  });

  loadAnnouncements()
    .then(render)
    .catch((err) => {
      listEl.innerHTML = `<div class="ordinances-empty">${escapeHtml(err.message)}</div>`;
    });
});
