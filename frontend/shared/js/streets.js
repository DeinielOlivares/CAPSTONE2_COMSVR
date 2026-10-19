// streets.js — the barangay's streets, loaded from GET /api/site/streets/.
// Administrators add/remove streets on Admin > Map Boundary.
//
// Call `await ensureStreetsLoaded()` before using STREETS (a list of names),
// streetCoordinate() or liveStreets().

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

// A street's [lat, lng] point on the map, or null.
function streetCoordinate(name) {
  const match = (_streetsCache || []).find((s) => s.name === name);
  return match ? [match.latitude, match.longitude] : null;
}

// Every street with its point: [{id, name, latitude, longitude}, ...]
function liveStreets() {
  return _streetsCache || [];
}

// Turns a text input into a street picker: typing filters the list shown
// under it, clicking a street fills the input. With announceChange (default),
// picking a street also fires the input's "input" event.
function wireStreetCombobox(inputId, listId, { announceChange = true } = {}) {
  const streetInput = document.getElementById(inputId);
  const streetList = document.getElementById(listId);
  if (!streetInput || !streetList) return;
  const renderStreetOptions = () => {
    const query = streetInput.value.trim().toLowerCase();
    const matches = query ? STREETS.filter((s) => s.toLowerCase().includes(query)) : STREETS;
    streetList.innerHTML = matches.length
      ? matches.map((s) => `<li data-value="${s}">${s}</li>`).join("")
      : `<li class="combobox__empty">No matching street</li>`;
    streetList.hidden = false;
  };
  streetInput.addEventListener("focus", renderStreetOptions);
  streetInput.addEventListener("input", renderStreetOptions);
  streetList.addEventListener("click", (e) => {
    const option = e.target.closest("li[data-value]");
    if (!option) return;
    streetInput.value = option.dataset.value;
    if (announceChange) streetInput.dispatchEvent(new Event("input", { bubbles: true }));
    streetList.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!streetInput.contains(e.target) && !streetList.contains(e.target)) {
      streetList.hidden = true;
    }
  });
  streetInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") streetList.hidden = true;
  });
}
