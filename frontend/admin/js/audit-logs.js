// Barangay Platero OVRMS — View Audit Logs: render + search + sort + filter every logged
// action (not just login/logout — see AuditLog/log_action on the backend).
// Data comes from the real API (see audit-log-data.js).

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const tbody = document.getElementById("auditTableBody");
  const sortSelect = document.getElementById("sortSelect");
  const typeFilter = document.getElementById("typeFilter");
  const searchForm = document.getElementById("auditSearchForm");
  const searchInput = document.getElementById("auditSearchInput");
  const pagination = document.getElementById("auditPagination");
  const pageSizeSelect = document.getElementById("auditPageSize");

  const memory = createFilterMemory("audit_logs");
  memory.bindSelect(sortSelect);
  memory.bindSelect(typeFilter);
  memory.bindSelect(pageSizeSelect);
  pageSize = pageSizeFrom(pageSizeSelect, pageSize);

  let logs = [];
  let page = memory.get("page", 1);
  let currentPageRows = [];
  // Only re-filters on Search (or pressing Enter in the field), not on every
  // keystroke — this tracks the query that was actually searched for.
  let appliedQuery = memory.get("query", "");
  searchInput.value = appliedQuery;

  async function loadLogs() {
    tbody.innerHTML = skeletonTableRows(6, 5);
    try {
      logs = await getAuditLogs();
      render();
    } catch (err) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="5">${err.message}</td></tr>`;
    }
  }

  function render() {
    const filterValue = typeFilter.value;
    let rows = logs.filter((a) => filterValue === "all" || accountTypeGroup(a.type) === filterValue);

    if (appliedQuery) {
      rows = rows.filter(
        (a) =>
          a.owner.toLowerCase().includes(appliedQuery) ||
          a.action.toLowerCase().includes(appliedQuery) ||
          a.timeLabel.toLowerCase().includes(appliedQuery) ||
          a.type.toLowerCase().includes(appliedQuery) ||
          (a.ipAddress || "").toLowerCase().includes(appliedQuery)
      );
    }

    const sortValue = sortSelect.value;
    rows = rows.slice().sort((a, b) => {
      if (sortValue === "owner") return a.owner.localeCompare(b.owner);
      if (sortValue === "owner_desc") return b.owner.localeCompare(a.owner);
      if (sortValue === "time_asc") return new Date(a.timeAt) - new Date(b.timeAt);
      return new Date(b.timeAt) - new Date(a.timeAt);
    });

    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    memory.set("page", page);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    if (pagination) {
      renderPaginationControls(pagination, page, totalPages, (n) => {
        page = n;
        render();
      });
    }

    currentPageRows = pageRows;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="5">No logs match this filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageRows
      .map(
        (a, i) => `
        <tr data-row-index="${i}">
          <td>${a.owner}</td>
          <td>${a.type}</td>
          <td>${a.timeLabel}</td>
          <td>${a.ipAddress || "—"}</td>
          <td>${a.action}</td>
        </tr>`
      )
      .join("");
  }

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  // ---- Mobile row-tap details (Owner/Type are hidden on mobile
  // — see the 860px breakpoint in style.css, which keeps only Time/Date and
  // Action visible) — tapping a row shows everything in one popup instead. ----
  let logDetailModal = null;

  function ensureLogDetailModal() {
    if (logDetailModal) return logDetailModal;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay log-detail-modal";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="modal-card">
        <button type="button" class="modal-close" aria-label="Close">&times;</button>
        <h2>Log Details</h2>
        <dl class="edit-account-card__details">
          <div class="edit-account-card__row"><dt>Account Owner</dt><dd id="logDetailOwner"></dd></div>
          <div class="edit-account-card__row"><dt>Account Type</dt><dd id="logDetailType"></dd></div>
          <div class="edit-account-card__row"><dt>Time/Date</dt><dd id="logDetailTime"></dd></div>
          <div class="edit-account-card__row"><dt>IP Address</dt><dd id="logDetailIp"></dd></div>
          <div class="edit-account-card__row"><dt>Action</dt><dd id="logDetailAction"></dd></div>
        </dl>
      </div>
    `;
    document.body.appendChild(overlay);
    const closeModal = () => { overlay.hidden = true; };
    overlay.querySelector(".modal-close").addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    logDetailModal = overlay;
    return overlay;
  }

  function openLogDetail(log) {
    const overlay = ensureLogDetailModal();
    overlay.querySelector("#logDetailOwner").textContent = log.owner;
    overlay.querySelector("#logDetailType").textContent = log.type;
    overlay.querySelector("#logDetailTime").textContent = log.timeLabel;
    overlay.querySelector("#logDetailIp").textContent = log.ipAddress || "—";
    overlay.querySelector("#logDetailAction").textContent = log.action;
    overlay.hidden = false;
  }

  tbody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-row-index]");
    if (!row) return;
    const log = currentPageRows[Number(row.dataset.rowIndex)];
    if (log) openLogDetail(log);
  });

  sortSelect.addEventListener("change", () => {
    page = 1;
    render();
  });
  typeFilter.addEventListener("change", () => {
    page = 1;
    render();
  });
  searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    appliedQuery = searchInput.value.trim().toLowerCase();
    memory.set("query", appliedQuery);
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

  await loadLogs();
});
