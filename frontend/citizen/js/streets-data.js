// Barangay Platero OVRMS — Street list, backed by the real API (GET
// /api/site/streets/, public) instead of a hardcoded array. An
// Administrator adds/removes streets from the Map Boundary page (click the
// map to place one) — see frontend/admin/js/map-boundary.js.
//
// STREETS stays a plain array of names, the same shape every existing
// Street-combobox call site already expects (Sign Up, File Report, My
// Profile) — it's just populated by ensureStreetsLoaded() now instead of
// being baked in at parse time. Call `await ensureStreetsLoaded()` before
// anything that reads STREETS or calls streetCoordinate()/liveStreets().

let STREETS = [];
let _streetsCache = null;

async function ensureStreetsLoaded() {
  if (_streetsCache) return _streetsCache;
  const response = await fetch("/api/site/streets/");
  if (!response.ok) throw new Error("Could not load streets.");
  _streetsCache = await response.json();
  STREETS = _streetsCache.map((s) => s.name);
  return _streetsCache;
}

// A street's heatmap point — frontend/staff/js/heatmap.js's old
// STREET_COORDINATES[name] lookup, now backed by this same API response
// instead of a second hardcoded list that had to be kept in sync by hand.
function streetCoordinate(name) {
  const match = (_streetsCache || []).find((s) => s.name === name);
  return match ? [match.latitude, match.longitude] : null;
}

function liveStreets() {
  return _streetsCache || [];
}
