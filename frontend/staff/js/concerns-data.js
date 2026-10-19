// concerns-data.js (staff) — loads every concern/suggestion
// (GET /api/concerns/staff/) and the folders they can be filed under
// (/api/concerns/folders/), and saves remarks / folder changes.

const CONCERN_STATUS_TO_LABEL = {
  submitted: "Submitted",
  reviewed: "Reviewed",
};
const CONCERN_LABEL_TO_STATUS = {
  Submitted: "submitted",
  Reviewed: "reviewed",
};

// Submitted before Reviewed, newest first within each.
const CONCERN_STATUS_RANK = {
  Submitted: 0,
  Reviewed: 1,
};

function sortConcernsByStatusThenDate(concerns) {
  return concerns.slice().sort((a, b) => {
    const rankDiff = (CONCERN_STATUS_RANK[a.status] ?? 99) - (CONCERN_STATUS_RANK[b.status] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return b.dateSubmitted - a.dateSubmitted;
  });
}

let _concernsCache = null;
let _foldersCache = null;

function escapeConcernHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function mapConcern(c) {
  return {
    id: c.id,
    location: c.location,
    reporter: c.reporter,
    contactNumber: c.contact_number,
    concernText: c.description,
    status: CONCERN_STATUS_TO_LABEL[c.status] || c.status,
    remarks: c.remarks,
    folderId: c.folder ? c.folder.id : null,
    folderName: c.folder ? c.folder.name : null,
    dateSubmitted: new Date(c.created_at),
    // When the Secretary marked it Reviewed (null while still Submitted).
    dateReviewed: c.reviewed_at ? new Date(c.reviewed_at) : null,
    attachments: c.attachments,
  };
}

async function ensureConcernsLoaded() {
  if (_concernsCache) return _concernsCache;
  const response = await authFetch("/api/concerns/staff/");
  if (!response.ok) throw new Error("Could not load concerns/suggestions.");
  const data = await response.json();
  _concernsCache = sortConcernsByStatusThenDate(data.map(mapConcern));
  return _concernsCache;
}

function liveConcerns() {
  return _concernsCache || [];
}

function getConcernById(id) {
  return (_concernsCache || []).find((c) => c.id === id) || null;
}

async function refreshConcernInCache(id) {
  const response = await authFetch(`/api/concerns/staff/${encodeURIComponent(id)}/`);
  if (!response.ok) throw new Error("Could not reload this concern/suggestion.");
  const updated = mapConcern(await response.json());
  if (_concernsCache) {
    const idx = _concernsCache.findIndex((c) => c.id === id);
    if (idx !== -1) _concernsCache[idx] = updated;
    _concernsCache = sortConcernsByStatusThenDate(_concernsCache);
  }
  return updated;
}

// patch: { status?: <display label>, remarks?: <string>, folderId?: <uuid|null> }
async function updateConcernStatus(id, patch) {
  const body = {};
  if (patch.status !== undefined) body.status = CONCERN_LABEL_TO_STATUS[patch.status] || patch.status;
  if (patch.remarks !== undefined) body.remarks = patch.remarks;
  if (patch.folderId !== undefined) body.folder = patch.folderId;

  const response = await authFetch(`/api/concerns/staff/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not update this concern/suggestion.");
  }
  return refreshConcernInCache(id);
}

// ---- Folders (create/rename/delete, and assigning a concern to one) ----

function mapFolder(f) {
  return { id: f.id, name: f.name, count: f.count };
}

async function ensureFoldersLoaded() {
  if (_foldersCache) return _foldersCache;
  const response = await authFetch("/api/concerns/folders/");
  if (!response.ok) throw new Error("Could not load folders.");
  const data = await response.json();
  _foldersCache = data.map(mapFolder);
  return _foldersCache;
}

function liveFolders() {
  return _foldersCache || [];
}

async function refreshFolders() {
  _foldersCache = null;
  return ensureFoldersLoaded();
}

async function throwFirstError(response, fallback) {
  const data = await response.json().catch(() => ({}));
  const firstError = Object.values(data)[0];
  throw new Error(Array.isArray(firstError) ? firstError[0] : fallback);
}

async function createFolder(name) {
  const response = await authFetch("/api/concerns/folders/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) await throwFirstError(response, "Could not create this folder.");
  return refreshFolders();
}

async function renameFolder(id, name) {
  const response = await authFetch(`/api/concerns/folders/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) await throwFirstError(response, "Could not rename this folder.");
  return refreshFolders();
}

async function deleteFolder(id) {
  const response = await authFetch(`/api/concerns/folders/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
  if (!response.ok) await throwFirstError(response, "Could not delete this folder.");
  await refreshFolders();
  // Concerns that were in the deleted folder fall back to unfoldered server-side; reflect that locally too.
  if (_concernsCache) {
    _concernsCache.forEach((c) => {
      if (c.folderId === id) {
        c.folderId = null;
        c.folderName = null;
      }
    });
  }
}

async function assignConcernFolder(concernId, folderId) {
  const updated = await updateConcernStatus(concernId, { folderId });
  await refreshFolders();
  return updated;
}

// ---- Date helpers (used by the Concerns/Suggestions dashboard) ----

function formatConcernDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getMonthRange(monthsBack) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return { start, end };
}

// yearsBack counts back from the current year (0 = this year).
function getYearRange(yearsBack) {
  const year = new Date().getFullYear() - yearsBack;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return { start, end, year };
}
