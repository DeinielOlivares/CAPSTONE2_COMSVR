// Barangay Platero OVRMS — Ordinance Categories data, backed by GET/POST/PATCH/DELETE
// /api/ordinances/categories/ (Administrator only for writes — see
// accounts.views.IsAdmin and ordinances/views.py's
// OrdinanceCategoryListCreateView/DetailView). This is the list Upload/Edit
// Ordinance's Category dropdown is built from (frontend/staff/js/
// ordinances-data.js's populateCategorySelect); unlike the author roster, an
// ordinance's category must be one of these — see OrdinanceCategory's
// docstring for why.

let _ordinanceCategoriesCache = null;

// include_inactive=1 so this management page can also show/reactivate a
// retired category — Upload/Edit Ordinance's own fetch (staff side) never
// passes this, since a new ordinance shouldn't be filed under a retired one.
async function ensureAllOrdinanceCategoriesLoaded() {
  if (_ordinanceCategoriesCache) return _ordinanceCategoriesCache;
  const response = await authFetch("/api/ordinances/categories/?include_inactive=1");
  if (!response.ok) throw new Error("Could not load the category list.");
  _ordinanceCategoriesCache = await response.json();
  return _ordinanceCategoriesCache;
}

function liveOrdinanceCategories() {
  return _ordinanceCategoriesCache || [];
}

async function readFirstOrdinanceCategoryError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError)) throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  throw new Error(`${fallback} (server responded ${response.status})`);
}

// fields: { name }
async function createOrdinanceCategory(fields) {
  const response = await authFetch("/api/ordinances/categories/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) await readFirstOrdinanceCategoryError(response, "Could not add this category.");
  const created = await response.json();
  if (_ordinanceCategoriesCache) _ordinanceCategoriesCache.unshift(created);
  return created;
}

// fields: any subset of { name, is_active }
async function updateOrdinanceCategory(id, fields) {
  const response = await authFetch(`/api/ordinances/categories/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
  if (!response.ok) await readFirstOrdinanceCategoryError(response, "Could not update this category.");
  const updated = await response.json();
  if (_ordinanceCategoriesCache) {
    const idx = _ordinanceCategoriesCache.findIndex((c) => c.id === id);
    if (idx !== -1) _ordinanceCategoriesCache[idx] = updated;
  }
  return updated;
}

async function deleteOrdinanceCategory(id) {
  const response = await authFetch(`/api/ordinances/categories/${encodeURIComponent(id)}/`, { method: "DELETE" });
  if (!response.ok) await readFirstOrdinanceCategoryError(response, "Could not remove this category.");
  if (_ordinanceCategoriesCache) _ordinanceCategoriesCache = _ordinanceCategoriesCache.filter((c) => c.id !== id);
}
