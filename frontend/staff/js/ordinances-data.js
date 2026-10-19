// ordinances-data.js (staff) — loads all ordinances (archived ones too) and
// uploads, edits, archives and unarchives them. Changing ordinances needs
// the Secretary or an Administrator (checked by the server).

let _ordinancesCache = null;

// Secretary or Administrator (the server checks this too; here it only decides which buttons show).
function isDocumentManager(user) {
  return !!user && (user.role === "admin" || user.position === "Secretary");
}

// Checked before uploading, below the server's 25 MB request limit.
const MAX_ORDINANCE_PDF_MB = 20;

// Upload error messages: one for a bad file, one for server/network problems.
const ORDINANCE_FILE_ERROR = "Could not upload file, check the file type and file size.";
const ORDINANCE_GENERAL_ERROR = "Could not save the ordinance right now. Please try again in a few minutes.";

// True for a non-empty PDF no bigger than MAX_ORDINANCE_PDF_MB.
function isAcceptableOrdinancePdf(file) {
  if (!file) return false;
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return looksLikePdf && file.size > 0 && file.size <= MAX_ORDINANCE_PDF_MB * 1024 * 1024;
}

// Turns a failed upload/edit answer into one of the two messages above
// (messages about a typed field, e.g. "Select a category from the list.", are kept).
async function throwOrdinanceSaveError(response) {
  if (response.status === 413) throw new Error(ORDINANCE_FILE_ERROR);
  const data = await response.json().catch(() => null);
  if (response.status === 400 && data && typeof data === "object") {
    if (data.pdf_file) throw new Error(ORDINANCE_FILE_ERROR);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError) && typeof firstError[0] === "string") throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  throw new Error(ORDINANCE_GENERAL_ERROR);
}

// authFetch that shows the general message instead of "Failed to fetch".
async function ordinanceSaveFetch(path, options) {
  try {
    return await authFetch(path, options);
  } catch {
    throw new Error(ORDINANCE_GENERAL_ERROR);
  }
}

function mapOrdinance(o) {
  const numberMatch = o.number.match(/\d+/);
  return {
    id: o.id,
    number: o.number,
    numberSort: numberMatch ? parseInt(numberMatch[0], 10) : 0,
    title: o.title,
    author: o.author,
    category: o.category,
    dateApproved: new Date(`${o.date_approved}T00:00:00`).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
    dateApprovedRaw: o.date_approved,
    dateSort: o.date_approved,
    description: o.description,
    pdf: o.pdf_url,
    uploadedBy: o.uploaded_by_name,
    isArchived: o.is_archived,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

// Replaces one ordinance in the cache.
function applyOrdinanceUpdate(updated) {
  if (_ordinancesCache) {
    const idx = _ordinancesCache.findIndex((o) => o.id === updated.id);
    if (idx !== -1) _ordinancesCache[idx] = updated;
  }
  return updated;
}

// Sent with the login token so staff also get archived ordinances.
async function ensureOrdinancesLoaded() {
  if (_ordinancesCache) return _ordinancesCache;
  const response = await authFetch("/api/ordinances/");
  if (!response.ok) throw new Error("Could not load ordinances.");
  const data = await response.json();
  _ordinancesCache = data.map(mapOrdinance);
  return _ordinancesCache;
}

function liveOrdinances() {
  return _ordinancesCache || [];
}

function getOrdinanceById(id) {
  return (_ordinancesCache || []).find((o) => o.id === id) || null;
}

async function refreshOrdinanceInCache(id) {
  const response = await authFetch(`/api/ordinances/${encodeURIComponent(id)}/`);
  if (!response.ok) throw new Error("Could not reload this ordinance.");
  return applyOrdinanceUpdate(mapOrdinance(await response.json()));
}

// Throws the server's message: {detail: "..."} or the first field error;
// otherwise `fallback` with the HTTP status.
async function readFirstError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError)) throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  // A 403 without JSON comes from the hosting firewall, not from the system.
  if (!data && response.status === 403) {
    throw new Error(
      `${fallback} The request was blocked before it reached the system (403) — usually the host's security filter reacting to something in the text or the file.`
    );
  }
  throw new Error(`${fallback} (server responded ${response.status})`);
}

// The author list (suggestions for the Author field; any name is still allowed).
// includeInactive (Administrators only) also returns officials whose term ended.
async function fetchOrdinanceAuthors(includeInactive) {
  const query = includeInactive ? "?include_inactive=1" : "";
  const response = await authFetch(`/api/ordinances/authors/${query}`);
  if (!response.ok) throw new Error("Could not load the author list.");
  return response.json();
}

// The active category names (the Category field must be one of these).
async function fetchOrdinanceCategories() {
  const response = await authFetch("/api/ordinances/categories/");
  if (!response.ok) throw new Error("Could not load the category list.");
  return (await response.json()).map((c) => c.name);
}

// Puts the author names into a <datalist> (suggestions for a text input).
function populateAuthorDatalist(datalistEl, authors) {
  datalistEl.innerHTML = "";
  authors.forEach((a) => {
    const option = document.createElement("option");
    option.value = a.name;
    option.label = a.position_display;
    datalistEl.appendChild(option);
  });
}

// Fills a <select> with the categories, keeping the current choice if still valid.
function populateCategorySelect(selectEl, categories) {
  const previous = selectEl.value;
  selectEl.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.textContent = "Select category";
  selectEl.appendChild(placeholder);

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    selectEl.appendChild(option);
  });

  selectEl.value = categories.includes(previous) ? previous : "";
}

// fields: { number, title, author, category, dateApproved (YYYY-MM-DD),
// description, pdfFile }
async function createOrdinance(fields) {
  const formData = new FormData();
  formData.append("number", fields.number);
  formData.append("title", fields.title);
  formData.append("author", fields.author);
  formData.append("category", fields.category);
  formData.append("date_approved", fields.dateApproved);
  formData.append("description", fields.description);
  formData.append("pdf_file", fields.pdfFile);

  const response = await ordinanceSaveFetch("/api/ordinances/", { method: "POST", body: formData });
  if (!response.ok) await throwOrdinanceSaveError(response);
  const created = mapOrdinance(await response.json());
  if (_ordinancesCache) _ordinancesCache.unshift(created);
  return created;
}

// Same field shape as createOrdinance, but pdfFile is optional — omit it to keep the existing PDF.
async function updateOrdinanceById(id, fields) {
  const formData = new FormData();
  if (fields.number !== undefined) formData.append("number", fields.number);
  if (fields.title !== undefined) formData.append("title", fields.title);
  if (fields.author !== undefined) formData.append("author", fields.author);
  if (fields.category !== undefined) formData.append("category", fields.category);
  if (fields.dateApproved !== undefined) formData.append("date_approved", fields.dateApproved);
  if (fields.description !== undefined) formData.append("description", fields.description);
  if (fields.pdfFile) formData.append("pdf_file", fields.pdfFile);

  const response = await ordinanceSaveFetch(`/api/ordinances/${encodeURIComponent(id)}/`, { method: "PATCH", body: formData });
  if (!response.ok) await throwOrdinanceSaveError(response);
  return refreshOrdinanceInCache(id);
}

// Hide an ordinance from citizens / show it again.
async function archiveOrdinanceById(id) {
  const response = await authFetch(`/api/ordinances/${encodeURIComponent(id)}/archive/`, { method: "POST" });
  if (!response.ok) await readFirstError(response, "Could not archive this ordinance.");
  return applyOrdinanceUpdate(mapOrdinance(await response.json()));
}

async function unarchiveOrdinanceById(id) {
  const response = await authFetch(`/api/ordinances/${encodeURIComponent(id)}/unarchive/`, { method: "POST" });
  if (!response.ok) await readFirstError(response, "Could not unarchive this ordinance.");
  return applyOrdinanceUpdate(mapOrdinance(await response.json()));
}
