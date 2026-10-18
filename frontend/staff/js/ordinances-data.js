// Barangay Platero OVRMS — Ordinances data, backed by the real API (GET /api/ordinances/,
// AllowAny — guests can browse without an account, but this Staff Portal
// copy always sends the caller's token anyway so Secretary/Admin also see
// archived ordinances; see ensureOrdinancesLoaded). createOrdinance/
// updateOrdinanceById/archiveOrdinanceById/unarchiveOrdinanceById all
// require Secretary/Admin, enforced server-side.

let _ordinancesCache = null;

// Secretary or Admin — mirrors accounts.views.IsDocumentManager, which the
// server actually enforces; this just decides which controls to show.
function isDocumentManager(user) {
  return !!user && (user.role === "admin" || user.position === "Secretary");
}

// Keeps a safety margin under the server's DATA_UPLOAD_MAX_MEMORY_SIZE
// (25MB, see settings.py) so an oversize PDF fails fast with a clear
// message instead of a network round trip that ends in a generic 400.
const MAX_ORDINANCE_PDF_MB = 20;

// What the Secretary sees when an upload fails — never a status code or
// other technical detail. A bad file (wrong type, too large, empty) gets
// the file message; a server/network problem gets the general one.
const ORDINANCE_FILE_ERROR = "Could not upload file, check the file type and file size.";
const ORDINANCE_GENERAL_ERROR = "Could not save the ordinance right now. Please try again in a few minutes.";

// True when the picked file is something the server will accept: a
// non-empty PDF no bigger than MAX_ORDINANCE_PDF_MB.
function isAcceptableOrdinancePdf(file) {
  if (!file) return false;
  const looksLikePdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  return looksLikePdf && file.size > 0 && file.size <= MAX_ORDINANCE_PDF_MB * 1024 * 1024;
}

// Turns a failed create/update response into one of the two messages
// above. Field-validation messages about what was typed (e.g. "Select a
// category from the list.") are kept, since they say what to fix.
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

// authFetch for create/update: a dropped connection rejects with a raw
// browser error ("Failed to fetch"), so that's swapped for the general message.
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

// Shared by refreshOrdinanceInCache/archiveOrdinanceById/unarchiveOrdinanceById —
// all three get back a full ordinance and just need it swapped into the cache.
function applyOrdinanceUpdate(updated) {
  if (_ordinancesCache) {
    const idx = _ordinancesCache.findIndex((o) => o.id === updated.id);
    if (idx !== -1) _ordinancesCache[idx] = updated;
  }
  return updated;
}

// Sent authenticated (unlike the citizen copy of this file) even though GET
// is AllowAny — the backend uses the caller's identity to decide whether
// archived ordinances are included (see OrdinanceListCreateView.get_queryset),
// so an unauthenticated request here would make Staff/Admin lose visibility
// into anything they'd archived.
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

// DRF's own errors — permission denied, request-too-large, throttling,
// malformed multipart — come back as {"detail": "..."} (a string), not the
// {field: ["msg"]} shape field-validation errors use. The old version here
// only ever unwrapped the array shape, so any of those cases silently fell
// through to `fallback` with no indication of what actually went wrong
// (e.g. a PDF over DATA_UPLOAD_MAX_MEMORY_SIZE always read as a generic
// "Could not upload this ordinance."). A non-JSON body (a raw 500 page,
// most likely) still falls back, but now says which HTTP status it was.
async function readFirstError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError)) throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  // The system's own refusals always come back as JSON with a reason (handled
  // above). A 403 with no JSON body was sent by something in front of it —
  // the hosting provider's firewall rejecting the request's contents — so
  // say that, rather than leaving it looking like a permissions problem.
  if (!data && response.status === 403) {
    throw new Error(
      `${fallback} The request was blocked before it reached the system (403) — usually the host's security filter reacting to something in the text or the file.`
    );
  }
  throw new Error(`${fallback} (server responded ${response.status})`);
}

// Fetches the author roster — Upload/Edit Ordinance's Author field is a plain
// text input, but suggests these names via a <datalist> as a typing aid (see
// populateAuthorDatalist). Secretary/Admin only get back active authors
// (whoever's serving right now); an Administrator managing the roster itself
// passes includeInactive to also see term-ended entries (see
// OrdinanceAuthorListCreateView). Nothing here is enforced — an ordinance's
// author never has to match a roster entry (see Ordinance.author's docstring
// on the backend for why: not every ordinance in this repository comes from
// the barangay/city council).
async function fetchOrdinanceAuthors(includeInactive) {
  const query = includeInactive ? "?include_inactive=1" : "";
  const response = await authFetch(`/api/ordinances/authors/${query}`);
  if (!response.ok) throw new Error("Could not load the author list.");
  return response.json();
}

// The active category list (admin-managed — see ordinances/models.py's
// OrdinanceCategory) Upload/Edit Ordinance's Category dropdown is built from.
// Unlike authors, a category IS enforced server-side (see
// OrdinanceCreateSerializer's validate_category), so this returns just the
// plain name strings populateCategorySelect needs.
async function fetchOrdinanceCategories() {
  const response = await authFetch("/api/ordinances/categories/");
  if (!response.ok) throw new Error("Could not load the category list.");
  return (await response.json()).map((c) => c.name);
}

// Fills `datalistEl` with the author roster's names, so a plain text input
// (list="...") suggests them as the Secretary types without forcing an exact
// pick — free text is still accepted either way.
function populateAuthorDatalist(datalistEl, authors) {
  datalistEl.innerHTML = "";
  authors.forEach((a) => {
    const option = document.createElement("option");
    option.value = a.name;
    option.label = a.position_display;
    datalistEl.appendChild(option);
  });
}

// Builds <option>s inside `selectEl` from the category list. Keeps whatever
// was already selected if it's still valid, so re-populating after a refetch
// doesn't clobber a user's choice.
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

// Secretary hides/restores an ordinance on the Citizen portal — see
// OrdinanceArchiveView/OrdinanceUnarchiveView.
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
