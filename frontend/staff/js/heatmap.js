// heatmap.js — the incident heatmap on the staff dashboards (Leaflet map +
// heat layer; hotter = more reports). A report filed with the device's
// location is drawn there; otherwise at its street's point (streets.js).
// Load after /shared/vendor/leaflet/leaflet.js, leaflet-heat.js and /shared/js/streets.js.

// Map tiles: Esri's free light-gray base map (no API key needed).
// Note Esri's {z}/{y}/{x} order (not {z}/{x}/{y}).
const HEATMAP_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const HEATMAP_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ';
// The gray map only goes to zoom 16; from zoom 17 Esri's street map is used.
const HEATMAP_TILE_MAX_ZOOM = 16;
const HEATMAP_DETAIL_TILE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
const HEATMAP_DETAIL_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, OpenStreetMap contributors';
const HEATMAP_DETAIL_TILE_MAX_ZOOM = 19;

// The small dashboard card shows the barangay outline (or this fixed view);
// the enlarged map fits the outline plus the incidents.
const HEATMAP_CARD_CENTER = [14.3175, 121.0905];
const HEATMAP_CARD_ZOOM = 14;
// Starting view, and the view when there are no incidents.
const HEATMAP_FALLBACK_CENTER = [14.3175, 121.0905];
const HEATMAP_FALLBACK_ZOOM = 14;

// Heat gradient aligned with the Low / Moderate / High / Critical legend.
const HEATMAP_GRADIENT = { 0.0: "#4caf50", 0.35: "#f2c94c", 0.65: "#f2994a", 1.0: "#e63946" };

// Where Leaflet finds its default marker images.
if (window.L && L.Icon && L.Icon.Default) {
  L.Icon.Default.imagePath = "/shared/vendor/leaflet/images/";
}

// Groups items by place: { key: { count, label, street, ordinances: {name: n} } }.
// The key is the street name, or "@lat,lng" for a device position (rounded to ~1 m).
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
// Call ensureStreetsLoaded() first.
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

// Tooltip for one spot: the place, the number of reports and (on the large
// map) the ordinances cited there, most-cited first.
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

// [lat, lng] for a group key: the "@lat,lng" itself, or the point of the
// street the location ends with. null if unknown.
function resolveStreetCoord(locationName) {
  if (locationName.startsWith("@")) {
    const [lat, lng] = locationName.slice(1).split(",").map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
  }
  const street = streetOf(locationName);
  return street ? streetCoordinate(street) : null;
}

// The barangay outline (set on Admin > Map Boundary), loaded once per page.
// [] if there is none.
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

// Creates a heatmap in `el` (a .heatmap-canvas div).
// Returns { map, render(groups), invalidate(), fit(), highlight(key) }.
//   opts.interactive  true = drag/zoom allowed (the large map); false = static card
//   opts.onSelect(key, group)  called when a spot is clicked
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
    // Reframe the card; the large map only if it has no incidents yet.
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

  // Invisible circles over each spot catch the mouse (the heat layer itself can't).
  const hoverLayer = L.layerGroup().addTo(map);

  // Draws `groups` (see countByLocation; a plain number per key also works).
  // Returns the keys whose place is unknown.
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
      // Full intensity is reached at neighborhood zoom.
      maxZoom: 15,
      // At least 4, so a quiet period still shows warm colors.
      max: Math.max(4, max),
      gradient: HEATMAP_GRADIENT,
    }).addTo(map);

    // Always reframe the card; the large map only the first time (keeps the user's pan/zoom).
    if (!interactive || !fittedOnce) {
      fit();
      fittedOnce = true;
    }
    return unmapped;
  }

  // Frames the view (the large map must be visible when this is called).
  function fit() {
    if (!interactive) {
      if (boundaryBounds) map.fitBounds(boundaryBounds, { animate: false });
      else map.setView(HEATMAP_CARD_CENTER, HEATMAP_CARD_ZOOM, { animate: false });
      return;
    }
    // The whole barangay plus any spots outside it.
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

  // Circles a street (or "@lat,lng") and zooms to it; null removes the circle.
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
