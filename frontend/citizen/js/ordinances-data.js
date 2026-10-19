// Barangay Platero OVRMS — Ordinances data, backed by the real API (GET /api/ordinances/,
// public — guests can browse without an account). Replaces the old
// hardcoded placeholder array. createOrdinance/updateOrdinanceById require
// Staff/Admin (enforced server-side) — harmless to load on every portal,
// same as this file being kept identical across citizen/staff.

let _ordinancesCache = null;

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
    createdAt: o.created_at,
    updatedAt: o.updated_at,
  };
}

async function ensureOrdinancesLoaded() {
  if (_ordinancesCache) return _ordinancesCache;
  const response = await fetch("/api/ordinances/");
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
  const response = await fetch(`/api/ordinances/${encodeURIComponent(id)}/`);
  if (!response.ok) throw new Error("Could not reload this ordinance.");
  const updated = mapOrdinance(await response.json());
  if (_ordinancesCache) {
    const idx = _ordinancesCache.findIndex((o) => o.id === id);
    if (idx !== -1) _ordinancesCache[idx] = updated;
  }
  return updated;
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
  throw new Error(`${fallback} (server responded ${response.status})`);
}

// fields: { number, title, author, category, dateApproved (YYYY-MM-DD), description, pdfFile }
async function createOrdinance(fields) {
  const formData = new FormData();
  formData.append("number", fields.number);
  formData.append("title", fields.title);
  formData.append("author", fields.author);
  formData.append("category", fields.category);
  formData.append("date_approved", fields.dateApproved);
  formData.append("description", fields.description);
  formData.append("pdf_file", fields.pdfFile);

  const response = await authFetch("/api/ordinances/", { method: "POST", body: formData });
  if (!response.ok) await readFirstError(response, "Could not upload this ordinance.");
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

  const response = await authFetch(`/api/ordinances/${encodeURIComponent(id)}/`, { method: "PATCH", body: formData });
  if (!response.ok) await readFirstError(response, "Could not update this ordinance.");
  return refreshOrdinanceInCache(id);
}
