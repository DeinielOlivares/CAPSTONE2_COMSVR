// Barangay Platero OVRMS — Reports Management: search + filter (type/date/status) +
// paginate across real reports from reports-data.js (GET /api/reports/staff/).
// Reports is the Investigator's claimable work queue — see reports-data.js's
// claimReport. Claims are permanent (no forfeiting), so claiming confirms first.

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
  const dateFrom = document.getElementById("dateFrom");
  const dateTo = document.getElementById("dateTo");
  // Reports can't be filtered into a future that hasn't happened yet.
  const todayStr = new Date().toLocaleDateString("en-CA");
  dateFrom.max = todayStr;
  dateTo.max = todayStr;
  const dateRangeClear = document.getElementById("dateRangeClear");
  const statusFilter = document.getElementById("statusFilter");
  const listMine = document.getElementById("reportsListMine");
  const listUnclaimed = document.getElementById("reportsListUnclaimed");
  const listOthers = document.getElementById("reportsListOthers");
  const groupMine = document.getElementById("reportsGroupMine");
  const groupOthersTitle = document.getElementById("reportsGroupOthersTitle");
  const pagination = document.getElementById("reportsPagination");
  const pageSizeSelect = document.getElementById("reportsPageSize");

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
    listUnclaimed.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    listMine.innerHTML = "";
    listOthers.innerHTML = "";
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
  // per user so someone else signing in on the same tab starts clean.
  const filtersKey = `orms_reports_filters_${getAdminUser()?.id ?? "anon"}`;

  function saveFilters() {
    try {
      sessionStorage.setItem(filtersKey, JSON.stringify({
        type: typeFilter.value,
        status: statusFilter.value,
        dateFrom: dateFrom.value,
        dateTo: dateTo.value,
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
    if (saved.dateFrom && saved.dateFrom <= todayStr) dateFrom.value = saved.dateFrom;
    if (saved.dateTo && saved.dateTo <= todayStr) dateTo.value = saved.dateTo;
    appliedQuery = saved.query || "";
    searchInput.value = appliedQuery;
    page = Number(saved.page) || 1;
  }
  restoreFilters();

  const badgeClass = {
    "New Submission": "status-badge--submitted",
    "Under Review": "status-badge--in-process",
    "In Action": "status-badge--with-remarks",
    Resolved: "status-badge--resolved",
  };

  function getFiltered() {
    let rows;
    if (!dateFrom.value && !dateTo.value) {
      // No check-in/check-out picked: no date restriction either — with the
      // Status filter defaulting to "all" (see reports.html), that's just
      // every report, ordered by the priority sort below.
      rows = liveReports();
    } else {
      rows = liveReports().filter((r) => {
        if (dateFrom.value && r.dateSubmitted < new Date(`${dateFrom.value}T00:00:00`)) return false;
        if (dateTo.value && r.dateSubmitted > new Date(`${dateTo.value}T23:59:59`)) return false;
        return true;
      });
    }

    if (typeFilter.value !== "all") {
      rows = rows.filter((r) => r.incidentType === typeFilter.value);
    }

    if (statusFilter.value !== "all") {
      rows = rows.filter((r) => r.status === statusFilter.value);
    } else {
      // "all": every status shows, ranked New Submission > Under Review >
      // In Action > Resolved, newest first within each group — so a backlog
      // of old resolved reports doesn't bury what's still active.
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
            <span class="status-badge ${badgeClass[r.status]}">${r.status}</span>
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

  function render() {
    const rows = getFiltered();
    const currentUser = getAdminUser();
    // Claiming is Investigator-only (same rule as report-detail.js and
    // the backend's IsInvestigatorOrAdmin) — Barangay Captain can reach this
    // page but only gets a read-only view of who's working what.
    const isInvestigator = currentUser && currentUser.position === "Investigator";

    // Three lists inside one card — the investigator's own claimed work,
    // then the unclaimed queue, then other investigators' claims — so their
    // own work doesn't get lost among everyone else's.
    const mine = [];
    const unclaimed = [];
    const others = [];
    rows.forEach((r) => {
      if (!r.assignedInvestigatorId) unclaimed.push(r);
      else if (currentUser && r.assignedInvestigatorId === currentUser.id) mine.push(r);
      else others.push(r);
    });

    groupMine.hidden = !isInvestigator;
    groupOthersTitle.textContent = isInvestigator ? "Claimed by Other Investigators" : "Claimed Reports";

    if (isInvestigator) {
      renderGroup(listMine, mine, "You haven't claimed any reports yet.", (r) =>
        reportRow(r, { claimLabel: "Claimed by you", claimAction: "" })
      );
    }

    // Only the Unclaimed list is paginated — it's the one that can grow
    // into an actual queue; claimed work is naturally bounded per person.
    const totalPages = pageSize ? Math.max(1, Math.ceil(unclaimed.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? unclaimed.slice(start, start + pageSize) : unclaimed;

    renderGroup(
      listUnclaimed,
      pageRows,
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

    renderGroup(
      listOthers,
      others,
      isInvestigator ? "No reports claimed by other investigators." : "No claimed reports.",
      (r) => reportRow(r, { claimLabel: `Claimed by ${escapeReportHtml(r.assignedInvestigator)}`, claimAction: "" })
    );

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
  dateFrom.addEventListener("change", () => {
    // Check-in can't land after check-out — keep the range sane instead of
    // silently returning zero results.
    if (dateTo.value && dateFrom.value > dateTo.value) dateTo.value = dateFrom.value;
    page = 1;
    render();
  });
  dateTo.addEventListener("change", () => {
    if (dateFrom.value && dateTo.value < dateFrom.value) dateFrom.value = dateTo.value;
    page = 1;
    render();
  });
  dateRangeClear.addEventListener("click", () => {
    dateFrom.value = "";
    dateTo.value = "";
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

  // Bundles whatever the current filters/search match into one combined PDF
  // (see reports/pdf.py's build_reports_pdf) — only the Resolved ones among
  // them actually make it in (no "final verdict" yet otherwise), which is
  // exactly what the button's own label says, so there's no need for a
  // separate warning when some get left out.
  const downloadResolvedBtn = document.getElementById("downloadResolvedBtn");
  if (downloadResolvedBtn) {
    downloadResolvedBtn.addEventListener("click", async () => {
      const ids = getFiltered().map((r) => r.id);
      if (!ids.length) {
        siteAlert("No reports match the current filters.");
        return;
      }
      downloadResolvedBtn.disabled = true;
      downloadResolvedBtn.textContent = "Preparing...";
      try {
        const response = await authFetch("/api/reports/staff/pdf-bulk/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.detail || "Could not download the PDF.");
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filenameFromResponse(response, "resolved-reports.pdf");
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        siteAlert(err.message);
      } finally {
        downloadResolvedBtn.disabled = false;
        downloadResolvedBtn.textContent = "Download Resolved Reports (PDF)";
      }
    });
  }

  render();
});
