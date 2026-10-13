// Barangay Platero OVRMS — My Concerns/Suggestions: render + filter the citizen's
// submitted list by status, paginated. Data comes from the real API (see
// my-concerns-data.js) instead of a hardcoded array, so this file is async
// where it fetches concerns.

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const list = document.getElementById("concernsList");
  const statusFilter = document.getElementById("statusFilter");
  const pagination = document.getElementById("concernsPagination");
  const pageSizeSelect = document.getElementById("concernsPageSize");

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  // There's no separate title/category field on Submit Suggestion — it's
  // just a free-text description — so the list row's "title" is a
  // truncated snippet of that text, same idea as an email client deriving
  // a preview line when there's no subject.
  function titleFor(description) {
    return description.length > 60 ? `${description.slice(0, 60)}…` : description;
  }

  let concerns = [];
  let page = 1;
  // Default display order when both statuses are showing: Submitted first,
  // Reviewed last — newest first within each status.
  function getFiltered() {
    const filterValue = statusFilter.value;
    const rows = concerns.filter((c) => {
      const label = c.status === "reviewed" ? "Reviewed" : "Submitted";
      return filterValue === "All" || label === filterValue;
    });
    return rows.slice().sort((a, b) => {
      const rankA = a.status === "reviewed" ? 1 : 0;
      const rankB = b.status === "reviewed" ? 1 : 0;
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
          .map(
            (c) => `
      <div class="concern-row">
        <span class="concern-row__title">${titleFor(c.description)}</span>
        <span class="concern-row__date">${formatDate(c.created_at)}</span>
        <a class="concern-row__link" href="my-concern-detail.html?id=${encodeURIComponent(c.id)}">View Details</a>
        <span class="status-badge ${c.status === "reviewed" ? "status-badge--resolved" : "status-badge--submitted"}">Status: ${c.status === "reviewed" ? "Reviewed" : "Submitted"}</span>
      </div>`
          )
          .join("")
      : `<div class="ordinances-empty">${concerns.length ? "No concerns/suggestions match this status." : "You haven't submitted any concerns or suggestions yet."}</div>`;

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
    concerns = await getMyConcerns();
    render();
  } catch (err) {
    list.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
  }
});
