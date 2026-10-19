// ordinance-authors-data.js — API calls for the officials list
// (/api/ordinances/authors/), suggested in the Author field when uploading.

let _ordinanceAuthorsCache = null;

// include_inactive=1: this page also lists officials whose term ended.
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
