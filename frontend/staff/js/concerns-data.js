// Barangay Platero OVRMS — Concerns/Suggestions data, backed by the real API
// (GET /api/concerns/staff/). Status/remarks work the same way as Reports
// (Submitted/Reviewed + free-text remarks). Folders are a separate,
// orthogonal categorization staff assign after the fact — backed by
// /api/concerns/folders/ — used to group concerns for the (future)
// category breakdown, the same role Report.ordinance plays for Reports.

const CONCERN_STATUS_TO_LABEL = {
  submitted: "Submitted",
  reviewed: "Reviewed",
};
const CONCERN_LABEL_TO_STATUS = {
  Submitted: "submitted",
  Reviewed: "reviewed",
};

// Newest-first within each status, Submitted before Reviewed — same idea as
// reports-data.js's REPORT_STATUS_RANK, just with Concern's 2-stage status.
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

// ---- Date helpers (small local copies — see reports-data.js for the
// Reports Dashboard's equivalents; kept separate so the two pages don't
// have to load each other's dataset). ----

function formatConcernDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const THIS_WEEK_START = startOfWeek(new Date());

function getWeekRange(offset) {
  const start = addDays(THIS_WEEK_START, -7 * offset);
  const end = addDays(start, 6);
  return { start, end, label: `${formatConcernDate(start)} - ${formatConcernDate(end)}` };
}

function getMonthRange(monthsBack) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return { start, end };
}

// quartersBack counts back from the current quarter (0 = this quarter).
function getQuarterRange(quartersBack) {
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3);
  const totalQuarters = now.getFullYear() * 4 + currentQuarter - quartersBack;
  const year = Math.floor(totalQuarters / 4);
  const quarter = totalQuarters % 4;
  const start = new Date(year, quarter * 3, 1);
  const end = new Date(year, quarter * 3 + 3, 0);
  return { start, end, quarter: quarter + 1, year };
}

// yearsBack counts back from the current year (0 = this year).
function getYearRange(yearsBack) {
  const year = new Date().getFullYear() - yearsBack;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return { start, end, year };
}

function getConcernsForWeekOffset(offset) {
  const { start, end } = getWeekRange(offset);
  const endDate = endOfDay(end);
  return liveConcerns().filter((c) => c.dateSubmitted >= start && c.dateSubmitted <= endDate);
}

function getConcernsForPeriod(periodValue) {
  if (periodValue === "all") return liveConcerns();
  if (periodValue === "week") return getConcernsForWeekOffset(0);
  if (periodValue.startsWith("week")) return getConcernsForWeekOffset(Number(periodValue.slice(4)));
  const monthsBack = Number(periodValue.replace("month", ""));
  const { start, end } = getMonthRange(monthsBack);
  const endDate = endOfDay(end);
  return liveConcerns().filter((c) => c.dateSubmitted >= start && c.dateSubmitted <= endDate);
}
