// Barangay Platero OVRMS — Ordinance Authors data, backed by GET/POST/PATCH/DELETE
// /api/ordinances/authors/ (Administrator only — see accounts.views.IsAdmin
// and ordinances/views.py's OrdinanceAuthorListCreateView/DetailView). This
// is the roster Upload/Edit Ordinance's Author field suggests from as you
// type (frontend/staff/js/ordinances-data.js's populateAuthorDatalist — the
// field itself stays free text); an Administrator is the one who keeps this
// list current as elections change who holds these seats.

let _ordinanceAuthorsCache = null;

// include_inactive=1 so this management page can also show/reactivate a
// term-ended entry — Upload/Edit Ordinance's own fetch (staff side) never
// passes this, since a new ordinance shouldn't be assignable to someone no
// longer serving.
async function ensureAllOrdinanceAuthorsLoaded() {
  if (_ordinanceAuthorsCache) return _ordinanceAuthorsCache;
  const response = await authFetch("/api/ordinances/authors/?include_inactive=1");
  if (!response.ok) throw new Error("Could not load the author roster.");
  _ordinanceAuthorsCache = await response.json();
  return _ordinanceAuthorsCache;
}

function liveOrdinanceAuthors() {
  return _ordinanceAuthorsCache || [];
}

async function readFirstOrdinanceAuthorError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError)) throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  throw new Error(`${fallback} (server responded ${response.status})`);
}

// fields: { name, position }
async function createOrdinanceAuthor(fields) {
  const response = await authFetch("/api/ordinances/authors/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) await readFirstOrdinanceAuthorError(response, "Could not add this author.");
  const created = await response.json();
  if (_ordinanceAuthorsCache) _ordinanceAuthorsCache.unshift(created);
  return created;
}

// fields: any subset of { name, position, is_active }
async function updateOrdinanceAuthor(id, fields) {
  const response = await authFetch(`/api/ordinances/authors/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) await readFirstOrdinanceAuthorError(response, "Could not update this author.");
  const updated = await response.json();
  if (_ordinanceAuthorsCache) {
    const idx = _ordinanceAuthorsCache.findIndex((a) => a.id === id);
    if (idx !== -1) _ordinanceAuthorsCache[idx] = updated;
  }
  return updated;
}

async function deleteOrdinanceAuthor(id) {
  const response = await authFetch(`/api/ordinances/authors/${encodeURIComponent(id)}/`, { method: "DELETE" });
  if (!response.ok) await readFirstOrdinanceAuthorError(response, "Could not remove this author.");
  if (_ordinanceAuthorsCache) _ordinanceAuthorsCache = _ordinanceAuthorsCache.filter((a) => a.id !== id);
}
