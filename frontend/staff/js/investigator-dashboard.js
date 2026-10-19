// Investigator Dashboard: the logged-in Investigator's own claimed reports,
// plus how many reports are still unclaimed (no date filter).

document.addEventListener("DOMContentLoaded", async () => {
  const AGING_LIST_LIMIT = 8;
  const MAX_BAR_HEIGHT = 168; // px — matches reports-dashboard.js's status chart

  const dashboardMain = document.querySelector(".admin-content");
  const currentUser = getCurrentUser();

  try {
    await ensureReportsLoaded();
  } catch (err) {
    if (dashboardMain) {
      dashboardMain.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    }
    return;
  }

  function statusPillClass(status) {
    return REPORT_STATUS_PILL_CLASS[status] || "status-pill--new";
  }

  // Report Timeline age coloring: 0-5 days green, 6-10 yellow, 11-15 orange, 16+ red.
  function agingPillClass(days) {
    if (days <= 5) return "aging-pill--green";
    if (days <= 10) return "aging-pill--yellow";
    if (days <= 15) return "aging-pill--orange";
    return "aging-pill--red";
  }

  function daysBetween(from, to) {
    return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
  }

  const myId = currentUser && currentUser.id;
  const myReports = () => liveReports().filter((r) => r.assignedInvestigatorId === myId);
  const unclaimedReports = () => liveReports().filter((r) => !r.assignedInvestigatorId && !isReportClosed(r.status));

  // ---- Stat cards ----

  function renderStats() {
    const mine = myReports();
    const active = mine.filter((r) => !isReportClosed(r.status));
    // Closed cases — Resolved or With Remarks.
    const resolved = mine.filter((r) => isReportClosed(r.status));

    document.getElementById("statMyActive").textContent = active.length;
    document.getElementById("statMyResolved").textContent = resolved.length;
    document.getElementById("statUnclaimed").textContent = unclaimedReports().length;

    const oldest = active.slice().sort((a, b) => a.dateSubmitted - b.dateSubmitted)[0];
    document.getElementById("statOldestCase").textContent = oldest
      ? `${daysBetween(oldest.dateSubmitted, new Date())} days`
      : "—";
  }

  // ---- My Reports by Status ----

  const STATUS_BAR_DEFS = [
    { label: "New Submission", modifier: "new" },
    { label: "Under Review", modifier: "process" },
    { label: "In Action", modifier: "remarks" },
    { label: "Resolved", modifier: "resolved" },
    { label: "With Remarks", modifier: "remarked" },
  ];

  function renderStatusChart() {
    const chart = document.getElementById("myStatusBarChart");
    const mine = myReports();
    if (!mine.length) {
      chart.innerHTML = `<div class="status-bar-chart__empty">You haven't claimed any reports yet.</div>`;
      return;
    }

    const counts = { "New Submission": 0, "Under Review": 0, "In Action": 0, Resolved: 0, "With Remarks": 0 };
    mine.forEach((r) => {
      if (counts[r.status] !== undefined) counts[r.status]++;
    });
    const maxCount = Math.max(...Object.values(counts), 1);

    chart.innerHTML = STATUS_BAR_DEFS.map(({ label, modifier }) => {
      const count = counts[label];
      const height = Math.max(Math.round((count / maxCount) * MAX_BAR_HEIGHT), count > 0 ? 6 : 2);
      return `
        <div class="status-bar-chart__col">
          <span class="status-bar-chart__count">${count}</span>
          <div class="status-bar-chart__bar status-bar-chart__bar--${modifier}" style="height:${height}px"></div>
          <span class="status-bar-chart__label">${label}</span>
        </div>`;
    }).join("");
  }

  // ---- Report Timeline (mine) ----

  function renderAgingList() {
    const body = document.getElementById("myAgingReportsBody");
    const now = new Date();
    const open = myReports()
      .filter((r) => !isReportClosed(r.status))
      .slice()
      .sort((a, b) => a.dateSubmitted - b.dateSubmitted)
      .slice(0, AGING_LIST_LIMIT);

    body.innerHTML = open.length
      ? open
          .map((r) => {
            const days = daysBetween(r.dateSubmitted, now);
            return `
        <tr data-id="${r.id}">
          <td>${r.location || "—"}</td>
          <td><span class="status-pill ${agingPillClass(days)}">${days} ${days === 1 ? "day" : "days"}</span></td>
          <td><span class="status-pill ${statusPillClass(r.status)}">${r.status}</span></td>
          <td><a class="recent-reports-table__view-btn" href="report-detail.html?id=${encodeURIComponent(r.id)}">View Details</a></td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="4" class="ordinances-empty">Nothing open on your plate right now.</td></tr>`;

    // On phones the whole row opens the report.
    body.querySelectorAll("tr[data-id]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("a")) return;
        window.location.href = `report-detail.html?id=${encodeURIComponent(row.dataset.id)}`;
      });
    });
  }

  renderStats();
  renderStatusChart();
  renderAgingList();
});
