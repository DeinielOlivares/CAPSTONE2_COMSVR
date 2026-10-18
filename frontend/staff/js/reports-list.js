// Barangay Platero OVRMS — Reports Management: search + filter (type/status) +
// paginate across real reports from reports-data.js (GET /api/reports/staff/).
// Reports is the Investigator's claimable work queue — see reports-data.js's
// claimReport. Claims are permanent (no forfeiting), so claiming confirms first.
// Split into subpages from the sidebar's Reports group (?view= — see
// REPORT_VIEWS below): All Reports, Unclaimed Reports, My Claimed Reports.

// Each subpage is this same page showing some of its three lists (Claimed
// by Me / Unclaimed / Claimed by Others). "mine" is Investigator-only
// (hidden from the sidebar for anyone else, see admin.js's
// STAFF_NAV_ACCESS) and falls back to "all" for other roles. `paginated` is
// the list the page's pagination bar pages through.
const REPORT_VIEWS = {
  all: { heading: "All Reports", groups: ["mine", "unclaimed", "others"], paginated: "unclaimed" },
  unclaimed: { heading: "Unclaimed Reports", groups: ["unclaimed"], paginated: "unclaimed" },
  mine: { heading: "My Claimed Reports", groups: ["mine"], paginated: "mine" },
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
  const listMine = document.getElementById("reportsListMine");
  const listUnclaimed = document.getElementById("reportsListUnclaimed");
  const listOthers = document.getElementById("reportsListOthers");
  const groupMine = document.getElementById("reportsGroupMine");
  const groupUnclaimed = document.getElementById("reportsGroupUnclaimed");
  const groupOthers = document.getElementById("reportsGroupOthers");
  const groupOthersTitle = document.getElementById("reportsGroupOthersTitle");
  const pagination = document.getElementById("reportsPagination");
  const pageSizeSelect = document.getElementById("reportsPageSize");

  const currentUser = getAdminUser();
  // Claiming is Investigator-only (same rule as report-detail.js and
  // the backend's IsInvestigatorOrAdmin) — Barangay Captain can reach this
  // page but only gets a read-only view of who's working what.
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

  const showMine = isInvestigator && view.groups.includes("mine");
  groupMine.hidden = !showMine;
  groupUnclaimed.hidden = !view.groups.includes("unclaimed");
  groupOthers.hidden = !view.groups.includes("others");

  let page = 1;
  // Only re-filters on Search (or pressing Enter in the field), not on every
  // keystroke — this tracks the query that was actually searched for.
  let appliedQuery = "";

  listMine.innerHTML = skeletonCards(2);
  listUnclaimed.innerHTML = skeletonCards(3);
  listOthers.innerHTML = skeletonCards(2);
  try {
    await ensureOrdinancesLoaded();
    await ensureReportsLoaded();
  } catch (err) {
    const target = showMine && !view.groups.includes("unclaimed") ? listMine : listUnclaimed;
    [listMine, listUnclaimed, listOthers].forEach((list) => (list.innerHTML = ""));
    target.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
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

  // Filters, search, page size and page survive opening a report and coming
  // back, or visiting other pages, for the rest of this browser tab.
  // sessionStorage (not localStorage) so they reset with a fresh tab; keyed
  // per user and subpage so someone else signing in on the same tab starts
  // clean, and each subpage keeps its own.
  const filtersKey = `orms_reports_filters_${currentUser?.id ?? "anon"}_${viewKey}`;

  function saveFilters() {
    try {
      sessionStorage.setItem(filtersKey, JSON.stringify({
        type: typeFilter.value,
        status: statusFilter.value,
        pageSize: pageSizeSelect ? pageSizeSelect.value : null,
        query: appliedQuery,
        page,
      }));
    } catch {
      // Storage unavailable (private mode, blocked) — filters just won't persist.
    }
  }

  function restoreFilters() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(filtersKey));
    } catch {
      return;
    }
    if (!saved) return;
    // Only restore a select's value if that option still exists — e.g. the
    // saved ordinance type may no longer appear in any report.
    const setIfOption = (select, value) => {
      if (select && Array.from(select.options).some((o) => o.value === value)) select.value = value;
    };
    setIfOption(typeFilter, saved.type);
    setIfOption(statusFilter, saved.status);
    setIfOption(pageSizeSelect, saved.pageSize);
    if (pageSizeSelect) pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
    appliedQuery = saved.query || "";
    searchInput.value = appliedQuery;
    page = Number(saved.page) || 1;
  }
  restoreFilters();

  const badgeClass = REPORT_STATUS_BADGE_CLASS;

  function getFiltered() {
    let rows = liveReports();

    if (typeFilter.value !== "all") {
      rows = rows.filter((r) => r.incidentType === typeFilter.value);
    }

    if (statusFilter.value !== "all") {
      rows = rows.filter((r) => r.status === statusFilter.value);
    } else {
      // "all": every status shows, ranked New Submission > Under Review >
      // In Action > Resolved/With Remarks, newest first within each group —
      // so a backlog of old closed reports doesn't bury what's still active.
      rows = sortReportsByStatusThenDate(rows);
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

  function reportRow(r, { claimLabel, claimAction }) {
    return `
        <div class="report-row">
          <div class="report-row__top">
            <span class="concern-row__title">${r.incidentType}</span>
            <span class="concern-row__date">${formatReportDate(r.dateSubmitted)}</span>
            <a class="concern-row__link" href="report-detail.html?id=${encodeURIComponent(r.id)}">View Details</a>
            <span class="status-badge ${badgeClass[r.status] || ""}">${r.status}</span>
          </div>
          <div class="report-row__claim">
            <span>${claimLabel}</span>
            ${claimAction}
          </div>
        </div>`;
  }

  function renderGroup(container, rows, emptyMessage, rowFn) {
    container.innerHTML = rows.length
      ? rows.map(rowFn).join("")
      : `<div class="ordinances-empty">${emptyMessage}</div>`;
  }

  function wireClaimButtons(container) {
    container.querySelectorAll("[data-claim]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!await siteConfirm(CLAIM_CONFIRM_MESSAGE, CLAIM_CONFIRM_OPTIONS)) return;
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
  }

  function paginate(rows) {
    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    return { totalPages, pageRows: pageSize ? rows.slice(start, start + pageSize) : rows };
  }

  function render() {
    const rows = getFiltered();

    // Three lists inside one card — the investigator's own claimed work,
    // then the unclaimed queue, then other investigators' claims — so their
    // own work doesn't get lost among everyone else's.
    const groups = { mine: [], unclaimed: [], others: [] };
    rows.forEach((r) => {
      if (!r.assignedInvestigatorId) groups.unclaimed.push(r);
      else if (currentUser && r.assignedInvestigatorId === currentUser.id) groups.mine.push(r);
      else groups.others.push(r);
    });

    // Only this subpage's main list is paginated (the Unclaimed queue on
    // All Reports) — it's the one that can grow into an actual queue;
    // claimed work shown alongside it is naturally bounded per person.
    const { totalPages, pageRows } = paginate(groups[view.paginated]);
    const shown = (key) => (key === view.paginated ? pageRows : groups[key]);

    groupOthersTitle.textContent = isInvestigator ? "Claimed by Other Investigators" : "Claimed Reports";

    if (showMine) {
      renderGroup(listMine, shown("mine"), "You haven't claimed any reports that match.", (r) =>
        reportRow(r, { claimLabel: "Claimed by you", claimAction: "" })
      );
    }

    if (!groupUnclaimed.hidden) {
      renderGroup(
        listUnclaimed,
        shown("unclaimed"),
        liveReports().length ? "No unclaimed reports match your search or filters." : "No reports submitted yet.",
        (r) =>
          reportRow(r, {
            claimLabel: "Unclaimed",
            claimAction: isInvestigator
              ? `<button type="button" class="btn report-row__claim-btn" data-claim="${r.id}">Claim</button>`
              : "",
          })
      );
      wireClaimButtons(listUnclaimed);
    }

    if (!groupOthers.hidden) {
      renderGroup(
        listOthers,
        shown("others"),
        isInvestigator ? "No reports claimed by other investigators." : "No claimed reports.",
        (r) => reportRow(r, { claimLabel: `Claimed by ${escapeReportHtml(r.assignedInvestigator)}`, claimAction: "" })
      );
    }

    renderPaginationControls(pagination, page, totalPages, (n) => {
      page = n;
      render();
    });
    // Every filter, search, Clear and page change ends up here, so this one
    // call keeps the saved state current.
    saveFilters();
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
