// Barangay Platero OVRMS — Ordinances list: search, paginate, render, navigate to
// detail, plus uploading (Secretary/Admin — see ordinances-data.js's
// isDocumentManager).

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
  // Only re-filters on Search (or pressing Enter in the field), not on every
  // keystroke — this tracks the query that was actually searched for, kept
  // separate from whatever's currently typed in the box.
  let appliedQuery = memory.get("query", "");
  let appliedField = memory.get("queryField", filterField.value);
  searchInput.value = appliedQuery;

<<<<<<< HEAD
    return getOrdinances().filter((o) => {
      return (
        !query ||
        o.title.toLowerCase().includes(query) ||
        o.author.toLowerCase().includes(query) ||
        o.number.toLowerCase().includes(query)
      );
    });
=======
  // Search box placeholder follows the selected filter, suggesting example
  // keywords for that field. Author/No./Category examples are pulled from the
  // loaded ordinances so they always match real data; the static lists are
  // just the fallback while loading (or when there's nothing loaded yet).
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
>>>>>>> 4bd403fa8b958eb6c00c605f8ebfcc15fba528e1
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

  function getFiltered() {
    let rows = liveOrdinances();
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
    return liveOrdinances().length ? "No ordinances match your search." : "No ordinances uploaded yet.";
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
            <td>${escapeHtml(o.number)}</td>
            <td><span class="ordinance-name">${escapeHtml(o.title)}</span></td>
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

  // Only actually filters when Search is pressed (or Enter in the field) —
  // not on every keystroke — and only searches whichever single field is
  // selected, not every column at once.
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

<<<<<<< HEAD
  // Upload Ordinance popup
  const uploadBtn = document.getElementById("uploadOrdinanceBtn");
  const uploadModal = document.getElementById("uploadOrdinanceModal");
  const uploadForm = document.getElementById("uploadOrdinanceForm");
  const uploadedModal = document.getElementById("ordinanceUploadedModal");
  const uploadedConfirm = document.getElementById("ordinanceUploadedConfirm");

  const pdfInput = document.getElementById("ordPdf");
  const pdfFileName = document.getElementById("ordPdfFileName");
  const defaultPdfText = pdfFileName.textContent;
  pdfInput.addEventListener("change", () => {
    const file = pdfInput.files[0];
    pdfFileName.textContent = file ? file.name : defaultPdfText;
  });

  uploadBtn.addEventListener("click", () => {
    uploadForm.reset();
    pdfFileName.textContent = defaultPdfText;
    uploadModal.hidden = false;
  });

  uploadForm.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!uploadForm.reportValidity()) return;

    addOrdinance({
      number: document.getElementById("ordNumber").value.trim(),
      title: document.getElementById("ordTitle").value.trim(),
      author: document.getElementById("ordAuthor").value.trim(),
      category: document.getElementById("ordCategory").value.trim(),
      dateApproved: document.getElementById("ordDate").value,
      description: document.getElementById("ordDescription").value.trim(),
      pdf: pdfInput.files[0] ? pdfInput.files[0].name : "#",
    });

    uploadModal.hidden = true;
    uploadedModal.hidden = false;
  });

  uploadedConfirm.addEventListener("click", () => {
    uploadedModal.hidden = true;
    currentPage = 1;
    render();
  });
=======
  // ---- Upload FAB ----
  // Secretary/Admin only; everyone else with access here views only (the
  // server enforces this too — see OrdinanceListCreateView).
  const uploadBtn = document.getElementById("uploadOrdinanceBtn");
  uploadBtn.hidden = !isDocumentManager(getAdminUser());
>>>>>>> 4bd403fa8b958eb6c00c605f8ebfcc15fba528e1
});
