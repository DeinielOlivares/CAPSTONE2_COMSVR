// Barangay Platero OVRMS — Geospatial Analysis page (Barangay Captain): the incident
// heatmap at full size beside the analysis panel from geo-analysis.js.
// Opened from the Reports Dashboard's heatmap card, which passes its period
// along in the address (?period=month0, or ?from=YYYY-MM-DD&to=YYYY-MM-DD) —
// changing the period here keeps the address in step, so the page can be
// bookmarked or refreshed without losing it.

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
  // Best-effort — the heatmap/analysis just can't place a street-only
  // report precisely if this fails, not worth failing the whole page over.
  await ensureStreetsLoaded().catch(() => {});

  // Every category a real ordinance defines, plus whatever a report's own
  // category is (e.g. "Other" for an ordinance that no longer matches) —
  // same list the dashboard's pie uses.
  const categories = Array.from(
    new Set([...liveOrdinances().map((o) => o.category), ...liveReports().map((r) => r.category)])
  );

  let period = reportPeriodFromQuery(window.location.search) || "week";
  let registeredCitizens = null;

  // A failed map init (Leaflet or the tile host unreachable) leaves the
  // panel working on its own.
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

  const geoAnalysis = createGeoAnalysis(panelEl, {
    categories,
    onChange: ({ reports, street }) => {
      if (!heatmap) return;
      heatmap.render(countByLocation(reports));
      heatmap.highlight(street);
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

  // Two frames, so the map's container has been laid out before Leaflet
  // measures it and frames the incident spread.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (heatmap) heatmap.invalidate();
      update();
      if (heatmap) heatmap.fit();
    })
  );
});
