// Barangay Platero OVRMS — shared incident heatmap for the staff dashboards.
//
// Renders a real Leaflet + OpenStreetMap map with a heat layer whose
// intensity is the number of reports (or concerns) per point. A report
// filed with the citizen's device location (see file-report.js) is plotted
// at that exact position; everything else — reports where location wasn't
// shared, and all concerns — falls back to its street's centroid in
// street-coordinates.js.
//
// Depends (load order): vendor/leaflet/leaflet.js, vendor/leaflet/leaflet-heat.js,
// js/street-coordinates.js — then this file.

// tile.openstreetmap.org is OSM's own demo server, meant for light,
// occasional use — it actively rate-limits/blocks any third-party app that
// hits it repeatedly (that's what was happening: every tile came back as
// OSM's "Access blocked" 403 image instead of an actual map). CARTO's
// basemaps.cartocdn.com looked like the standard free drop-in, but now
// requires an API key too (tiles came back watermarked "API KEY REQUIRED").
// Esri's ArcGIS World_Light_Gray_Base tiles are still free/keyless for this
// kind of embedding — note the {z}/{y}/{x} order, which is Esri's own tile
// addressing, not a typo of the usual {z}/{x}/{y}.
const HEATMAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const HEATMAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';
// The light gray canvas only has real tiles up to zoom 16 — past that Esri
// serves a "Map data not yet available" placeholder for every tile. Esri's
// World_Street_Map (the same basemap the Admin Portal's Map Boundary page
// uses) goes down to zoom 19 over Platero, so it takes over from 17: the
// quiet gray base while zoomed out, where the heat colours need to stand
// out, and full street detail once zoomed in close.
const HEATMAP_TILE_MAX_ZOOM = 16;
const HEATMAP_DETAIL_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const HEATMAP_DETAIL_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, OpenStreetMap contributors';
const HEATMAP_DETAIL_TILE_MAX_ZOOM = 19;

// Barangay Platero area. The small dashboard card frames the barangay
// outline when there is one, else this fixed view (a 260px card can't
// usefully auto-fit a spread of incidents); the enlarged modal fits to the
// outline plus the actual data.
const HEATMAP_CARD_CENTER = [14.3175, 121.0905];
const HEATMAP_CARD_ZOOM = 14;
// Where the modal centers before its first fitBounds, and where either map
// sits when a period has no incidents at all.
const HEATMAP_FALLBACK_CENTER = [14.3175, 121.0905];
const HEATMAP_FALLBACK_ZOOM = 14;

// Heat gradient aligned with the Low / Moderate / High / Critical legend.
const HEATMAP_GRADIENT = { 0.0: "#4caf50", 0.35: "#f2c94c", 0.65: "#f2994a", 1.0: "#e63946" };

// Point Leaflet's default marker assets at the vendored copies (only matters
// if a plain marker is ever added, but sets the expectation up front).
if (window.L && L.Icon && L.Icon.Default) {
  L.Icon.Default.imagePath = "vendor/leaflet/images/";
}

// Groups reports/concerns by where they happened for the given list.
// Returns { key: { count, label, street, ordinances: { "<ordinance>": n } } }, e.g.
// { "Ferrari Street": {...}, "@14.31234,121.08765": {...} } — an "@" key is
// an exact device position (rounded to ~1m so repeat filings from the same
// spot stack), used whenever the item carries one; anything else groups by
// its street. `ordinances` feeds the hover tooltip (see render below).
function countByLocation(items) {
  const groups = {};
  items.forEach((it) => {
    const hasCoords = typeof it.latitude === "number" && typeof it.longitude === "number";
    const location = (it.location || "").trim();
    const key = hasCoords ? `@${it.latitude.toFixed(5)},${it.longitude.toFixed(5)}` : location;
    if (!key) return;
    if (!groups[key]) {
      const street = streetOf(location) || location;
      groups[key] = { count: 0, label: hasCoords ? `${street} (pinned location)` : street, street, ordinances: {} };
    }
    const g = groups[key];
    g.count += 1;
    const ordinance = (it.ordinance || "").trim();
    if (ordinance) g.ordinances[ordinance] = (g.ordinances[ordinance] || 0) + 1;
  });
  return groups;
}

// The known street a "Block X, Lot Y, <Street>" location ends in, or null.
// Callers must await ensureStreetsLoaded() first (see street-coordinates.js).
function streetOf(locationName) {
  const names = liveStreets().map((s) => s.name);
  if (names.includes(locationName)) return locationName;
  return names.find((street) => locationName.endsWith(`, ${street}`)) || null;
}

function escapeHeatmapHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Tooltip body for one heat spot: where it is, then each ordinance
// violated there with how many reports cited it, most-cited first. The
// small dashboard card (overflow-clipped, ~260px tall) only gets the
// one-line summary; its breakdown lives in the enlarged map.
const HEATMAP_TOOLTIP_MAX_ROWS = 8;
function heatmapTooltipHtml(group, compact) {
  if (compact) {
    return `
      <div class="heatmap-tip__title">${escapeHeatmapHtml(group.label)}</div>
      <div class="heatmap-tip__total">${group.count} report${group.count === 1 ? "" : "s"}</div>
      <div class="heatmap-tip__hint">Click to open the full analysis</div>
    `;
  }
  const rows = Object.entries(group.ordinances || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const shown = rows.slice(0, HEATMAP_TOOLTIP_MAX_ROWS);
  const more = rows.length - shown.length;
  return `
    <div class="heatmap-tip__title">${escapeHeatmapHtml(group.label)}</div>
    <div class="heatmap-tip__total">${group.count} report${group.count === 1 ? "" : "s"}</div>
    ${shown.length ? `<ul class="heatmap-tip__list">${shown
      .map(([name, n]) => `<li><span>${escapeHeatmapHtml(name)}</span><b>${n}</b></li>`)
      .join("")}</ul>` : ""}
    ${more > 0 ? `<div class="heatmap-tip__more">+ ${more} more ordinance${more === 1 ? "" : "s"}</div>` : ""}
  `;
}

// Report.location is "Block X, Lot Y, <Street>" (see file-report.js's
// Block/Lot field) instead of just the street name, so a plain
// streetCoordinate(name) lookup on the whole string wouldn't match. Falls
// back to whichever known street the location ends with, on a ", "
// boundary so "Blueberry Street" can't accidentally match something like
// "New Blueberry Street".
function resolveStreetCoord(locationName) {
  if (locationName.startsWith("@")) {
    const [lat, lng] = locationName.slice(1).split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  const street = streetOf(locationName);
  return street ? streetCoordinate(street) : null;
}

// The barangay outline (siteinfo's BarangayProfile.boundary, drawn/uploaded
// by an Administrator on the Map Boundary page) — fetched once per page and
// shared by the card and modal maps. Resolves to [] if there isn't one or
// the request fails; the heatmap works fine without it.
let _boundaryPromise = null;
function loadBarangayBoundary() {
  if (!_boundaryPromise) {
    _boundaryPromise = fetch("/api/site/boundary/")
      .then((res) => (res.ok ? res.json() : { boundary: [] }))
      .then((data) => (Array.isArray(data.boundary) ? data.boundary : []))
      .catch(() => []);
  }
  return _boundaryPromise;
}

const HEATMAP_BOUNDARY_STYLE = {
  color: "#057a12",
  weight: 2,
  dashArray: "6 5",
  fillColor: "#057a12",
  fillOpacity: 0.05,
  interactive: false,
};

// Creates a heatmap bound to `el` (a .heatmap-canvas div). Returns a small
// handle: { render(counts), invalidate(), map }.
//
// opts.interactive === false (default for the small dashboard card) gives a
// static map — no drag/zoom/scroll — so the card as a whole stays a
// click-to-enlarge target. The enlarged modal map passes interactive: true.
//
// opts.onSelect(key, group) — called when a heat spot is clicked (the
// geospatial analysis panel uses it to open that street's profile).
function createIncidentHeatmap(el, opts = {}) {
  const interactive = opts.interactive === true;
  const emptyMessage = opts.emptyMessage || "No incidents in this period";
  const onSelect = typeof opts.onSelect === "function" ? opts.onSelect : null;

  const map = L.map(el, {
    zoomControl: interactive,
    scrollWheelZoom: interactive,
    dragging: interactive,
    doubleClickZoom: interactive,
    boxZoom: interactive,
    keyboard: interactive,
    touchZoom: interactive,
    tap: false,
  });
  map.attributionControl.setPrefix("");

  L.tileLayer(HEATMAP_TILE_URL, {
    maxZoom: HEATMAP_TILE_MAX_ZOOM,
    attribution: HEATMAP_TILE_ATTRIBUTION,
  }).addTo(map);
  L.tileLayer(HEATMAP_DETAIL_TILE_URL, {
    minZoom: HEATMAP_TILE_MAX_ZOOM + 1,
    maxZoom: HEATMAP_DETAIL_TILE_MAX_ZOOM,
    attribution: HEATMAP_DETAIL_TILE_ATTRIBUTION,
  }).addTo(map);

  map.setView(HEATMAP_FALLBACK_CENTER, HEATMAP_FALLBACK_ZOOM);

  let heatLayer = null;
  let fittedOnce = false;
  let lastBounds = null;
  let boundaryBounds = null;

  loadBarangayBoundary().then((points) => {
    if (points.length < 3) return;
    const outline = L.polygon(points, HEATMAP_BOUNDARY_STYLE).addTo(map);
    outline.bringToBack();
    boundaryBounds = outline.getBounds().pad(0.08);
    // The card frames the barangay; the modal only reframes here if it has
    // no incidents yet (otherwise it keeps a staffer's pan/zoom).
    if (!interactive || !lastBounds) fit();
  });

  function setOverlay(message) {
    let overlay = el.querySelector(".heatmap-canvas__empty");
    if (message) {
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "heatmap-canvas__empty";
        el.appendChild(overlay);
      }
      overlay.textContent = message;
    } else if (overlay) {
      overlay.remove();
    }
  }

  // Invisible circles over each heat spot — leaflet.heat draws to a plain
  // canvas with no per-point events, so these are what actually catch the
  // hover and show the spot's ordinance breakdown.
  const hoverLayer = L.layerGroup().addTo(map);

  // groups: see countByLocation (a bare number per key also works, for a
  // count-only map). Unknown street names (not in street-coordinates.js)
  // are returned so the caller can surface them.
  function render(groups) {
    const points = [];
    const unmapped = [];
    let max = 0;
    hoverLayer.clearLayers();

    Object.entries(groups).forEach(([name, value]) => {
      const group = typeof value === "number" ? { count: value, label: name, ordinances: {} } : value;
      const count = group.count;
      if (!count) return;
      const coord = resolveStreetCoord(name);
      if (!coord) {
        unmapped.push(name);
        return;
      }
      points.push([coord[0], coord[1], count]);
      if (count > max) max = count;

      const spot = L.circleMarker(coord, {
        radius: interactive ? 20 : 14,
        stroke: true,
        color: "#1f2430",
        weight: 0,
        opacity: 0.6,
        fill: true,
        fillOpacity: 0,
      });
      spot.bindTooltip(heatmapTooltipHtml(group, !interactive), {
        direction: "top",
        offset: [0, interactive ? -16 : -10],
        className: "heatmap-tip",
      });
      // A faint ring shows which spot the tooltip belongs to when two are close.
      spot.on("mouseover", () => spot.setStyle({ weight: 1.5 }));
      spot.on("mouseout", () => spot.setStyle({ weight: 0 }));
      if (onSelect) spot.on("click", () => onSelect(name, group));
      hoverLayer.addLayer(spot);
    });

    if (heatLayer) {
      heatLayer.remove();
      heatLayer = null;
    }

    if (!points.length) {
      setOverlay(emptyMessage);
      lastBounds = null;
      return unmapped;
    }
    setOverlay(null);
    lastBounds = L.latLngBounds(points.map((p) => [p[0], p[1]])).pad(0.25);

    heatLayer = L.heatLayer(points, {
      radius: interactive ? 45 : 30,
      blur: interactive ? 28 : 20,
      minOpacity: 0.45,
      // Intensity saturates at neighborhood zoom rather than street zoom, so
      // the blobs stay readable when the map is fitted to the whole barangay.
      maxZoom: 15,
      // Floor the top-of-gradient count so a light week (max 1-2 reports on a
      // street) still shows warm colour instead of faint green everywhere.
      max: Math.max(4, max),
      gradient: HEATMAP_GRADIENT,
    }).addTo(map);

    // The static card has no pan/zoom to preserve, so always reframe it to
    // the current period. The interactive modal is reframed only on open
    // (see openHeatmapModal) so a staffer's manual pan/zoom survives a
    // period change.
    if (!interactive || !fittedOnce) {
      fit();
      fittedOnce = true;
    }
    return unmapped;
  }

  // Frame the current incident spread. The card keeps its fixed framing
  // (see HEATMAP_CARD_*); only the interactive modal fits to the data, and
  // only when called after its container is visible (fitBounds needs real
  // container dimensions).
  function fit() {
    if (!interactive) {
      if (boundaryBounds) map.fitBounds(boundaryBounds, { animate: false });
      else map.setView(HEATMAP_CARD_CENTER, HEATMAP_CARD_ZOOM, { animate: false });
      return;
    }
    // Frame the whole barangay plus any spots that fall outside it.
    const bounds = boundaryBounds && lastBounds
      ? L.latLngBounds(boundaryBounds.getSouthWest(), boundaryBounds.getNorthEast()).extend(lastBounds)
      : boundaryBounds || lastBounds;
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { maxZoom: 16, animate: false });
    }
  }

  function invalidate() {
    map.invalidateSize();
  }

  // Rings the given street (or "@lat,lng" key) and brings it into view at
  // street level; null clears the ring. Used for the street selected in the
  // geospatial analysis panel.
  let highlightRing = null;
  function highlight(name) {
    if (highlightRing) {
      highlightRing.remove();
      highlightRing = null;
    }
    const coord = name ? resolveStreetCoord(name) : null;
    if (!coord) return;
    highlightRing = L.circleMarker(coord, {
      radius: 26,
      color: "#1f2430",
      weight: 3,
      dashArray: "5 5",
      fill: false,
      interactive: false,
    }).addTo(map);
    map.setView(coord, Math.max(map.getZoom(), 16), { animate: true });
  }

  return { map, render, invalidate, fit, highlight };
}
