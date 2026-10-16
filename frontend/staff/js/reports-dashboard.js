// Barangay Platero OVRMS — Reports Dashboard: a top date-range filter (presets or a
// custom "Date From - Date To" range) sets the default period for the
// stats and all four graphs; each graph can then override it with its own
// dropdown until the top filter changes again or Clear Filters is pressed.
// All real data, from reports-data.js's API-backed source (category comes
// from matching each report's ordinance against the real uploaded
// ordinances — see reports-data.js's categoryForOrdinance). The heatmap is
// a Leaflet density map keyed on each report's street (geocoded to a
// centroid in street-coordinates.js) — see js/heatmap.js; its full analysis
// lives on its own page (geo-analysis.html).

document.addEventListener("DOMContentLoaded", async () => {
  const CATEGORY_COLOR_PALETTE = [
    "#5b7fd1", "#2fd6c4", "#d13ec4", "#e8a33d",
    "#6fcf5b", "#e85b5b", "#8a6fd1", "#3ba3c9",
    "#c9a227", "#5b8c5a", "#d1667f", "#4a6fa5",
    "#e0824a", "#7b5ea7", "#3c9d8f", "#b25a9e",
  ];

  // The top date-range filter sets a default that every graph follows —
  // changing it immediately re-applies to all four (clearing any
  // per-graph override) — but each graph's own dropdown can then override
  // it independently, until the top filter changes again or Clear Filters
  // is pressed. The 5 stat cards and the Report Timeline table always
  // follow the top filter only (Report Timeline is actually independent of
  // every filter — see its own comment below).
  const state = {
    topPeriod: "week",
    customRange: null, // {from: "YYYY-MM-DD", to: "YYYY-MM-DD"} once topPeriod === "custom"
    graphOverride: { heatmap: null, category: null, status: null, investigator: null, trend: null },
  };

  function topPeriodValue() {
    return state.topPeriod === "custom" && state.customRange
      ? { type: "custom", from: state.customRange.from, to: state.customRange.to }
      : state.topPeriod;
  }

  // The period a given graph should actually render with — its own
  // override if it has one, else whatever the top filter is set to.
  function effectivePeriod(graphKey) {
    return state.graphOverride[graphKey] || topPeriodValue();
  }

  // Builds from local date components, not toISOString() (which converts to
  // UTC first and would roll the date back a day in any timezone ahead of
  // UTC, e.g. the Philippines at local midnight).
  function toDateInputValue(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function labelForPeriodValue(value) {
    if (value && typeof value === "object" && value.type === "custom") {
      return `${formatDate(new Date(`${value.from}T00:00:00`))} - ${formatDate(new Date(`${value.to}T00:00:00`))}`;
    }
    const opt = buildPeriodOptions().find((o) => o.value === value);
    return opt ? opt.label : "";
  }

  const dashboardMain = document.querySelector(".admin-content");

  try {
    await ensureOrdinancesLoaded();
    await ensureReportsLoaded();
  } catch (err) {
    if (dashboardMain) {
      dashboardMain.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    }
    return;
  }
  // Best-effort, unlike the two above — the heatmap/geo summary just can't
  // place a street-only report precisely if this fails, not worth failing
  // the whole dashboard over.
  await ensureStreetsLoaded().catch(() => {});

  // Every category a real ordinance defines, plus "Other" only if some
  // report's ordinance text didn't match any of them — computed once so the
  // pie legend doesn't reshuffle as the period dropdown changes.
  const REPORT_CATEGORIES = Array.from(
    new Set([...liveOrdinances().map((o) => o.category), ...liveReports().map((r) => r.category)])
  );

  // Assigned by each category's stable position in REPORT_CATEGORIES, not a
  // hash of its name — a hash can (and did) collide two categories onto the
  // same color even well under the palette size.
  const CATEGORY_COLOR_BY_NAME = new Map(
    REPORT_CATEGORIES.map((name, i) => [name, CATEGORY_COLOR_PALETTE[i % CATEGORY_COLOR_PALETTE.length]])
  );

  function categoryColor(name) {
    return CATEGORY_COLOR_BY_NAME.get(name) || CATEGORY_COLOR_PALETTE[0];
  }

  function formatDate(date) {
    return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  function buildPeriodOptions() {
    return buildReportPeriodOptions();
  }

  // ---- Dropdown open/close ----

  const allDropdowns = Array.from(document.querySelectorAll(".dash-dropdown"));

  function closeAllDropdowns() {
    allDropdowns.forEach((d) => {
      const menu = d.querySelector(".dash-dropdown-menu");
      if (menu) menu.hidden = true;
    });
  }

  allDropdowns.forEach((dropdown) => {
    const btn = dropdown.querySelector(".dash-dropdown__btn");
    const menu = dropdown.querySelector(".dash-dropdown-menu");
    if (!btn || !menu) return;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasHidden = menu.hidden;
      closeAllDropdowns();
      menu.hidden = !wasHidden;
    });
  });

  document.addEventListener("click", () => closeAllDropdowns());

  // ---- Stats + delta ----

  // stats.process/remarks keep their old names to match the statProcess/
  // statRemarks element ids below, but now count "Under Review"/"In Action"
  // respectively.
  function computeStats(reports) {
    const stats = { total: reports.length, new: 0, process: 0, resolved: 0, remarks: 0 };
    reports.forEach((r) => {
      if (r.status === "New Submission") stats.new++;
      else if (r.status === "Under Review") stats.process++;
      else if (r.status === "Resolved") stats.resolved++;
      else if (r.status === "In Action") stats.remarks++;
    });
    return stats;
  }

  function getPreviousPeriodValue(period) {
    return previousReportPeriod(period);
  }

  function periodDeltaSuffix(period) {
    if (typeof period !== "string") return "";
    if (period.startsWith("week")) return "vs last week";
    if (period.startsWith("month")) return "vs last month";
    if (period.startsWith("quarter")) return "vs last quarter";
    if (period.startsWith("year")) return "vs last year";
    return "";
  }

  function deltaText(cur, prev, suffix) {
    let pct;
    if (prev === 0) pct = cur === 0 ? 0 : 100;
    else pct = Math.round(((cur - prev) / prev) * 100);
    const arrow = pct >= 0 ? "↗" : "↘";
    return { text: `${arrow} ${Math.abs(pct)}% ${suffix}`, isDown: pct < 0 };
  }

  function setStat(valueId, deltaId, cur, prev, suffix) {
    document.getElementById(valueId).textContent = cur;
    const deltaEl = document.getElementById(deltaId);
    if (prev === null) {
      deltaEl.textContent = "";
      deltaEl.classList.remove("stat-card__delta--down");
      return;
    }
    const { text, isDown } = deltaText(cur, prev, suffix);
    deltaEl.textContent = text;
    deltaEl.classList.toggle("stat-card__delta--down", isDown);
  }

  function renderStats() {
    const topPeriod = topPeriodValue();
    const cur = computeStats(getReportsForPeriod(topPeriod));
    const prevPeriod = getPreviousPeriodValue(topPeriod);
    const prev = prevPeriod ? computeStats(getReportsForPeriod(prevPeriod)) : null;
    const suffix = periodDeltaSuffix(topPeriod);
    setStat("statTotal", "statTotalDelta", cur.total, prev && prev.total, suffix);
    setStat("statNew", "statNewDelta", cur.new, prev && prev.new, suffix);
    setStat("statProcess", "statProcessDelta", cur.process, prev && prev.process, suffix);
    setStat("statResolved", "statResolvedDelta", cur.resolved, prev && prev.resolved, suffix);
    setStat("statRemarks", "statRemarksDelta", cur.remarks, prev && prev.remarks, suffix);
  }

  // ---- Date range dropdown (the top filter — sets every graph's default) ----

  const dateRangeLabel = document.getElementById("dateRangeLabel");
  const dateRangeMenu = document.getElementById("dateRangeMenu");
  const clearFiltersBtn = document.getElementById("clearFiltersBtn");

  // Changing the top filter is an "overwrite" — every graph's own override
  // is cleared so all four immediately follow the new top period again.
  function setTopPeriod(period, customRange) {
    state.topPeriod = period;
    state.customRange = customRange || null;
    Object.keys(state.graphOverride).forEach((key) => (state.graphOverride[key] = null));
  }

  function renderDateRangeMenu() {
    const defaultRange = state.customRange || {
      from: toDateInputValue(getWeekRange(0).start),
      to: toDateInputValue(getWeekRange(0).end),
    };
    dateRangeMenu.innerHTML =
      `<li class="dash-dropdown-menu__custom">
        <div class="dash-dropdown-menu__custom-row">
          <label>From <input type="date" id="topCustomFrom" value="${defaultRange.from}" /></label>
          <label>To <input type="date" id="topCustomTo" value="${defaultRange.to}" /></label>
        </div>
        <button type="button" class="btn" id="topCustomApply">Apply Custom Range</button>
      </li>` +
      buildPeriodOptions()
        .map(
          (o) =>
            `<li data-value="${o.value}" class="${state.topPeriod === o.value ? "active" : ""}">${o.label}</li>`
        )
        .join("");

    dateRangeMenu.querySelectorAll("li[data-value]").forEach((li) => {
      li.addEventListener("click", () => {
        setTopPeriod(li.dataset.value);
        closeAllDropdowns();
        renderAll();
      });
    });

    const customLi = dateRangeMenu.querySelector(".dash-dropdown-menu__custom");
    customLi.addEventListener("click", (e) => e.stopPropagation());
    customLi.querySelector("#topCustomApply").addEventListener("click", () => {
      const from = customLi.querySelector("#topCustomFrom").value;
      const to = customLi.querySelector("#topCustomTo").value;
      if (!from || !to || from > to) {
        siteAlert("Choose a valid date range (From must be on or before To).");
        return;
      }
      setTopPeriod("custom", { from, to });
      closeAllDropdowns();
      renderAll();
    });
  }

  clearFiltersBtn.addEventListener("click", () => {
    setTopPeriod("week");
    renderAll();
  });

  // ---- Reports by Category pie ----
  // An SVG pie — each wedge is its own <path>/<circle> with a hover/focus
  // tooltip (category, percent, count) instead of a permanent side legend.
  // The expand button opens a bigger version of the same pie alongside a
  // full breakdown list, which is what stands in for a legend here (see
  // dataviz guidance: identity must be reachable as text, just not
  // necessarily always visible on the small card).

  const SVG_NS = "http://www.w3.org/2000/svg";
  const PIE_RADIUS = 46;
  const PIE_LABEL_RADIUS = 30;

  const categoryPie = document.getElementById("categoryPie");
  const categoryPieEmpty = document.getElementById("categoryPieEmpty");
  const categoryPieTooltip = document.getElementById("categoryPieTooltip");
  const categoryPieTooltipName = document.getElementById("categoryPieTooltipName");
  const categoryPieTooltipValue = document.getElementById("categoryPieTooltipValue");
  const categoryExpandBtn = document.getElementById("categoryExpandBtn");
  const categoryExpandModal = document.getElementById("categoryExpandModal");
  const categoryPieExpanded = document.getElementById("categoryPieExpanded");
  const categoryPieExpandedList = document.getElementById("categoryPieExpandedList");

  // Reused by both the small card pie and the expanded modal's pie, so the
  // two always agree — computed once per render from the same report list.
  let lastCategorySlices = [];

  function pieSliceData(reports) {
    const counts = {};
    REPORT_CATEGORIES.forEach((c) => (counts[c] = 0));
    reports.forEach((r) => (counts[r.category] = (counts[r.category] || 0) + 1));
    const total = reports.length;
    let cum = 0;
    return REPORT_CATEGORIES.map((category) => {
      const count = counts[category] || 0;
      const startFrac = cum;
      cum += total ? count / total : 0;
      const endFrac = cum;
      return { category, count, pct: total ? Math.round((count / total) * 100) : 0, startFrac, endFrac };
    });
  }

  // fraction 0 is the top (12 o'clock), increasing clockwise — matches how
  // the old conic-gradient version read.
  function pieEdgePoint(fraction, radius) {
    const theta = fraction * 2 * Math.PI;
    return { x: 50 + radius * Math.sin(theta), y: 50 - radius * Math.cos(theta) };
  }

  function describeWedgePath(startFrac, endFrac, radius) {
    const start = pieEdgePoint(startFrac, radius);
    const end = pieEdgePoint(endFrac, radius);
    const largeArc = endFrac - startFrac > 0.5 ? 1 : 0;
    return `M 50 50 L ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)} Z`;
  }

  function hidePieTooltip() {
    categoryPieTooltip.hidden = true;
  }

  function showPieTooltip(slice, x, y) {
    categoryPieTooltipName.textContent = slice.category;
    categoryPieTooltipValue.textContent = `${slice.pct}% • ${slice.count} ${slice.count === 1 ? "report" : "reports"}`;
    categoryPieTooltip.hidden = false;
    const rect = categoryPieTooltip.getBoundingClientRect();
    categoryPieTooltip.style.left = `${Math.min(Math.max(8, x), window.innerWidth - rect.width - 8)}px`;
    categoryPieTooltip.style.top = `${Math.min(Math.max(8, y), window.innerHeight - rect.height - 8)}px`;
  }

  function wireWedgeInteraction(el, slice) {
    el.addEventListener("mouseenter", (e) => showPieTooltip(slice, e.clientX + 14, e.clientY + 14));
    el.addEventListener("mousemove", (e) => showPieTooltip(slice, e.clientX + 14, e.clientY + 14));
    el.addEventListener("mouseleave", hidePieTooltip);
    el.addEventListener("focus", () => {
      const rect = el.getBoundingClientRect();
      showPieTooltip(slice, rect.left + rect.width / 2 - 60, rect.top - 50);
    });
    el.addEventListener("blur", hidePieTooltip);
  }

  function renderPieSVG(svg, slices) {
    svg.innerHTML = "";
    const nonZero = slices.filter((s) => s.count > 0);
    const single = nonZero.length === 1 ? nonZero[0] : null;

    nonZero.forEach((slice) => {
      const el = document.createElementNS(SVG_NS, single ? "circle" : "path");
      if (single) {
        el.setAttribute("cx", "50");
        el.setAttribute("cy", "50");
        el.setAttribute("r", String(PIE_RADIUS));
      } else {
        el.setAttribute("d", describeWedgePath(slice.startFrac, slice.endFrac, PIE_RADIUS));
      }
      el.setAttribute("fill", categoryColor(slice.category));
      el.setAttribute("class", "category-pie__wedge");
      el.setAttribute("tabindex", "0");
      el.setAttribute("role", "img");
      el.setAttribute(
        "aria-label",
        `${slice.category}: ${slice.pct}% — ${slice.count} ${slice.count === 1 ? "report" : "reports"}`
      );
      wireWedgeInteraction(el, slice);
      svg.appendChild(el);

      const mid = single ? 0.5 : (slice.startFrac + slice.endFrac) / 2;
      const pt = pieEdgePoint(mid, PIE_LABEL_RADIUS);
      const text = document.createElementNS(SVG_NS, "text");
      text.setAttribute("x", pt.x.toFixed(3));
      text.setAttribute("y", pt.y.toFixed(3));
      text.setAttribute("class", "category-pie__label");
      text.textContent = `${slice.pct}%`;
      svg.appendChild(text);
    });
  }

  function renderCategoryPie() {
    hidePieTooltip();
    const reports = getReportsForPeriod(effectivePeriod("category"));
    if (!reports.length) {
      categoryPie.innerHTML = "";
      categoryPieEmpty.hidden = false;
      lastCategorySlices = [];
      return;
    }
    categoryPieEmpty.hidden = true;
    lastCategorySlices = pieSliceData(reports);
    renderPieSVG(categoryPie, lastCategorySlices);
  }

  categoryExpandBtn.addEventListener("click", () => {
    if (!lastCategorySlices.length) return;
    renderPieSVG(categoryPieExpanded, lastCategorySlices);

    // Only the categories that actually have a slice this period — one at 0%
    // has no wedge to match its colour to, so listing it is just noise.
    categoryPieExpandedList.innerHTML = "";
    lastCategorySlices.filter((slice) => slice.count > 0).forEach((slice) => {
      const li = document.createElement("li");
      li.className = "category-pie-modal__item";

      const row = document.createElement("button");
      row.type = "button";
      row.className = "category-pie-modal__row";
      row.setAttribute("aria-expanded", "false");

      const dot = document.createElement("span");
      dot.className = "category-pie-modal__dot";
      dot.style.background = categoryColor(slice.category);
      const label = document.createElement("span");
      label.className = "category-pie-modal__list-label";
      label.textContent = slice.category;
      const value = document.createElement("span");
      value.className = "category-pie-modal__list-value";
      value.textContent = `${slice.pct}% (${slice.count})`;
      const chevron = document.createElement("span");
      chevron.className = "category-pie-modal__chevron";
      chevron.setAttribute("aria-hidden", "true");
      chevron.textContent = "▾";
      row.append(dot, label, value, chevron);

      // Every ordinance filed under this category, not just the ones a
      // report happened to cite this period — lets staff see the full
      // picture when they drill in.
      const ordinances = liveOrdinances().filter((o) => o.category === slice.category);
      const sublist = document.createElement("ul");
      sublist.className = "category-pie-modal__sublist";
      sublist.hidden = true;
      if (ordinances.length) {
        ordinances.forEach((o) => {
          const subLi = document.createElement("li");
          subLi.textContent = `${o.number} — ${o.title}`;
          sublist.appendChild(subLi);
        });
      } else {
        const subLi = document.createElement("li");
        subLi.className = "category-pie-modal__sublist-empty";
        subLi.textContent = "No ordinances under this category.";
        sublist.appendChild(subLi);
      }

      row.addEventListener("click", () => {
        const expanded = row.getAttribute("aria-expanded") === "true";
        row.setAttribute("aria-expanded", String(!expanded));
        sublist.hidden = expanded;
        li.classList.toggle("category-pie-modal__item--open", !expanded);
      });

      li.append(row, sublist);
      categoryPieExpandedList.appendChild(li);
    });

    categoryExpandModal.hidden = false;
  });

  // ---- Reports by Status bar chart ----

  const statusBarChart = document.getElementById("statusBarChart");

  const STATUS_BAR_DEFS = [
    { key: "new", label: "New Submission", modifier: "new" },
    { key: "process", label: "Under Review", modifier: "process" },
    { key: "remarks", label: "In Action", modifier: "remarks" },
    { key: "resolved", label: "Resolved", modifier: "resolved" },
  ];
  const MAX_BAR_HEIGHT = 168; // px — leaves room for the count label above it

  function renderStatusChart() {
    const stats = computeStats(getReportsForPeriod(effectivePeriod("status")));
    const maxCount = Math.max(stats.new, stats.process, stats.remarks, stats.resolved, 1);

    if (!stats.total) {
      statusBarChart.innerHTML = `<div class="status-bar-chart__empty">No reports for this period.</div>`;
      return;
    }

    statusBarChart.innerHTML = STATUS_BAR_DEFS.map(({ key, label, modifier }) => {
      const count = stats[key];
      const height = Math.max(Math.round((count / maxCount) * MAX_BAR_HEIGHT), count > 0 ? 6 : 2);
      return `
        <div class="status-bar-chart__col">
          <span class="status-bar-chart__count">${count}</span>
          <div class="status-bar-chart__bar status-bar-chart__bar--${modifier}" style="height:${height}px"></div>
          <span class="status-bar-chart__label">${label}</span>
        </div>`;
    }).join("");
  }

  // ---- Investigator Performance bar chart (Barangay Captain only — this
  // whole dashboard is Captain-only, see admin.js's STAFF_NAV_ACCESS) ----
  // Counts how many reports each Investigator currently has claimed (see
  // reports-data.js's assignedInvestigator) within the selected period —
  // built from whichever Investigators show up claiming a report, since
  // there's no separate "list every Investigator" endpoint available here.

  const investigatorBarChart = document.getElementById("investigatorBarChart");
  const INVESTIGATOR_BAR_COLORS = [
    "#5b7fd1", "#2fd6c4", "#d13ec4", "#e8a33d",
    "#6fcf5b", "#e85b5b", "#8a6fd1", "#3ba3c9",
  ];

  function renderInvestigatorChart() {
    const reports = getReportsForPeriod(effectivePeriod("investigator")).filter((r) => r.assignedInvestigator);
    const counts = {};
    reports.forEach((r) => {
      counts[r.assignedInvestigator] = (counts[r.assignedInvestigator] || 0) + 1;
    });
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

    if (!names.length) {
      investigatorBarChart.innerHTML = `<div class="status-bar-chart__empty">No claimed reports for this period.</div>`;
      return;
    }

    const maxCount = Math.max(...names.map((n) => counts[n]), 1);
    investigatorBarChart.innerHTML = names
      .map((name, i) => {
        const count = counts[name];
        const height = Math.max(Math.round((count / maxCount) * MAX_BAR_HEIGHT), 6);
        const color = INVESTIGATOR_BAR_COLORS[i % INVESTIGATOR_BAR_COLORS.length];
        return `
        <div class="status-bar-chart__col">
          <span class="status-bar-chart__count">${count}</span>
          <div class="status-bar-chart__bar" style="height:${height}px;background:${color}"></div>
          <span class="status-bar-chart__label">${name}</span>
        </div>`;
      })
      .join("");
  }

  // ---- Report Timeline (aging list) ----
  //
  // Deliberately NOT filtered by state.period — an old report shouldn't
  // vanish from this list just because the selected date range has moved
  // past its submission date. Report has no resolved_at (see reports/
  // models.py), so "days open" is measured from created_at to now for
  // anything not yet Resolved, which is the closest honest proxy available.
  let agingListLimit = 5;
  const agingReportsBody = document.getElementById("agingReportsBody");
  const timelinePageSizeSelect = document.getElementById("timelinePageSize");

  if (timelinePageSizeSelect) {
    timelinePageSizeSelect.addEventListener("change", () => {
      agingListLimit = timelinePageSizeSelect.value === "all" ? Infinity : Number(timelinePageSizeSelect.value);
      renderAgingReports();
    });
  }
  wireFiltersDropdown(document.getElementById("timelineFiltersToggleBtn"), document.getElementById("timelineFiltersPanel"));

  function daysBetween(from, to) {
    return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
  }

  // Report Timeline age coloring: 0-5 days green, 6-10 yellow, 11-15 orange, 16+ red.
  function agingPillClass(days) {
    if (days <= 5) return "aging-pill--green";
    if (days <= 10) return "aging-pill--yellow";
    if (days <= 15) return "aging-pill--orange";
    return "aging-pill--red";
  }

  function renderAgingReports() {
    if (!agingReportsBody) return;
    const now = new Date();
    const open = liveReports()
      .filter((r) => r.status !== "Resolved")
      .slice()
      .sort((a, b) => a.dateSubmitted - b.dateSubmitted)
      .slice(0, agingListLimit);

    agingReportsBody.innerHTML = open.length
      ? open
          .map((r) => {
            const days = daysBetween(r.dateSubmitted, now);
            return `
        <tr>
          <td>${r.ordinance || "—"}</td>
          <td>${r.location || "—"}</td>
          <td><span class="status-pill ${agingPillClass(days)}">${days} ${days === 1 ? "day" : "days"}</span></td>
          <td><span class="status-pill ${statusPillClass(r.status)}">${r.status}</span></td>
          <td>${r.assignedInvestigator || "Unclaimed"}</td>
          <td><a class="recent-reports-table__view-btn" href="report-detail.html?id=${encodeURIComponent(r.id)}">View Details</a></td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="6" class="ordinances-empty">Nothing open — every report has been resolved.</td></tr>`;
  }

  function statusPillClass(status) {
    if (status === "Resolved") return "status-pill--resolved";
    if (status === "Under Review") return "status-pill--in-process";
    if (status === "In Action") return "status-pill--remarks";
    return "status-pill--new";
  }

  // ---- Incident heatmap (real Leaflet density map) + its summary ----
  //
  // Intensity = number of reports per street for the selected period, placed
  // at that street's centroid (street-coordinates.js). The card's map is
  // static; clicking it (or the summary's button) opens the Geospatial
  // Analysis page on the same period. Beside it, renderGeoSummary
  // (geo-analysis.js) gives the headline figures for that period.

  const heatmapCanvasEl = document.getElementById("heatmapCanvas");
  const geoSummaryEl = document.getElementById("geoSummary");

  function geoAnalysisHref() {
    return `geo-analysis.html?${reportPeriodToQuery(effectivePeriod("heatmap"))}`;
  }

  // The summary doesn't need the map — it still renders if Leaflet or the
  // tile host is unreachable (see setupHeatmap's catch below).
  let registeredCitizens = null;
  function renderGeoSummaryCard() {
    renderGeoSummary(geoSummaryEl, {
      reports: getReportsForPeriod(effectivePeriod("heatmap")),
      registeredCitizens,
      href: geoAnalysisHref(),
    });
  }
  loadRegisteredCitizenCount().then((count) => {
    registeredCitizens = count;
    renderGeoSummaryCard();
  });

  // No-op unless setupHeatmap() succeeds — a failed map init then just
  // leaves an empty map instead of taking down the stats, table, and pie
  // with it.
  let renderHeatmapCard = () => {};
  const renderHeatmaps = () => {
    renderHeatmapCard();
    renderGeoSummaryCard();
  };

  function setupHeatmap() {
    if (typeof L === "undefined" || typeof createIncidentHeatmap !== "function") {
      throw new Error("Leaflet / heatmap.js not loaded");
    }

    const cardHeatmap = createIncidentHeatmap(heatmapCanvasEl, { interactive: false });

    renderHeatmapCard = () => {
      const unmapped = cardHeatmap.render(countByLocation(getReportsForPeriod(effectivePeriod("heatmap")))) || [];
      if (unmapped.length) {
        console.warn("[heatmap] reports on streets with no known coordinates:", unmapped);
      }
    };

    const openGeoAnalysis = () => {
      window.location.href = geoAnalysisHref();
    };
    heatmapCanvasEl.addEventListener("click", openGeoAnalysis);
    heatmapCanvasEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openGeoAnalysis();
      }
    });

    window.addEventListener("resize", () => cardHeatmap.invalidate());

    // Defer the first paint: during DOMContentLoaded the card hasn't been
    // laid out yet, so Leaflet would measure it at 0×0 and mis-fit the view.
    requestAnimationFrame(() => {
      cardHeatmap.invalidate();
      renderHeatmapCard();
    });
  }

  try {
    setupHeatmap();
  } catch (err) {
    console.error("[heatmap] disabled:", err);
    heatmapCanvasEl.classList.remove("heatmap-canvas");
    heatmapCanvasEl.innerHTML = `<div class="ordinances-empty">Map unavailable</div>`;
  }

  // ---- Reports Filed Over Time (line chart) ----
  //
  // One line: how many reports were filed in each step of the selected
  // period — days for anything up to about six weeks, weeks up to about half
  // a year, months beyond that. Same drawing approach and .cd-trend styles as
  // the Concerns Dashboard's "Submissions over time" (concerns-dashboard.js).

  const reportsTrendChart = document.getElementById("reportsTrendChart");
  const reportsTrendSummary = document.getElementById("reportsTrendSummary");
  const TREND = { height: 240, left: 34, right: 18, top: 14, bottom: 30 };
  const TREND_MAX_LABELS = 10;
  const DAY_MS = 24 * 60 * 60 * 1000;

  // First and last moment of a period value (see getReportsForPeriod).
  function periodDateRange(period) {
    if (period && typeof period === "object") {
      return { start: new Date(`${period.from}T00:00:00`), end: endOfDay(new Date(`${period.to}T00:00:00`)) };
    }
    if (period === "all") {
      const first = liveReports().reduce((min, r) => (r.dateSubmitted < min ? r.dateSubmitted : min), new Date());
      return { start: new Date(first.getFullYear(), first.getMonth(), 1), end: endOfDay(new Date()) };
    }
    const [, kind, back] = period === "week" ? [null, "week", "0"] : period.match(/^(week|month|quarter|year)(\d+)$/);
    const range = { week: getWeekRange, month: getMonthRange, quarter: getQuarterRange, year: getYearRange }[kind](Number(back));
    return { start: range.start, end: endOfDay(range.end) };
  }

  // Splits start..end into the chart's steps: [{ start, end, label, title }].
  function trendBuckets(start, end) {
    const days = Math.round((end - start) / DAY_MS);
    const unit = days <= 45 ? "day" : days <= 200 ? "week" : "month";
    const short = (date, options) => date.toLocaleDateString("en-US", options);
    const buckets = [];

    if (unit === "month") {
      const spansYears = start.getFullYear() !== end.getFullYear();
      for (let first = new Date(start.getFullYear(), start.getMonth(), 1); first <= end; first = new Date(first.getFullYear(), first.getMonth() + 1, 1)) {
        buckets.push({
          start: first,
          end: endOfDay(new Date(first.getFullYear(), first.getMonth() + 1, 0)),
          // "Mar '25", not "Mar 25", which reads as a day of the month.
          label: short(first, { month: "short" }) + (spansYears ? ` '${String(first.getFullYear()).slice(2)}` : ""),
          title: short(first, { month: "long", year: "numeric" }),
        });
      }
    } else {
      const step = unit === "week" ? 7 : 1;
      for (let day = new Date(start); day <= end; day = addDays(day, step)) {
        const last = unit === "week" ? new Date(Math.min(addDays(day, 6), end)) : day;
        buckets.push({
          start: day,
          end: endOfDay(last),
          label: unit === "day" && days <= 7 ? short(day, { weekday: "short" }) : short(day, { month: "short", day: "numeric" }),
          title:
            unit === "week"
              ? `${short(day, { month: "short", day: "numeric" })} – ${short(last, { month: "short", day: "numeric", year: "numeric" })}`
              : short(day, { weekday: "long", month: "long", day: "numeric", year: "numeric" }),
        });
      }
    }

    // Thin the axis labels so a 31-day month doesn't print 31 of them.
    const every = Math.ceil(buckets.length / TREND_MAX_LABELS);
    buckets.forEach((b, i) => {
      if (i % every !== 0) b.label = "";
    });
    return { unit, buckets };
  }

  function renderReportsTrend() {
    const period = effectivePeriod("trend");
    const reports = getReportsForPeriod(period);
    const total = reports.length;
    if (!total) {
      reportsTrendSummary.textContent = "";
      reportsTrendChart.innerHTML = `<p class="cd-empty">No reports filed in this period.</p>`;
      return;
    }

    const { start, end } = periodDateRange(period);
    const { unit, buckets } = trendBuckets(start, end);
    const now = new Date();
    const points = buckets.map((b) => ({
      ...b,
      // Steps that haven't started yet have no value at all — the line
      // stops at today instead of dropping to a misleading zero.
      future: b.start > now,
      count: reports.filter((r) => r.dateSubmitted >= b.start && r.dateSubmitted <= b.end).length,
    }));
    const drawn = points.filter((p) => !p.future);
    const pct = (count) => `${Math.round((count / total) * 1000) / 10}%`;

    const peak = drawn.reduce((best, p) => (p.count > best.count ? p : best), drawn[0]);
    reportsTrendSummary.innerHTML = `<b>${total}</b> ${total === 1 ? "report" : "reports"} filed, shown by ${unit}. Busiest ${unit}: ${peak.title} — <b>${pct(peak.count)}</b> (${peak.count}).`;

    const { height, left, right, top, bottom } = TREND;
    const width = Math.max(reportsTrendChart.clientWidth, 280);
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    // Whole-number gridlines: a count of reports is never fractional.
    const rawMax = Math.max(...points.map((p) => p.count), 1);
    const step = Math.max(1, Math.ceil(rawMax / 4));
    const max = step * Math.ceil(rawMax / step);
    const x = (i) => left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v) => top + plotH - (v / max) * plotH;
    const line = drawn.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.count).toFixed(1)}`).join(" ");

    const grid = [];
    for (let v = 0; v <= max; v += step) {
      grid.push(`<line class="cd-trend__grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="cd-trend__tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    }
    const xLabels = points
      .map((p, i) => (p.label ? `<text class="cd-trend__tick" x="${x(i)}" y="${height - 8}" text-anchor="middle">${p.label}</text>` : ""))
      .join("");
    // A single plotted step has no line to draw — show its point.
    const lonePoint =
      drawn.length === 1 ? `<circle class="cd-trend__dot cd-trend__dot--received" r="4.5" cx="${x(0)}" cy="${y(drawn[0].count)}"/>` : "";

    reportsTrendChart.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Reports filed over time: ${total} in the selected period, by ${unit}">
        ${grid.join("")}
        ${xLabels}
        <path class="cd-trend__line cd-trend__line--received" d="${line}"/>
        ${lonePoint}
        <g class="cd-trend__hover" hidden>
          <line class="cd-trend__cursor" y1="${top}" y2="${top + plotH}"/>
          <circle class="cd-trend__dot cd-trend__dot--received" r="4.5"/>
        </g>
        <rect class="cd-trend__hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/>
      </svg>
      <div class="cd-trend__tip" hidden></div>`;

    const svg = reportsTrendChart.querySelector("svg");
    const hover = reportsTrendChart.querySelector(".cd-trend__hover");
    const cursor = hover.querySelector(".cd-trend__cursor");
    const dot = hover.querySelector(".cd-trend__dot");
    const tip = reportsTrendChart.querySelector(".cd-trend__tip");
    const hit = reportsTrendChart.querySelector(".cd-trend__hit");

    function show(clientX) {
      const box = svg.getBoundingClientRect();
      const svgX = ((clientX - box.left) / box.width) * width;
      const i = Math.max(0, Math.min(drawn.length - 1, Math.round(((svgX - left) / plotW) * (points.length - 1))));
      const p = drawn[i];
      hover.removeAttribute("hidden");
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      dot.setAttribute("cx", x(i));
      dot.setAttribute("cy", y(p.count));
      tip.hidden = false;
      tip.innerHTML = `<strong>${p.title}</strong>
        <span>Reports filed <b>${p.count}</b></span>
        <span>Share of this period <b>${pct(p.count)}</b></span>`;
      // Keep the tooltip inside the card on either side of the cursor.
      const px = (x(i) / width) * box.width;
      const flip = px > box.width * 0.6;
      tip.style.left = flip ? "auto" : `${px + 12}px`;
      tip.style.right = flip ? `${box.width - px + 12}px` : "auto";
    }
    function hide() {
      hover.setAttribute("hidden", "");
      tip.hidden = true;
    }
    hit.addEventListener("mousemove", (e) => show(e.clientX));
    hit.addEventListener("mouseleave", hide);
    hit.addEventListener("touchstart", (e) => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener("touchmove", (e) => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener("touchend", hide);
  }

  // Drawn at the card's real pixel width, so it has to be redrawn when that changes.
  window.addEventListener("resize", () => renderReportsTrend());

  // ---- Per-graph filter dropdowns — override the top filter for one card ----

  const GRAPH_FILTERS = [
    { key: "heatmap", labelId: "heatmapFilterLabel", menuId: "heatmapFilterMenu", render: () => renderHeatmaps() },
    { key: "category", labelId: "categoryFilterLabel", menuId: "categoryFilterMenu", render: () => renderCategoryPie() },
    { key: "status", labelId: "statusFilterLabel", menuId: "statusFilterMenu", render: () => renderStatusChart() },
    { key: "investigator", labelId: "investigatorFilterLabel", menuId: "investigatorFilterMenu", render: () => renderInvestigatorChart() },
    { key: "trend", labelId: "trendFilterLabel", menuId: "trendFilterMenu", render: () => renderReportsTrend() },
  ];

  function renderGraphFilterLabel(cfg) {
    const override = state.graphOverride[cfg.key];
    document.getElementById(cfg.labelId).textContent = override ? labelForPeriodValue(override) : "Dashboard Default";
  }

  function renderGraphFilterMenu(cfg) {
    const menu = document.getElementById(cfg.menuId);
    const override = state.graphOverride[cfg.key];
    const isCustom = !!override && typeof override === "object";
    const current = isCustom ? "" : override || "";
    const defaultRange = isCustom
      ? override
      : { from: toDateInputValue(getWeekRange(0).start), to: toDateInputValue(getWeekRange(0).end) };
    const options = [{ value: "", label: "Dashboard Default" }, ...buildPeriodOptions()];
    menu.innerHTML =
      `<li class="dash-dropdown-menu__custom">
        <div class="dash-dropdown-menu__custom-row">
          <label>From <input type="date" id="${cfg.key}CustomFrom" value="${defaultRange.from}" /></label>
          <label>To <input type="date" id="${cfg.key}CustomTo" value="${defaultRange.to}" /></label>
        </div>
        <button type="button" class="btn" id="${cfg.key}CustomApply">Apply Custom Range</button>
      </li>` +
      options
        .map((o) => `<li data-value="${o.value}" class="${current === o.value ? "active" : ""}">${o.label}</li>`)
        .join("");

    menu.querySelectorAll("li[data-value]").forEach((li) => {
      li.addEventListener("click", () => {
        state.graphOverride[cfg.key] = li.dataset.value || null;
        closeAllDropdowns();
        renderGraphFilterLabel(cfg);
        renderGraphFilterMenu(cfg);
        cfg.render();
      });
    });

    const customLi = menu.querySelector(".dash-dropdown-menu__custom");
    customLi.addEventListener("click", (e) => e.stopPropagation());
    customLi.querySelector(`#${cfg.key}CustomApply`).addEventListener("click", () => {
      const from = customLi.querySelector(`#${cfg.key}CustomFrom`).value;
      const to = customLi.querySelector(`#${cfg.key}CustomTo`).value;
      if (!from || !to || from > to) {
        siteAlert("Choose a valid date range (From must be on or before To).");
        return;
      }
      state.graphOverride[cfg.key] = { type: "custom", from, to };
      closeAllDropdowns();
      renderGraphFilterLabel(cfg);
      renderGraphFilterMenu(cfg);
      cfg.render();
    });
  }

  // ---- Download Summary (PDF) — whatever the current filters show,
  // reusing the exact same per-graph effective period each chart already
  // renders with, rather than re-deriving anything server-side. ----

  function gatherDashboardSummary() {
    const topPeriod = topPeriodValue();
    const curStats = computeStats(getReportsForPeriod(topPeriod));
    const prevPeriod = getPreviousPeriodValue(topPeriod);
    const prevStats = prevPeriod ? computeStats(getReportsForPeriod(prevPeriod)) : null;

    const categoryPeriod = effectivePeriod("category");
    const categorySlices = pieSliceData(getReportsForPeriod(categoryPeriod)).filter((s) => s.count > 0);

    const statusPeriod = effectivePeriod("status");
    const statusStats = computeStats(getReportsForPeriod(statusPeriod));

    const investigatorPeriod = effectivePeriod("investigator");
    const investigatorCounts = {};
    getReportsForPeriod(investigatorPeriod)
      .filter((r) => r.assignedInvestigator)
      .forEach((r) => {
        investigatorCounts[r.assignedInvestigator] = (investigatorCounts[r.assignedInvestigator] || 0) + 1;
      });
    const investigators = Object.keys(investigatorCounts)
      .sort((a, b) => investigatorCounts[b] - investigatorCounts[a])
      .map((name) => ({ name, count: investigatorCounts[name] }));

    const trendPeriod = effectivePeriod("trend");
    const trendReports = getReportsForPeriod(trendPeriod);
    const { start, end } = periodDateRange(trendPeriod);
    const { unit, buckets } = trendBuckets(start, end);
    const trendPoints = buckets.map((b) => ({
      title: b.title,
      count: trendReports.filter((r) => r.dateSubmitted >= b.start && r.dateSubmitted <= b.end).length,
    }));

    // Not limited to agingListLimit (the on-screen page size) — a
    // downloaded summary is meant to be the complete record, not just
    // whatever currently fits on the card.
    const now = new Date();
    const aging = liveReports()
      .filter((r) => r.status !== "Resolved")
      .slice()
      .sort((a, b) => a.dateSubmitted - b.dateSubmitted)
      .map((r) => ({
        ordinance: r.ordinance || "—",
        location: r.location || "—",
        days: daysBetween(r.dateSubmitted, now),
        status: r.status,
        investigator: r.assignedInvestigator || "Unclaimed",
      }));

    return {
      top_period_label: labelForPeriodValue(topPeriod),
      stats: { current: curStats, previous: prevStats, delta_suffix: periodDeltaSuffix(topPeriod) },
      category: { period_label: labelForPeriodValue(categoryPeriod), slices: categorySlices },
      status: { period_label: labelForPeriodValue(statusPeriod), stats: statusStats },
      investigators: { period_label: labelForPeriodValue(investigatorPeriod), rows: investigators },
      trend: { period_label: labelForPeriodValue(trendPeriod), unit, points: trendPoints },
      aging,
    };
  }

  const downloadDashboardPdfBtn = document.getElementById("downloadDashboardPdfBtn");
  if (downloadDashboardPdfBtn) {
    downloadDashboardPdfBtn.addEventListener("click", async () => {
      downloadDashboardPdfBtn.disabled = true;
      downloadDashboardPdfBtn.textContent = "Preparing...";
      try {
        const response = await authFetch("/api/reports/staff/dashboard-pdf/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(gatherDashboardSummary()),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "Could not download the summary.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "reports-summary.pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        siteAlert(err.message);
      } finally {
        downloadDashboardPdfBtn.disabled = false;
        downloadDashboardPdfBtn.textContent = "Download Summary (PDF)";
      }
    });
  }

  // ---- Wire up — the top filter sets every graph's default ----

  function renderAll() {
    dateRangeLabel.textContent = labelForPeriodValue(topPeriodValue());
    renderDateRangeMenu();
    GRAPH_FILTERS.forEach((cfg) => {
      renderGraphFilterLabel(cfg);
      renderGraphFilterMenu(cfg);
    });
    renderStats();
    renderCategoryPie();
    renderStatusChart();
    renderInvestigatorChart();
    renderReportsTrend();
    renderHeatmaps();
    renderAgingReports();
  }

  // Deferred two frames, same as setupHeatmap()'s own first paint above —
  // at DOMContentLoaded the heatmap card hasn't been laid out yet, so
  // calling renderHeatmaps() (via renderAll) synchronously here would
  // measure its canvas at 0×0. Later calls (dropdown selection) run
  // renderAll() directly since layout is already settled by then.
  requestAnimationFrame(() => requestAnimationFrame(renderAll));
});
