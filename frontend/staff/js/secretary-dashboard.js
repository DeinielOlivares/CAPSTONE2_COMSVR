// Secretary Dashboard: today's workload — concerns/suggestions, ordinances
// and citizen questions (no date filter).

document.addEventListener("DOMContentLoaded", async () => {
  const AGING_LIST_LIMIT = 8;
  const FOLDER_COLOR_PALETTE = [
    "#5b7fd1", "#2fd6c4", "#d13ec4", "#e8a33d",
    "#6fcf5b", "#e85b5b", "#8a6fd1", "#3ba3c9",
    "#c9a227", "#5b8c5a", "#d1667f", "#4a6fa5",
    "#e0824a", "#7b5ea7", "#3c9d8f", "#b25a9e",
  ];

  const dashboardMain = document.querySelector(".admin-content");

  let questions = [];
  try {
    const [, , loadedQuestions] = await Promise.all([
      ensureConcernsLoaded(),
      ensureFoldersLoaded(),
      getQuestions(),
      ensureOrdinancesLoaded(),
    ]);
    questions = loadedQuestions;
  } catch (err) {
    if (dashboardMain) {
      dashboardMain.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    }
    return;
  }

  function daysBetween(from, to) {
    return Math.max(0, Math.floor((to - from) / (1000 * 60 * 60 * 24)));
  }

  // Each folder's color, by its position in liveFolders().
  const FOLDER_COLOR_BY_ID = new Map(
    liveFolders().map((f, i) => [f.id, FOLDER_COLOR_PALETTE[i % FOLDER_COLOR_PALETTE.length]])
  );

  function folderColor(id) {
    return FOLDER_COLOR_BY_ID.get(id) || FOLDER_COLOR_PALETTE[0];
  }

  // ---- Stat cards ----

  function renderStats() {
    const concerns = liveConcerns();
    document.getElementById("statOpenConcerns").textContent = concerns.filter((c) => c.status === "Submitted").length;
    document.getElementById("statResolvedConcerns").textContent = concerns.filter((c) => c.status === "Reviewed").length;
    document.getElementById("statUnansweredQuestions").textContent = questions.filter((q) => !q.is_answered).length;
    document.getElementById("statActiveOrdinances").textContent = liveOrdinances().filter((o) => !o.isArchived).length;
  }

  // ---- Concerns by Folder pie (all concerns) ----

  function countByFolder(concerns) {
    const counts = {};
    liveFolders().forEach((f) => (counts[f.id] = 0));
    concerns.forEach((c) => {
      if (c.folderId) counts[c.folderId] = (counts[c.folderId] || 0) + 1;
    });
    return counts;
  }

  function renderCategoryPie() {
    const categoryPie = document.getElementById("categoryPie");
    const categoryLegend = document.getElementById("categoryLegend");
    const folders = liveFolders();
    categoryPie.querySelectorAll(".pie-chart__label, .pie-chart__empty").forEach((el) => el.remove());

    if (!folders.length) {
      categoryPie.style.background = "var(--border)";
      categoryPie.insertAdjacentHTML("beforeend", `<div class="pie-chart__empty">No categories yet — create one on Concerns/Suggestions.</div>`);
      categoryLegend.innerHTML = "";
      return;
    }

    const counts = countByFolder(liveConcerns());
    const total = folders.reduce((sum, f) => sum + (counts[f.id] || 0), 0) || 1;

    let cumRaw = 0;
    const stops = [];
    const labels = [];
    folders.forEach((f) => {
      const startB = Math.round(cumRaw * 100);
      cumRaw += (counts[f.id] || 0) / total;
      const endB = Math.round(cumRaw * 100);
      stops.push(`${folderColor(f.id)} ${startB}% ${endB}%`);
      if (endB > startB) labels.push({ mid: (startB + endB) / 2, pct: endB - startB });
    });

    categoryPie.style.background = `conic-gradient(${stops.join(", ")})`;

    const R = 30;
    labels.forEach(({ mid, pct }) => {
      const theta = (mid / 100) * 2 * Math.PI;
      const x = 50 + R * Math.sin(theta);
      const y = 50 - R * Math.cos(theta);
      const span = document.createElement("span");
      span.className = "pie-chart__label";
      span.style.left = `${x}%`;
      span.style.top = `${y}%`;
      span.textContent = `${pct}%`;
      categoryPie.appendChild(span);
    });

    // Only folders that have concerns.
    categoryLegend.innerHTML = folders
      .filter((f) => (counts[f.id] || 0) > 0)
      .map((f) => `<li title="${f.name} (${counts[f.id] || 0})"><span class="pie-legend__dot" style="background:${folderColor(f.id)}"></span><span class="pie-legend__label">${f.name} (${counts[f.id] || 0})</span></li>`)
      .join("");
  }

  // ---- Oldest Open Concerns ----

  function renderAgingList() {
    const body = document.getElementById("agingConcernsBody");
    const now = new Date();
    const open = liveConcerns()
      .filter((c) => c.status === "Submitted")
      .slice()
      .sort((a, b) => a.dateSubmitted - b.dateSubmitted)
      .slice(0, AGING_LIST_LIMIT);

    body.innerHTML = open.length
      ? open
          .map((c) => {
            const days = daysBetween(c.dateSubmitted, now);
            return `
        <tr>
          <td>${c.folderName || "Uncategorized"}</td>
          <td>${days} ${days === 1 ? "day" : "days"}</td>
          <td><a class="recent-reports-table__view-btn" href="concern-detail.html?id=${encodeURIComponent(c.id)}">View Details</a></td>
        </tr>`;
          })
          .join("")
      : `<tr><td colspan="3" class="ordinances-empty">Nothing open — every concern has been reviewed.</td></tr>`;
  }

  renderStats();
  renderCategoryPie();
  renderAgingList();
});
