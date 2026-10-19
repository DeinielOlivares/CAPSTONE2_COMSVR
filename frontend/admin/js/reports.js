// Reports (admin): every unclaimed report, oldest first, with "Assign to
// Investigator" on each row, plus each Investigator's current workload.

const REPORT_STATUS_LABEL = {
  submitted: "New Submission",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};

const REPORT_STATUS_BADGE_CLASS = {
  submitted: "status-badge--submitted",
  under_review: "status-badge--in-process",
  in_action: "status-badge--with-remarks",
  resolved: "status-badge--resolved",
  with_remarks: "status-badge--remarked",
};

// Resolved and With Remarks both close a report.
const CLOSED_REPORT_STATUSES = ["resolved", "with_remarks"];

// The open statuses shown in the workload bars (same colors as the staff dashboard).
const WORKLOAD_STATUSES = [
  { key: "submitted", label: "Submitted", color: "#9aa0a6" },
  { key: "under_review", label: "Under Review", color: "#e8c547" },
  { key: "in_action", label: "In Action", color: "#a8c957" },
];

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("unclaimedReportsBody");
  const pagination = document.getElementById("unclaimedReportsPagination");
  const workloadEl = document.getElementById("investigatorWorkload");

  const PAGE_SIZE = 10;
  let reports = [];
  let allReports = [];
  let investigators = [];
  let page = 1;

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  }

  async function loadData() {
    tbody.innerHTML = skeletonTableRows(5, 5);
    try {
      const [reportsRes, usersRes] = await Promise.all([
        authFetch("/api/reports/staff/"),
        authFetch("/api/auth/admin/users/"),
      ]);
      if (!reportsRes.ok) throw new Error("Could not load reports.");
      allReports = await reportsRes.json();
      reports = allReports
        .filter((r) => !r.assignedInvestigatorId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      investigators = usersRes.ok
        ? (await usersRes.json()).filter((u) => u.position === "Investigator" && u.active)
        : [];

      renderInvestigatorWorkload();
      render();
    } catch (err) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="5">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  // One bar per active Investigator: their open claimed reports, by status.
  function renderInvestigatorWorkload() {
    if (!workloadEl) return;
    if (!investigators.length) {
      workloadEl.innerHTML = `<p class="investigator-workload__empty">No active Investigators.</p>`;
      return;
    }

    const sortedInvestigators = investigators.slice().sort((a, b) => a.owner.localeCompare(b.owner));

    workloadEl.innerHTML = sortedInvestigators
      .map((inv) => {
        const current = allReports.filter((r) => r.assignedInvestigatorId === inv.id && !CLOSED_REPORT_STATUSES.includes(r.status));
        const total = current.length;

        if (!total) {
          return `
            <div class="investigator-workload__card">
              <div class="investigator-workload__header">
                <span class="investigator-workload__name">${escapeHtml(inv.owner)}</span>
              </div>
              <p class="investigator-workload__empty">No active reports.</p>
            </div>`;
        }

        const segments = WORKLOAD_STATUSES.map((s) => {
          const count = current.filter((r) => r.status === s.key).length;
          const pct = Math.round((count / total) * 100);
          return { ...s, count, pct };
        }).filter((s) => s.count > 0);

        const bars = segments
          .map(
            (s) => `
            <div
              class="stacked-bar__segment"
              style="width:${s.pct}%;background:${s.color};"
              title="${escapeHtml(s.label)}: ${s.pct}% (${s.count} ${s.count === 1 ? "report" : "reports"})"
              role="img"
              aria-label="${escapeHtml(s.label)}: ${s.pct}% — ${s.count} ${s.count === 1 ? "report" : "reports"}"
            >
              <span class="stacked-bar__label">${s.pct}% (${s.count})</span>
            </div>`
          )
          .join("");

        return `
          <div class="investigator-workload__card">
            <div class="investigator-workload__header">
              <span class="investigator-workload__name">${escapeHtml(inv.owner)}</span>
              <span class="investigator-workload__total">${total} active ${total === 1 ? "report" : "reports"}</span>
            </div>
            <div class="stacked-bar">${bars}</div>
          </div>`;
      })
      .join("");
  }

  function assignControlHtml(report) {
    if (!investigators.length) {
      return `<span style="color:var(--text-muted);">No active Investigators</span>`;
    }
    return `
      <div class="assign-row">
        <select data-assign-select="${report.id}">
          ${investigators.map((inv) => `<option value="${inv.id}">${escapeHtml(inv.owner)}</option>`).join("")}
        </select>
        <button type="button" class="btn btn-muted" data-assign-btn="${report.id}">Assign</button>
      </div>`;
  }

  function render() {
    const rows = reports;

    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    page = Math.min(page, totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    renderPaginationControls(pagination, page, totalPages, (n) => {
      page = n;
      render();
    });

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="5">No unclaimed reports.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageRows
      .map(
        (r) => `
        <tr>
          <td class="admin-table__ellipsis" title="${escapeHtml(r.reporter)}">${escapeHtml(r.reporter)}</td>
          <td class="admin-table__ellipsis" title="${escapeHtml(r.ordinance)}">${escapeHtml(r.ordinance)}</td>
          <td>${formatDate(r.created_at)}</td>
          <td><span class="status-badge ${REPORT_STATUS_BADGE_CLASS[r.status] || ""}">${escapeHtml(REPORT_STATUS_LABEL[r.status] || r.status)}</span></td>
          <td>${assignControlHtml(r)}</td>
        </tr>`
      )
      .join("");

    tbody.querySelectorAll("[data-assign-btn]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const reportId = btn.dataset.assignBtn;
        const select = tbody.querySelector(`[data-assign-select="${reportId}"]`);
        const investigatorId = select.value;
        const investigatorName = select.options[select.selectedIndex].textContent;
        if (!(await siteConfirm(`Assign this report to ${investigatorName}?`))) return;

        btn.disabled = true;
        try {
          const response = await authFetch(`/api/reports/staff/${encodeURIComponent(reportId)}/assign/`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ investigator_id: investigatorId }),
          });
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.detail || "Could not assign this report.");
          }
          reports = reports.filter((r) => r.id !== reportId);
          const assigned = allReports.find((r) => r.id === reportId);
          if (assigned) assigned.assignedInvestigatorId = investigatorId;
          renderInvestigatorWorkload();
          render();
        } catch (err) {
          siteAlert(err.message);
          btn.disabled = false;
        }
      });
    });
  }

  await loadData();
});
