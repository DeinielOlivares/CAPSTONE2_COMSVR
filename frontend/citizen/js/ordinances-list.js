// Ordinances page (citizen): search, filter, sort and page through the ordinances.

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("ordinanceRows");
  const filterField = document.getElementById("filterField");
  const sortSelect = document.getElementById("sortSelect");
  const searchInput = document.getElementById("ordinanceSearch");
  const searchForm = document.getElementById("ordinanceSearchForm");
  const paginationInfo = document.getElementById("paginationInfo");
  const pagination = document.getElementById("ordinancesPagination");
  const pageSizeSelect = document.getElementById("ordinancesPageSize");

  const memory = createFilterMemory("ordinances");
  memory.bindSelect(filterField);
  memory.bindSelect(sortSelect);
  memory.bindSelect(pageSizeSelect);

  let pageSize = pageSizeFrom(pageSizeSelect, 5);
  let currentPage = memory.get("page", 1);
  // The last searched text (the list only updates on Search / Enter).
  let appliedQuery = memory.get("query", "");
  let appliedField = memory.get("queryField", filterField.value);
  searchInput.value = appliedQuery;

  // The search box hint shows example words for the selected field, taken
  // from the loaded ordinances when possible.
  const PLACEHOLDER_FALLBACKS = {
    title: ["curfew", "business permit", "garbage"],
    number: ["No. 1-(2026)"],
    category: ["Public Order", "Business"],
  };

  function placeholderExamples(field) {
    if (field === "title") return PLACEHOLDER_FALLBACKS.title;
    const seen = [];
    for (const o of liveOrdinances()) {
      const value = String(o[field] || "").trim();
      if (value && value.length <= 30 && !seen.includes(value)) seen.push(value);
      if (seen.length === 2) break;
    }
    return seen.length ? seen : PLACEHOLDER_FALLBACKS[field] || [];
  }

  function updateSearchPlaceholder() {
    const examples = placeholderExamples(filterField.value);
    searchInput.placeholder = examples.length ? `e.g. ${examples.join(", ")}` : "Search...";
  }

  filterField.addEventListener("change", updateSearchPlaceholder);
  updateSearchPlaceholder();

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  tbody.innerHTML = skeletonTableRows(6, 2);
  try {
    await ensureOrdinancesLoaded();
    updateSearchPlaceholder();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2" class="ordinances-empty">${err.message}</td></tr>`;
    return;
  }

  const categoryFilter = new URLSearchParams(window.location.search).get("category");
  if (categoryFilter) {
    const banner = document.createElement("div");
    banner.className = "category-banner";
    banner.innerHTML = `Showing ordinances about <strong>${escapeHtml(categoryFilter)}</strong>. <a href="ordinances.html">Show all</a>`;
    document.querySelector(".ordinances-toolbar").before(banner);
  }

  function getFiltered() {
    let rows = liveOrdinances();
    if (categoryFilter) rows = rows.filter((o) => o.category === categoryFilter);
    if (appliedQuery) {
      rows = rows.filter((o) => String(o[appliedField] || "").toLowerCase().includes(appliedQuery));
    }
    rows = rows.slice().sort((a, b) =>
      sortSelect.value === "oldest"
        ? a.dateSort.localeCompare(b.dateSort)
        : b.dateSort.localeCompare(a.dateSort)
    );
    return rows;
  }

  function emptyMessage() {
    return liveOrdinances().length ? "No ordinances match your search." : "No ordinances have been posted yet.";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function render() {
    const allRows = getFiltered();
    const totalPages = pageSize ? Math.max(1, Math.ceil(allRows.length / pageSize)) : 1;
    currentPage = Math.min(currentPage, totalPages);
    memory.set("page", currentPage);

    const start = pageSize ? (currentPage - 1) * pageSize : 0;
    const rows = pageSize ? allRows.slice(start, start + pageSize) : allRows;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="2" class="ordinances-empty">${emptyMessage()}</td></tr>`;
    } else {
      tbody.innerHTML = rows
        .map(
          (o) => `
          <tr data-id="${o.id}" tabindex="0">
            <td data-label="No.">${escapeHtml(o.number)}</td>
            <td data-label="Title"><span class="ordinance-name">${escapeHtml(o.title)}</span></td>
          </tr>`
        )
        .join("");

      tbody.querySelectorAll("tr[data-id]").forEach((row) => {
        const goToDetail = () => {
          window.location.href = `ordinance-detail.html?id=${encodeURIComponent(row.dataset.id)}`;
        };
        row.addEventListener("click", goToDetail);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goToDetail();
          }
        });
      });
    }

    paginationInfo.textContent = allRows.length
      ? `Showing ${start + 1} to ${pageSize ? Math.min(start + pageSize, allRows.length) : allRows.length} of ${allRows.length} entries`
      : "Showing 0 entries";
    renderPaginationControls(pagination, currentPage, totalPages, (n) => {
      currentPage = n;
      render();
    });
  }

  // Search runs on the Search button / Enter, in the selected field only.
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    appliedField = filterField.value;
    appliedQuery = searchInput.value.trim().toLowerCase();
    memory.set("query", appliedQuery);
    memory.set("queryField", appliedField);
    currentPage = 1;
    render();
  });

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
      currentPage = 1;
      render();
    });
  }

  sortSelect.addEventListener("change", () => {
    currentPage = 1;
    render();
  });

  render();
});
