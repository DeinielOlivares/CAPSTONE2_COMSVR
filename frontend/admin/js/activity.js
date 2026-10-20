// Barangay Platero OVRMS — Activity: per-citizen report and suggestion counts for the
// Administrator, built from the same account list Manage Accounts uses (see
// AdminAccountSerializer's reportStats / suggestionStats).

document.addEventListener("DOMContentLoaded", async () => {
  const totalsEl = document.getElementById("activityTotals");
  const bodyEl = document.getElementById("activityBody");

  function escape(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function count(stats, key) {
    return (stats && stats.byStatus && stats.byStatus[key]) || 0;
  }

  function tally(citizens) {
    const totals = { filed: 0, awaiting: 0, inProgress: 0, resolved: 0, withRemarks: 0, suggestions: 0 };
    citizens.forEach((c) => {
      totals.filed += (c.reportStats && c.reportStats.total) || 0;
      totals.awaiting += count(c.reportStats, "submitted");
      totals.inProgress += count(c.reportStats, "under_review") + count(c.reportStats, "in_action");
      totals.resolved += count(c.reportStats, "resolved");
      totals.withRemarks += count(c.reportStats, "with_remarks");
      totals.suggestions += (c.suggestionStats && c.suggestionStats.total) || 0;
    });
    return totals;
  }

  try {
    const response = await authFetch("/api/auth/admin/users/");
    if (!response.ok) throw new Error("Could not load activity.");
    const citizens = (await response.json()).filter((a) => a.reportStats !== null && a.reportStats !== undefined);

    const totals = tally(citizens);
    totalsEl.innerHTML = [
      ["Reports filed", totals.filed],
      ["Awaiting review", totals.awaiting],
      ["In progress", totals.inProgress],
      ["Resolved", totals.resolved],
      ["With Remarks", totals.withRemarks],
      ["Suggestions", totals.suggestions],
    ]
      .map(([label, value]) => `<div class="activity-total"><span class="activity-total__value">${value}</span><span class="activity-total__label">${label}</span></div>`)
      .join("");

    const rows = citizens
      .slice()
      .sort((a, b) => ((b.reportStats && b.reportStats.total) || 0) - ((a.reportStats && a.reportStats.total) || 0));
    bodyEl.innerHTML = rows.length
      ? rows
          .map(
            (c) => `
          <tr>
            <td>${escape(c.owner)}<br><small>${escape(c.email)}</small></td>
            <td>${(c.reportStats && c.reportStats.total) || 0}</td>
            <td>${count(c.reportStats, "submitted")}</td>
            <td>${count(c.reportStats, "under_review") + count(c.reportStats, "in_action")}</td>
            <td>${count(c.reportStats, "resolved")}</td>
            <td>${count(c.reportStats, "with_remarks")}</td>
            <td>${(c.suggestionStats && c.suggestionStats.total) || 0}</td>
          </tr>`
          )
          .join("")
      : `<tr><td colspan="7" class="admin-table__empty">No citizen accounts yet.</td></tr>`;
  } catch (err) {
    bodyEl.innerHTML = `<tr><td colspan="7" class="admin-table__empty">${escape(err.message)}</td></tr>`;
  }
});
