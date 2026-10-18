// Barangay Platero OVRMS — Reports Management: search + filter (type/status) +
// paginate across real reports from reports-data.js (GET /api/reports/staff/).
// Reports is the Investigator's claimable work queue — see reports-data.js's
// claimReport. Claims are permanent (no forfeiting), so claiming confirms first.
// Split into subpages from the sidebar's Reports group (?view= — see
// REPORT_VIEWS below): All Reports, Unclaimed Reports, My Claimed Reports.

// Each subpage is this same page narrowed to a subset of reports. "mine"
// is Investigator-only (hidden from the sidebar for anyone else, see
// admin.js's STAFF_NAV_ACCESS) and falls back to "all" for other roles.
const REPORT_VIEWS = {
  all: { heading: "All Reports", filter: () => true },
  unclaimed: { heading: "Unclaimed Reports", filter: (r) => !r.assignedInvestigatorId },
  mine: { heading: "My Claimed Reports", filter: (r, user) => !!user && r.assignedInvestigatorId === user.id },
};

function escapeReportHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const searchForm = document.getElementById("reportSearchForm");
  const searchInput = document.getElementById("reportSearchInput");
  const typeFilter = document.getElementById("typeFilter");
  const statusFilter = document.getElementById("statusFilter");
  const list = document.getElementById("reportsList");
  const pagination = document.getElementById("reportsPagination");
  const pageSizeSelect = document.getElementById("reportsPageSize");

  const currentUser = getAdminUser();
  const isInvestigator = !!currentUser && currentUser.position === "Investigator";
  let viewKey = new URLSearchParams(window.location.search).get("view") || "all";
  if (!REPORT_VIEWS[viewKey] || (viewKey === "mine" && !isInvestigator)) viewKey = "all";
  const view = REPORT_VIEWS[viewKey];

  document.getElementById("reportsHeading").textContent = view.heading;
  document.title = `Barangay Platero OVRMS — ${view.heading}`;
  // Highlight this subpage in the sidebar's Reports group.
  const activeHref = viewKey === "all" ? "reports.html" : `reports.html?view=${viewKey}`;
  document.querySelectorAll(".admin-sidebar__subnav a").forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === activeHref);
  });
  // A claimed report is past Submitted soon after, so My Claimed Reports
  // shows every status by default rather than the page's usual Submitted —
  // made the HTML default too, so the panel's Clear button resets to it.
  if (viewKey === "mine") {
    statusFilter.querySelectorAll("option").forEach((o) => {
      o.selected = o.value === "all";
      o.toggleAttribute("selected", o.value === "all");
    });
  }

  let page = 1;
  // Only re-filters on Search (or pressing Enter in the field), not on every
  // keystroke — this tracks the query that was actually searched for.
  let appliedQuery = "";

  list.innerHTML = `<div class="ordinances-empty">Loading reports...</div>`;
  try {
    await ensureOrdinancesLoaded();
    await ensureReportsLoaded();
  } catch (err) {
    list.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    return;
  }

  // No fixed category list anymore (that was mock data) — the type filter
  // now only ever offers ordinances that actually appear in real reports.
  Array.from(new Set(liveReports().map((r) => r.incidentType)))
    .sort()
    .forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = type;
      typeFilter.appendChild(opt);
    });

  const badgeClass = REPORT_STATUS_BADGE_CLASS;

  function viewReports() {
    return liveReports().filter((r) => view.filter(r, currentUser));
  }

  function getFiltered() {
    let rows = viewReports();

    if (typeFilter.value !== "all") {
      rows = rows.filter((r) => r.incidentType === typeFilter.value);
    }

    if (statusFilter.value !== "all") {
      rows = rows.filter((r) => r.status === statusFilter.value);
    } else {
      // "all": every status shows, but ranked so whatever isn't closed yet
      // (Submitted/Under Review/In Action) comes ahead of Resolved/With
      // Remarks reports, newest first within each group — so a backlog of
      // old closed reports doesn't bury what's still active.
      rows = rows.slice().sort((a, b) => {
        const aResolved = isReportClosed(a.status) ? 1 : 0;
        const bResolved = isReportClosed(b.status) ? 1 : 0;
        if (aResolved !== bResolved) return aResolved - bResolved;
        return b.dateSubmitted - a.dateSubmitted;
      });
    }

    if (appliedQuery) {
      rows = rows.filter(
        (r) =>
          r.incidentType.toLowerCase().includes(appliedQuery) ||
          r.location.toLowerCase().includes(appliedQuery) ||
          r.reporter.toLowerCase().includes(appliedQuery)
      );
    }

    return rows;
  }

  function render() {
    const rows = getFiltered();
    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    // Claiming is Investigator-only (same rule as report-detail.js and
    // the backend's IsInvestigatorOrAdmin) — Barangay Captain can reach this
    // page but only gets a read-only view of who's working what.

    list.innerHTML = pageRows.length
      ? pageRows
          .map((r) => {
            const isMine = r.assignedInvestigatorId && currentUser && r.assignedInvestigatorId === currentUser.id;
            const claimLabel = r.assignedInvestigator
              ? `Claimed by ${isMine ? "you" : escapeReportHtml(r.assignedInvestigator)}`
              : "Unclaimed";
            const claimAction =
              isInvestigator && !r.assignedInvestigator
                ? `<button type="button" class="btn report-row__claim-btn" data-claim="${r.id}">Claim</button>`
                : "";
            return `
        <div class="report-row">
          <div class="report-row__top">
            <span class="concern-row__title">${r.incidentType}</span>
            <span class="concern-row__date">${formatReportDate(r.dateSubmitted)}</span>
            <a class="concern-row__link" href="report-detail.html?id=${encodeURIComponent(r.id)}">View Details</a>
            <span class="status-badge ${badgeClass[r.status]}">${r.status}</span>
          </div>
          <div class="report-row__claim">
            <span>${claimLabel}</span>
            ${claimAction}
          </div>
        </div>`;
          })
          .join("")
      : `<div class="ordinances-empty">${viewReports().length ? "No reports match your search or filters." : "No reports here yet."}</div>`;

    list.querySelectorAll("[data-claim]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await siteConfirm(CLAIM_CONFIRM_MESSAGE)) return;
        btn.disabled = true;
        try {
          await claimReport(btn.dataset.claim);
          render();
        } catch (err) {
          siteAlert(err.message);
          btn.disabled = false;
        }
      });
    });

    renderPaginationControls(pagination, page, totalPages, (n) => {
      page = n;
      render();
    });
  }

  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    appliedQuery = searchInput.value.trim().toLowerCase();
    page = 1;
    render();
  });
  typeFilter.addEventListener("change", () => {
    page = 1;
    render();
  });
  statusFilter.addEventListener("change", () => {
    page = 1;
    render();
  });

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
      page = 1;
      render();
    });
  }

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  render();
});
