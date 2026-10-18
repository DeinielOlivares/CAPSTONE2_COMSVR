// Barangay Platero OVRMS — Geospatial Analysis: the figures shown beside the incident
// heatmap. Turns the period's reports into figures
// a Barangay Captain can read off directly — every one shown as a count AND
// a percentage, with what the percentage is "of" spelled out, since a bare
// count says nothing about share or rate.
//
// Built only from what a report already records (where, which ordinance,
// its status, who filed it). It can't say whether a resolved report ended
// in a confirmed violation — Report has no outcome field — so "resolved"
// here means the report reached its final stage (Resolved or With
// Remarks), nothing more.
//
// createGeoAnalysis is the full panel on the Geospatial Analysis page
// (geo-analysis-page.js); renderGeoSummary is the short version beside the
// heatmap on the Reports Dashboard. Depends on heatmap.js (streetOf).

const GEO_OPEN_STATUSES = ["Submitted", "Under Review", "In Action"];
const GEO_STATUS_ORDER = ["Submitted", "Under Review", "In Action", "Resolved", "With Remarks"];
const GEO_ORDINANCE_ROWS = 6;

// Quotes too, not just what innerHTML escapes — street and ordinance text
// (typed by citizens/staff) also goes into title="" and data-* attributes.
function geoEscape(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// One decimal at most ("33.3%", "50%"); "—" when there's nothing to divide by.
function geoPct(part, whole) {
  if (!whole) return "—";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

function geoBarWidth(part, whole) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

function geoPlural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// The street a report is about: the known street its "Block, Lot, Street"
// location ends in, else the location text as typed.
function geoStreetOfReport(report) {
  const location = (report.location || "").trim();
  if (!location) return "Unspecified location";
  return streetOf(location) || location;
}

function geoCountBy(reports, keyOf) {
  const counts = new Map();
  reports.forEach((r) => {
    const key = keyOf(r);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function geoUniqueReporters(reports) {
  return new Set(reports.map((r) => r.reporterId || r.reporter)).size;
}

function geoResolvedCount(reports) {
  return reports.filter((r) => isReportClosed(r.status)).length;
}

// <li> rows of "label | bar | 12.5% (3)". With clickAttr (a data-* name)
// each row is a button carrying its name in that attribute.
function geoBreakdownRows(entries, whole, clickAttr, activeKey) {
  return entries
    .map(([name, count]) => {
      const attrs = clickAttr
        ? ` ${clickAttr}="${geoEscape(name)}" role="button" tabindex="0"${activeKey === name ? ' aria-pressed="true"' : ""}`
        : "";
      return `
      <li class="geo-row${clickAttr ? " geo-row--clickable" : ""}${activeKey === name ? " is-active" : ""}"${attrs}>
        <span class="geo-row__label" title="${geoEscape(name)}">${geoEscape(name)}</span>
        <span class="geo-row__track"><span class="geo-row__fill" style="width:${geoBarWidth(count, whole)}%"></span></span>
        <span class="geo-row__value"><b>${geoPct(count, whole)}</b> (${count})</span>
      </li>`;
    })
    .join("");
}

// el: the panel container. opts.categories: every ordinance category (so
// ones with no reports still get a 0% row). opts.onChange({ reports, street })
// fires whenever the category filter or selected street changes — `reports`
// is what the map should plot, `street` what it should ring (or null).
function createGeoAnalysis(el, opts = {}) {
  const categories = opts.categories || [];
  const onChange = typeof opts.onChange === "function" ? opts.onChange : () => {};

  let data = { reports: [], prevReports: null, registeredCitizens: null };
  const view = { category: null, street: null, sort: "reports", showAllOrdinances: false };

  function filteredReports() {
    return view.category ? data.reports.filter((r) => r.category === view.category) : data.reports;
  }

  function tile(label, value, note) {
    return `
      <div class="geo-tile">
        <span class="geo-tile__label">${label}</span>
        <span class="geo-tile__value">${value}</span>
        <span class="geo-tile__note">${note}</span>
      </div>`;
  }

  function summaryHtml(reports) {
    const total = reports.length;
    const resolved = geoResolvedCount(reports);
    const open = total - resolved;
    const reporters = geoUniqueReporters(reports);

    let filedNote;
    if (view.category) {
      filedNote = `<b>${geoPct(total, data.reports.length)}</b> of all ${geoPlural(data.reports.length, "report")} this period`;
    } else if (data.prevReports) {
      const prev = data.prevReports.length;
      if (!prev) filedNote = total ? "None in the previous period" : "Same as the previous period";
      else {
        const change = Math.round(((total - prev) / prev) * 1000) / 10;
        filedNote = `<b>${change >= 0 ? "▲" : "▼"} ${Math.abs(change)}%</b> vs previous period (${prev})`;
      }
    } else {
      filedNote = "In the selected period";
    }

    const registered = data.registeredCitizens;
    const reporterNote = registered
      ? `<b>${geoPct(reporters, registered)}</b> of ${geoPlural(registered, "registered citizen")}`
      : "Distinct citizens who filed";

    return `
      <div class="geo-tiles">
        ${tile("Reports filed", total, filedNote)}
        ${tile("Citizens who reported", reporters, reporterNote)}
        ${tile("Resolved/With Remarks", resolved, `<b>${geoPct(resolved, total)}</b> of reports filed`)}
        ${tile("Still open", open, `<b>${geoPct(open, total)}</b> of reports filed`)}
      </div>`;
  }

  // Two to five plain sentences read straight off the numbers below.
  function findingsHtml(reports) {
    const total = reports.length;
    if (!total) return "";
    const findings = [];

    const streets = geoCountBy(reports, geoStreetOfReport);
    const [topStreet, topStreetCount] = streets[0];
    findings.push(
      `<b>${geoEscape(topStreet)}</b> is the most-reported location with <b>${geoPct(topStreetCount, total)}</b> (${topStreetCount} of ${total}) of reports.`
    );

    const ordinances = geoCountBy(reports, (r) => r.ordinance || "Unspecified ordinance");
    const [topOrdinance, topOrdinanceCount] = ordinances[0];
    let ordinanceFinding = `The most-reported ordinance is <b>${geoEscape(topOrdinance)}</b> at <b>${geoPct(topOrdinanceCount, total)}</b> (${topOrdinanceCount} of ${total}).`;
    if (topOrdinanceCount > 1) {
      const where = geoCountBy(
        reports.filter((r) => (r.ordinance || "Unspecified ordinance") === topOrdinance),
        geoStreetOfReport
      )[0];
      ordinanceFinding += ` <b>${geoPct(where[1], topOrdinanceCount)}</b> (${where[1]} of ${topOrdinanceCount}) of those are on ${geoEscape(where[0])}.`;
    }
    findings.push(ordinanceFinding);

    if (!view.category) {
      const [topCategory, topCategoryCount] = geoCountBy(reports, (r) => r.category)[0];
      findings.push(
        `<b>${geoEscape(topCategory)}</b> is the leading category at <b>${geoPct(topCategoryCount, total)}</b> (${topCategoryCount} of ${total}).`
      );
    }

    const resolved = geoResolvedCount(reports);
    findings.push(
      `<b>${geoPct(resolved, total)}</b> (${resolved} of ${total}) of reports are Resolved/With Remarks; <b>${geoPct(total - resolved, total)}</b> (${total - resolved}) are still open.`
    );

    const perReporter = geoCountBy(reports, (r) => r.reporterId || r.reporter);
    const repeat = perReporter.filter(([, n]) => n > 1).length;
    findings.push(
      `${geoPlural(perReporter.length, "citizen")} filed these reports; <b>${geoPct(repeat, perReporter.length)}</b> (${repeat}) of them filed more than one.`
    );

    return `
      <section class="geo-section">
        <h3>Key findings</h3>
        <ul class="geo-findings">${findings.map((f) => `<li>${f}</li>`).join("")}</ul>
      </section>`;
  }

  function streetProfileHtml(reports) {
    if (!view.street) return "";
    const here = reports.filter((r) => geoStreetOfReport(r) === view.street);
    const total = here.length;
    const resolved = geoResolvedCount(here);
    const reporters = geoUniqueReporters(here);
    const allReporters = geoUniqueReporters(reports);
    const statusCounts = GEO_STATUS_ORDER.map((s) => [s, here.filter((r) => r.status === s).length]);

    return `
      <section class="geo-section geo-profile">
        <div class="geo-section__head">
          <h3>${geoEscape(view.street)}</h3>
          <button type="button" class="geo-link" data-geo-clear-street>&times; Back to all streets</button>
        </div>
        <div class="geo-tiles">
          ${tile("Reports here", total, `<b>${geoPct(total, reports.length)}</b> of all ${geoPlural(reports.length, "report")}`)}
          ${tile("Reporters", reporters, `<b>${geoPct(reporters, allReporters)}</b> of all ${geoPlural(allReporters, "reporter")}`)}
          ${tile("Resolved/With Remarks here", resolved, `<b>${geoPct(resolved, total)}</b> of this street's reports`)}
          ${tile("Still open here", total - resolved, `<b>${geoPct(total - resolved, total)}</b> of this street's reports`)}
        </div>
        <h4>Ordinances reported here <small>% of this street's reports</small></h4>
        <ul class="geo-rows">${geoBreakdownRows(geoCountBy(here, (r) => r.ordinance || "Unspecified ordinance"), total)}</ul>
        <h4>Categories here</h4>
        <ul class="geo-rows">${geoBreakdownRows(geoCountBy(here, (r) => r.category), total)}</ul>
        <h4>Status here</h4>
        <ul class="geo-rows">${geoBreakdownRows(statusCounts, total)}</ul>
      </section>`;
  }

  function streetsTableHtml(reports) {
    const total = reports.length;
    const rows = geoCountBy(reports, geoStreetOfReport).map(([street, count]) => {
      const here = reports.filter((r) => geoStreetOfReport(r) === street);
      const resolved = geoResolvedCount(here);
      const [topOrdinance, topOrdinanceCount] = geoCountBy(here, (r) => r.ordinance || "Unspecified ordinance")[0];
      return { street, count, resolved, rate: count ? resolved / count : 0, topOrdinance, topOrdinanceCount };
    });
    if (view.sort === "street") rows.sort((a, b) => a.street.localeCompare(b.street));
    else if (view.sort === "resolved") rows.sort((a, b) => b.rate - a.rate || b.count - a.count);

    const header = (key, label) =>
      `<th><button type="button" class="geo-sort${view.sort === key ? " is-active" : ""}" data-geo-sort="${key}">${label}${view.sort === key ? " ▾" : ""}</button></th>`;

    return `
      <section class="geo-section">
        <h3>Streets ranked <small>click a street to analyse it</small></h3>
        <div class="geo-table-wrap">
          <table class="geo-table">
            <thead>
              <tr>
                ${header("street", "Street")}
                ${header("reports", "Reports")}
                ${header("resolved", "Resolved/With Remarks")}
                <th>Top ordinance</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (row) => `
              <tr class="${view.street === row.street ? "is-active" : ""}" data-geo-street="${geoEscape(row.street)}" tabindex="0">
                <td>${geoEscape(row.street)}</td>
                <td><b>${geoPct(row.count, total)}</b> (${row.count})</td>
                <td><b>${geoPct(row.resolved, row.count)}</b> (${row.resolved})</td>
                <td title="${geoEscape(row.topOrdinance)}"><span class="geo-table__ordinance">${geoEscape(row.topOrdinance)}</span> <b>${geoPct(row.topOrdinanceCount, row.count)}</b> (${row.topOrdinanceCount})</td>
              </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
        <p class="geo-note">Reports: share of all reports shown. Resolved/With Remarks and Top ordinance: share of that street's own reports.</p>
      </section>`;
  }

  function categoriesHtml() {
    // Always against the whole period, not the filtered set, so the rows
    // still add up to 100% while one of them is selected as the filter.
    const total = data.reports.length;
    const counts = new Map(categories.map((c) => [c, 0]));
    data.reports.forEach((r) => counts.set(r.category, (counts.get(r.category) || 0) + 1));
    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return `
      <section class="geo-section">
        <div class="geo-section__head">
          <h3>By category <small>click one to filter the map</small></h3>
          ${view.category ? `<button type="button" class="geo-link" data-geo-clear-category>&times; Clear filter</button>` : ""}
        </div>
        <ul class="geo-rows">${geoBreakdownRows(entries, total, "data-geo-category", view.category)}</ul>
      </section>`;
  }

  function ordinancesHtml(reports) {
    const total = reports.length;
    const entries = geoCountBy(reports, (r) => r.ordinance || "Unspecified ordinance");
    const shown = view.showAllOrdinances ? entries : entries.slice(0, GEO_ORDINANCE_ROWS);
    return `
      <section class="geo-section">
        <h3>By ordinance <small>% of reports shown</small></h3>
        <ul class="geo-rows">${geoBreakdownRows(shown, total)}</ul>
        ${entries.length > GEO_ORDINANCE_ROWS
          ? `<button type="button" class="geo-link" data-geo-toggle-ordinances>${view.showAllOrdinances ? "Show fewer" : `Show all ${entries.length} ordinances`}</button>`
          : ""}
      </section>`;
  }

  function paint() {
    const reports = filteredReports();
    if (view.street && !reports.some((r) => geoStreetOfReport(r) === view.street)) view.street = null;

    if (!data.reports.length) {
      el.innerHTML = `<div class="ordinances-empty">No reports in this period to analyse.</div>`;
    } else {
      el.innerHTML = `
        ${view.category ? `<p class="geo-filter-chip">Showing only <b>${geoEscape(view.category)}</b> reports</p>` : ""}
        ${summaryHtml(reports)}
        ${streetProfileHtml(reports)}
        ${findingsHtml(reports)}
        ${reports.length ? streetsTableHtml(reports) : ""}
        ${categoriesHtml()}
        ${reports.length ? ordinancesHtml(reports) : ""}`;
    }
    onChange({ reports, street: view.street });
  }

  function activate(target) {
    const streetRow = target.closest("[data-geo-street]");
    const categoryRow = target.closest("[data-geo-category]");
    const sortBtn = target.closest("[data-geo-sort]");
    if (sortBtn) view.sort = sortBtn.dataset.geoSort;
    else if (streetRow) view.street = view.street === streetRow.dataset.geoStreet ? null : streetRow.dataset.geoStreet;
    else if (categoryRow) view.category = view.category === categoryRow.dataset.geoCategory ? null : categoryRow.dataset.geoCategory;
    else if (target.closest("[data-geo-clear-street]")) view.street = null;
    else if (target.closest("[data-geo-clear-category]")) view.category = null;
    else if (target.closest("[data-geo-toggle-ordinances]")) view.showAllOrdinances = !view.showAllOrdinances;
    else return false;
    paint();
    return true;
  }

  el.addEventListener("click", (e) => activate(e.target));
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches("[data-geo-street], [data-geo-category]") && activate(e.target)) e.preventDefault();
  });

  return {
    // next: { reports, prevReports (or null), registeredCitizens (or null) }
    update(next) {
      data = { ...data, ...next };
      paint();
    },
    // From a click on the map: opens that street's profile at the top.
    selectStreet(street) {
      view.street = street || null;
      paint();
      el.scrollTop = 0;
    },
  };
}

// The few figures shown beside the small heatmap on the Reports Dashboard —
// where reports cluster, what about, and how far along they are — with a
// link to the full Geospatial Analysis page for the same period.
function renderGeoSummary(el, { reports, registeredCitizens, href }) {
  const link = `<a class="btn geo-summary__link" href="${geoEscape(href)}">View full analysis &rarr;</a>`;
  const total = reports.length;
  if (!total) {
    el.innerHTML = `<p class="geo-summary__empty">No reports in this period.</p>${link}`;
    return;
  }
  const streets = geoCountBy(reports, geoStreetOfReport).slice(0, 3);
  const [topOrdinance, topOrdinanceCount] = geoCountBy(reports, (r) => r.ordinance || "Unspecified ordinance")[0];
  const resolved = geoResolvedCount(reports);
  const reporters = geoUniqueReporters(reports);
  el.innerHTML = `
    <h3>Top streets <small>% of ${geoPlural(total, "report")}</small></h3>
    <ul class="geo-rows">${geoBreakdownRows(streets, total)}</ul>
    <dl class="geo-summary__facts">
      <div>
        <dt>Most-reported ordinance</dt>
        <dd><span class="geo-summary__name" title="${geoEscape(topOrdinance)}">${geoEscape(topOrdinance)}</span><span><b>${geoPct(topOrdinanceCount, total)}</b> (${topOrdinanceCount})</span></dd>
      </div>
      <div>
        <dt>Resolution rate</dt>
        <dd><span><b>${geoPct(resolved, total)}</b> (${resolved} of ${total} Resolved/With Remarks)</span></dd>
      </div>
      <div>
        <dt>Citizens who reported</dt>
        <dd><span>${registeredCitizens
          ? `<b>${geoPct(reporters, registeredCitizens)}</b> of registered citizens (${reporters} of ${registeredCitizens})`
          : `<b>${reporters}</b>`}</span></dd>
      </div>
    </dl>
    ${link}`;
}
