// ordinances-data.js (citizen) — loads the published ordinances from
// GET /api/ordinances/ (no login needed) and keeps them in memory.

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
