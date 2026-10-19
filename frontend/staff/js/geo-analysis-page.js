// Geospatial Analysis page (Barangay Captain): the large heatmap beside the
// analysis panel (geo-analysis.js). The period is kept in the address
// (?period=month0 or ?from=YYYY-MM-DD&to=YYYY-MM-DD).

document.addEventListener("DOMContentLoaded", async () => {
  const content = document.querySelector(".admin-content");
  const panelEl = document.getElementById("geoPanel");
  const mapEl = document.getElementById("geoMap");
  const periodSelect = document.getElementById("geoPeriodSelect");
  const customRange = document.getElementById("geoCustomRange");
  const customFrom = document.getElementById("geoCustomFrom");
  const customTo = document.getElementById("geoCustomTo");
  const CUSTOM = "custom";

  try {
    await ensureOrdinancesLoaded();
    await ensureReportsLoaded();
  } catch (err) {
    content.innerHTML = `<div class="ordinances-empty">${geoEscape(err.message)}</div>`;
    return;
  }
  // Optional: without streets, reports without a device position can't be placed.
  await ensureStreetsLoaded().catch(() => {});

  // Every ordinance category plus any category found on reports (e.g. "Other").
  const categories = Array.from(
    new Set([...liveOrdinances().map((o) => o.category), ...liveReports().map((r) => r.category)])
  );

  let period = reportPeriodFromQuery(window.location.search) || "week";
  let registeredCitizens = null;

  // If the map can't load, the panel still works.
  let heatmap = null;
  try {
    if (typeof L === "undefined") throw new Error("Leaflet not loaded");
    heatmap = createIncidentHeatmap(mapEl, {
      interactive: true,
      onSelect: (key, group) => geoAnalysis.selectStreet(group.street || group.label),
    });
  } catch (err) {
    console.error("[heatmap] disabled:", err);
    mapEl.classList.remove("heatmap-canvas");
    mapEl.innerHTML = `<div class="ordinances-empty">Map unavailable</div>`;
  }

  // Leaving a street's profile zooms the map back out to the whole barangay.
  let shownStreet = null;
  const geoAnalysis = createGeoAnalysis(panelEl, {
    categories,
    onChange: ({ reports, street }) => {
      if (!heatmap) return;
      heatmap.render(countByLocation(reports));
      heatmap.highlight(street);
      if (shownStreet && !street) heatmap.fit();
      shownStreet = street;
    },
  });

  function update() {
    const prevPeriod = previousReportPeriod(period);
    geoAnalysis.update({
      reports: getReportsForPeriod(period),
      prevReports: prevPeriod ? getReportsForPeriod(prevPeriod) : null,
      registeredCitizens,
    });
  }

  function setPeriod(next) {
    period = next;
    history.replaceState(null, "", `${window.location.pathname}?${reportPeriodToQuery(period)}`);
    update();
  }

  // ---- Period controls ----

  const toDateInputValue = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  periodSelect.innerHTML =
    buildReportPeriodOptions()
      .map((o) => `<option value="${o.value}">${geoEscape(o.label)}</option>`)
      .join("") + `<option value="${CUSTOM}">Custom range…</option>`;

  const isCustom = typeof period === "object";
  periodSelect.value = isCustom ? CUSTOM : period;
  customRange.hidden = !isCustom;
  customFrom.value = isCustom ? period.from : toDateInputValue(getWeekRange(0).start);
  customTo.value = isCustom ? period.to : toDateInputValue(getWeekRange(0).end);

  periodSelect.addEventListener("change", () => {
    customRange.hidden = periodSelect.value !== CUSTOM;
    // A custom range only takes effect once Apply is pressed.
    if (periodSelect.value !== CUSTOM) setPeriod(periodSelect.value);
  });

  document.getElementById("geoCustomApply").addEventListener("click", () => {
    const from = customFrom.value;
    const to = customTo.value;
    if (!from || !to || from > to) {
      siteAlert("Choose a valid date range (From must be on or before To).");
      return;
    }
    setPeriod({ type: "custom", from, to });
  });

  // ---- First paint ----

  loadRegisteredCitizenCount().then((count) => {
    registeredCitizens = count;
    update();
  });

  if (heatmap) window.addEventListener("resize", () => heatmap.invalidate());

  // Wait two frames so the map container has its size.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (heatmap) heatmap.invalidate();
      update();
      if (heatmap) heatmap.fit();
    })
  );
});
