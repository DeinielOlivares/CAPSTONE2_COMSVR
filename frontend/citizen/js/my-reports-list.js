// Barangay Platero OVRMS — My Reports: render + filter the citizen's submitted reports by
// status, paginated. Data now comes from the real API (see
// my-reports-data.js) instead of a hardcoded array, so this file is async
// where it fetches reports.

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const list = document.getElementById("reportsList");
  const statusFilter = document.getElementById("statusFilter");
  const pagination = document.getElementById("reportsPagination");
  const pageSizeSelect = document.getElementById("reportsPageSize");

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  const badgeClass = {
    Submitted: "status-badge--submitted",
    "Under Review": "status-badge--in-process",
    "In Action": "status-badge--with-remarks",
    Resolved: "status-badge--resolved",
  };

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  function daysOld(iso) {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso)) / (1000 * 60 * 60 * 24)));
    return `${days} ${days === 1 ? "day" : "days"} old`;
  }

  let reports = [];
  let page = 1;

  // Default display order when more than one status is showing: Submitted,
  // then Under Review, then In Action, with Resolved last — newest first
  // within each status. "All" really means all: Resolved used to be hidden
  // until the filter was touched, which left a citizen whose reports were
  // all resolved looking at "No reports match this status." under "All".
  const STATUS_RANK = { Submitted: 0, "Under Review": 1, "In Action": 2, Resolved: 3 };

  function getFiltered() {
    const filterValue = statusFilter.value;
    const rows = reports.filter((r) => {
      const label = REPORT_STATUS_LABELS[r.status] || r.status;
      return filterValue === "All" || label === filterValue;
    });
    return rows.slice().sort((a, b) => {
      const rankA = STATUS_RANK[REPORT_STATUS_LABELS[a.status] || a.status] ?? 99;
      const rankB = STATUS_RANK[REPORT_STATUS_LABELS[b.status] || b.status] ?? 99;
      if (rankA !== rankB) return rankA - rankB;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }

  function render() {
    const rows = getFiltered();
    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    list.innerHTML = pageRows.length
      ? pageRows
          .map((r) => {
            const label = REPORT_STATUS_LABELS[r.status] || r.status;
            return `
        <div class="concern-row">
          <span class="concern-row__title">${r.ordinance}</span>
          <span class="concern-row__date">${daysOld(r.created_at)}</span>
          <span class="concern-row__handler">${r.claimed_by ? `Handled by ${r.claimed_by}` : "Not yet claimed"}</span>
          <a class="concern-row__link" href="my-report-detail.html?id=${encodeURIComponent(r.id)}">View Details</a>
          <span class="status-badge ${badgeClass[label] || ""}">Status: ${label}</span>
        </div>`;
          })
          .join("")
      : `<div class="ordinances-empty">${
          reports.length
            ? "No reports match this status."
            : `You haven't filed any reports yet. <a href="file-report.html">File a report</a>`
        }</div>`;

    if (pagination) {
      renderPaginationControls(pagination, page, totalPages, (n) => {
        page = n;
        render();
      });
    }
  }

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

  list.innerHTML = skeletonCards(4);
  try {
    reports = await getMyReports();
    render();
  } catch (err) {
    list.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
  }
});
