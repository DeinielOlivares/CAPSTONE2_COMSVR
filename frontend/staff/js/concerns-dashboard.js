// Barangay Platero OVRMS — Concerns/Suggestions Dashboard (Barangay Captain, read-only).
//
// An oversight view rather than a work queue (that's the Secretary's
// concerns.html): what residents are raising, whether it's being answered,
// and what needs following up. One period selector drives every section.
// "Topic" is the folder the Secretary files a concern under (see
// concerns-data.js); "reviewed" timing uses Concern.reviewed_at.

document.addEventListener("DOMContentLoaded", async () => {
  const OVERDUE_DAYS = 7;
  const TOP_ROWS = 6;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTHS_BACK_COUNT = 5;
  const QUARTERS_BACK_COUNT = 3;
  const YEARS_BACK_COUNT = 2;

  const state = { period: "month0" };

  const dashboardMain = document.querySelector(".admin-content");

  try {
    await Promise.all([ensureConcernsLoaded(), ensureFoldersLoaded()]);
  } catch (err) {
    if (dashboardMain) dashboardMain.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
    return;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text == null ? "" : String(text);
    return div.innerHTML;
  }

  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

  // ---- Periods ----
  // Same range of choices as the Reports Dashboard's date filter (This
  // Week, This Month + previous months, This Quarter + previous quarters,
  // This Year + previous years). periodRanges() returns the current range,
  // the one before it (for "vs last ..."), and the buckets the trend chart
  // plots; periodMeta() returns the noun used in sentences like "Received
  // this month" / "Received in August 2026".

  function buildPeriodOptions() {
    const opts = [{ value: "week", label: "This Week" }];
    for (let m = 0; m <= MONTHS_BACK_COUNT; m++) {
      const { start } = getMonthRange(m);
      opts.push({
        value: `month${m}`,
        label: m === 0 ? "This Month" : start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      });
    }
    for (let q = 0; q <= QUARTERS_BACK_COUNT; q++) {
      const { quarter, year } = getQuarterRange(q);
      opts.push({ value: `quarter${q}`, label: q === 0 ? `This Quarter (Q${quarter} ${year})` : `Q${quarter} ${year}` });
    }
    for (let y = 0; y <= YEARS_BACK_COUNT; y++) {
      const { year } = getYearRange(y);
      opts.push({ value: `year${y}`, label: y === 0 ? `This Year (${year})` : `${year}` });
    }
    opts.push({ value: "all", label: "All Time" });
    return opts;
  }

  function periodMeta(period) {
    if (period === "week") return { noun: "this week", previous: "last week" };
    const [, kind, nStr] = period.match(/^(month|quarter|year)(\d+)$/);
    const n = Number(nStr);
    if (n === 0) return { noun: `this ${kind}`, previous: `last ${kind}` };
    if (kind === "month") {
      const label = (back) => getMonthRange(back).start.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      return { noun: `in ${label(n)}`, previous: `in ${label(n + 1)}` };
    }
    if (kind === "quarter") {
      const label = (back) => {
        const r = getQuarterRange(back);
        return `Q${r.quarter} ${r.year}`;
      };
      return { noun: `in ${label(n)}`, previous: `in ${label(n + 1)}` };
    }
    const label = (back) => String(getYearRange(back).year);
    return { noun: `in ${label(n)}`, previous: `in ${label(n + 1)}` };
  }

  function periodRanges(period) {
    if (period === "week") {
      const start = THIS_WEEK_START;
      return {
        start,
        end: endOfDay(addDays(start, 6)),
        prevStart: addDays(start, -7),
        prevEnd: endOfDay(addDays(start, -1)),
        buckets: Array.from({ length: 7 }, (_, i) => {
          const day = addDays(start, i);
          return {
            start: day,
            end: endOfDay(day),
            label: day.toLocaleDateString("en-US", { weekday: "short" }),
            title: day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
          };
        }),
      };
    }

    const [, kind, nStr] = period.match(/^(month|quarter|year)(\d+)$/);
    const n = Number(nStr);

    if (kind === "month") {
      const { start, end } = getMonthRange(n);
      const prev = getMonthRange(n + 1);
      const days = end.getDate();
      return {
        start,
        end: endOfDay(end),
        prevStart: prev.start,
        prevEnd: endOfDay(prev.end),
        buckets: Array.from({ length: days }, (_, i) => {
          const day = new Date(start.getFullYear(), start.getMonth(), i + 1);
          return {
            start: day,
            end: endOfDay(day),
            // Every 5th day labelled so 30 ticks don't collide.
            label: i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : "",
            title: day.toLocaleDateString("en-US", { month: "long", day: "numeric" }),
          };
        }),
      };
    }

    if (kind === "quarter") {
      const { start, end, quarter, year } = getQuarterRange(n);
      const prev = getQuarterRange(n + 1);
      const firstMonth = (quarter - 1) * 3;
      return {
        start,
        end: endOfDay(end),
        prevStart: prev.start,
        prevEnd: endOfDay(prev.end),
        buckets: Array.from({ length: 3 }, (_, i) => {
          const first = new Date(year, firstMonth + i, 1);
          return {
            start: first,
            end: endOfDay(new Date(year, firstMonth + i + 1, 0)),
            label: first.toLocaleDateString("en-US", { month: "short" }),
            title: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
          };
        }),
      };
    }

    const { start, end, year } = getYearRange(n);
    const prev = getYearRange(n + 1);
    return {
      start,
      end: endOfDay(end),
      prevStart: prev.start,
      prevEnd: endOfDay(prev.end),
      buckets: Array.from({ length: 12 }, (_, m) => {
        const first = new Date(year, m, 1);
        return {
          start: first,
          end: endOfDay(new Date(year, m + 1, 0)),
          label: first.toLocaleDateString("en-US", { month: "short" }),
          title: first.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        };
      }),
    };
  }

  const within = (date, start, end) => !!date && date >= start && date <= end;

  // ---- Period dropdown ----

  const periodDropdown = document.getElementById("periodDropdown");
  const periodBtn = document.getElementById("periodBtn");
  const periodMenu = document.getElementById("periodMenu");
  const periodLabel = document.getElementById("periodLabel");

  periodBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    periodMenu.hidden = !periodMenu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!periodDropdown.contains(e.target)) periodMenu.hidden = true;
  });

  function renderPeriodMenu() {
    const opts = buildPeriodOptions();
    const current = opts.find((o) => o.value === state.period);
    periodLabel.textContent = current ? current.label : "";
    periodMenu.innerHTML = opts
      .map((o) => `<li data-period="${o.value}" class="${o.value === state.period ? "active" : ""}">${o.label}</li>`)
      .join("");
    periodMenu.querySelectorAll("li").forEach((li) => {
      li.addEventListener("click", () => {
        state.period = li.dataset.period;
        periodMenu.hidden = true;
        renderAll();
      });
    });
  }

  // ---- Headline numbers ----

  function formatDuration(ms) {
    const hours = ms / (60 * 60 * 1000);
    if (hours < 1) return "Under 1 hour";
    if (hours < 24) return plural(Math.round(hours), "hour");
    return plural(Math.round(hours / 24), "day");
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  // "▲ 6 vs last month" — plain text plus an arrow, never colour alone.
  function deltaText(current, previous, previousNoun) {
    const diff = current - previous;
    if (diff === 0) return `Same as ${previousNoun}`;
    return `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)} vs ${previousNoun}`;
  }

  function renderKpis(ctx) {
    const { received, previousReceived, reviewedInPeriod, waiting, meta } = ctx;

    document.getElementById("kpiReceivedLabel").textContent = `Received ${meta.noun}`;
    document.getElementById("kpiReceived").textContent = received.length;
    document.getElementById("kpiReceivedNote").textContent = deltaText(received.length, previousReceived.length, meta.previous);

    // The backlog is "right now", not tied to the selected period — a
    // concern from two months ago that's still unread is still waiting.
    document.getElementById("kpiWaiting").textContent = waiting.length;
    const oldest = waiting.reduce((min, c) => (!min || c.dateSubmitted < min.dateSubmitted ? c : min), null);
    document.getElementById("kpiWaitingNote").textContent = oldest
      ? `Oldest has waited ${formatDuration(Date.now() - oldest.dateSubmitted)}`
      : "Nothing waiting";

    document.getElementById("kpiReviewedLabel").textContent = `Reviewed ${meta.noun}`;
    document.getElementById("kpiReviewed").textContent = reviewedInPeriod.length;
    const receivedAndReviewed = received.filter((c) => c.status === "Reviewed").length;
    document.getElementById("kpiReviewedNote").textContent = received.length
      ? `${Math.round((receivedAndReviewed / received.length) * 100)}% of those received ${meta.noun}`
      : `Nothing received ${meta.noun}`;

    const typical = median(reviewedInPeriod.map((c) => c.dateReviewed - c.dateSubmitted).filter((ms) => ms >= 0));
    document.getElementById("kpiTime").textContent = typical === null ? "—" : formatDuration(typical);
    document.getElementById("kpiTimeNote").textContent =
      typical === null ? `Nothing reviewed ${meta.noun}` : `Half were reviewed faster than this`;
  }

  // ---- Horizontal bar lists (topics, streets) ----
  // One hue: these compare a magnitude across categories, and the name is
  // written beside each bar, so colour doesn't need to identify anything.

  function renderBars(container, rows, emptyMessage) {
    if (!rows.length) {
      container.innerHTML = `<p class="cd-empty">${emptyMessage}</p>`;
      return;
    }
    const max = Math.max(...rows.map((r) => r.count), 1);
    container.innerHTML = `<ul class="cd-bars">${rows
      .map(
        (r) => `
        <li class="cd-bars__row${r.muted ? " cd-bars__row--muted" : ""}" title="${escapeHtml(r.title || "")}">
          <span class="cd-bars__name">${escapeHtml(r.name)}</span>
          <span class="cd-bars__track"><span class="cd-bars__fill" style="width: ${Math.max((r.count / max) * 100, 2)}%"></span></span>
          <span class="cd-bars__count">${r.count}</span>
          <span class="cd-bars__delta">${r.delta || ""}</span>
        </li>`
      )
      .join("")}</ul>`;
  }

  function countBy(concerns, keyFn) {
    const counts = new Map();
    concerns.forEach((c) => {
      const key = keyFn(c);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }

  function topicDelta(current, previous) {
    const diff = current - previous;
    if (diff === 0) return "";
    return `${diff > 0 ? "▲" : "▼"} ${Math.abs(diff)}`;
  }

  function renderTopics(ctx) {
    const { received, previousReceived, meta } = ctx;
    const now = countBy(received, (c) => c.folderName);
    const before = countBy(previousReceived, (c) => c.folderName);

    const rows = Array.from(now.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_ROWS)
      .map(([name, count]) => ({
        name,
        count,
        delta: topicDelta(count, before.get(name) || 0),
        title: `${name}: ${count} ${meta.noun}, ${before.get(name) || 0} ${meta.previous}`,
      }));

    const noTopic = received.filter((c) => !c.folderName).length;
    if (noTopic) {
      rows.push({ name: "No topic yet", count: noTopic, muted: true, title: "Not yet filed under a topic by the Secretary" });
    }

    document.getElementById("topicsHint").textContent = rows.length ? `▲▼ change vs ${meta.previous}` : "";
    renderBars(document.getElementById("topicBars"), rows, `No concerns or suggestions received ${meta.noun}.`);
    return { now, before };
  }

  // Location is optional free text on a concern; when it follows the
  // "Block X, Lot Y, <Street>" pattern the street is the last part.
  function streetOf(location) {
    const text = (location || "").trim();
    if (!text) return null;
    const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] || null;
  }

  function renderStreets(ctx) {
    const { received, meta } = ctx;
    const counts = countBy(received, (c) => streetOf(c.location));
    const rows = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOP_ROWS - 1)
      .map(([name, count]) => ({ name, count }));
    const located = received.filter((c) => streetOf(c.location)).length;

    document.getElementById("streetsHint").textContent = received.length
      ? `${located} of ${received.length} gave a location`
      : "";
    renderBars(
      document.getElementById("streetBars"),
      rows,
      received.length ? `None of the concerns received ${meta.noun} included a location.` : `Nothing received ${meta.noun}.`
    );
  }

  // ---- Needs attention ----

  function renderAttention(ctx, topics) {
    const { waiting, meta } = ctx;
    const flags = [];

    const overdue = waiting
      .filter((c) => Date.now() - c.dateSubmitted > OVERDUE_DAYS * DAY_MS)
      .sort((a, b) => a.dateSubmitted - b.dateSubmitted);
    if (overdue.length) {
      flags.push({
        level: "warn",
        text: `${plural(overdue.length, "concern")} ${overdue.length === 1 ? "has" : "have"} waited more than ${OVERDUE_DAYS} days for review.`,
        link: `concern-detail.html?id=${encodeURIComponent(overdue[0].id)}`,
        linkText: "Open the oldest",
      });
    }

    // A topic that at least doubled and grew by 2 or more — small wobbles
    // (1 → 2) aren't worth the Captain's attention.
    let jump = null;
    topics.now.forEach((count, name) => {
      const before = topics.before.get(name) || 0;
      const diff = count - before;
      if (diff >= 2 && count >= before * 2 && (!jump || diff > jump.diff)) jump = { name, count, before, diff };
    });
    if (jump) {
      flags.push({
        level: "warn",
        text: `"${jump.name}" is rising: ${jump.count} ${meta.noun}, up from ${jump.before} ${meta.previous}.`,
      });
    }

    const noTopic = waiting.filter((c) => !c.folderName).length;
    if (noTopic) {
      flags.push({
        level: "info",
        text: `${plural(noTopic, "waiting concern")} ${noTopic === 1 ? "hasn't" : "haven't"} been filed under a topic yet.`,
      });
    }

    const list = document.getElementById("attentionList");
    if (!flags.length) {
      list.innerHTML = `<li class="cd-flags__item cd-flags__item--ok"><span class="cd-flags__icon" aria-hidden="true">✓</span><span>Nothing needs following up right now.</span></li>`;
      return;
    }
    list.innerHTML = flags
      .map(
        (f) => `
        <li class="cd-flags__item cd-flags__item--${f.level}">
          <span class="cd-flags__icon" aria-hidden="true">${f.level === "warn" ? "!" : "i"}</span>
          <span>${escapeHtml(f.text)}${f.link ? ` <a href="${f.link}">${escapeHtml(f.linkText)}</a>` : ""}</span>
        </li>`
      )
      .join("");
  }

  // ---- Submissions over time (received vs reviewed) ----
  // Two lines on one shared count axis. Identity is carried by the legend,
  // an end-of-line label, and a dashed stroke on "Reviewed" — not colour alone.

  // Drawn at the card's real pixel width (not a scaled viewBox) so the
  // text stays a readable size on a phone.
  const TREND = { height: 230, left: 34, right: 68, top: 14, bottom: 30 };

  function renderTrend(ctx) {
    const { ranges } = ctx;
    const container = document.getElementById("trendChart");
    const all = liveConcerns();
    const now = new Date();
    const points = ranges.buckets.map((b) => ({
      ...b,
      // Days/months that haven't started yet have no value at all — the
      // lines stop at today instead of dropping to a misleading zero.
      future: b.start > now,
      received: all.filter((c) => within(c.dateSubmitted, b.start, b.end)).length,
      reviewed: all.filter((c) => within(c.dateReviewed, b.start, b.end)).length,
    }));
    const drawn = points.filter((p) => !p.future);

    if (!points.some((p) => p.received || p.reviewed)) {
      container.innerHTML = `<p class="cd-empty">No activity ${ctx.meta.noun}.</p>`;
      return;
    }

    const { height, left, right, top, bottom } = TREND;
    const width = Math.max(container.clientWidth, 280);
    const plotW = width - left - right;
    const plotH = height - top - bottom;
    const rawMax = Math.max(...points.map((p) => Math.max(p.received, p.reviewed)), 1);
    // Whole-number gridlines: counts of people's submissions are never fractional.
    const step = Math.max(1, Math.ceil(rawMax / 4));
    const max = step * Math.ceil(rawMax / step);
    const x = (i) => left + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
    const y = (v) => top + plotH - (v / max) * plotH;
    const path = (key) => drawn.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

    const grid = [];
    for (let v = 0; v <= max; v += step) {
      grid.push(`<line class="cd-trend__grid" x1="${left}" x2="${left + plotW}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="cd-trend__tick" x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`);
    }
    const xLabels = points
      .map((p, i) => (p.label ? `<text class="cd-trend__tick" x="${x(i)}" y="${height - 8}" text-anchor="middle">${p.label}</text>` : ""))
      .join("");

    // End labels sit beside each line's last point; nudged apart if they'd overlap.
    const last = drawn[drawn.length - 1];
    let yReceived = y(last.received);
    let yReviewed = y(last.reviewed);
    if (Math.abs(yReceived - yReviewed) < 13) {
      const mid = (yReceived + yReviewed) / 2;
      const receivedOnTop = last.received >= last.reviewed;
      yReceived = mid + (receivedOnTop ? -7 : 7);
      yReviewed = mid + (receivedOnTop ? 7 : -7);
    }
    const endX = x(drawn.length - 1) + 9;
    // A single plotted bucket has no line to draw — show its two points.
    const lonePoints =
      drawn.length === 1
        ? `<circle class="cd-trend__dot cd-trend__dot--received" r="4.5" cx="${x(0)}" cy="${y(last.received)}"/>
           <circle class="cd-trend__dot cd-trend__dot--reviewed" r="4.5" cx="${x(0)}" cy="${y(last.reviewed)}"/>`
        : "";

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Concerns received and reviewed over ${ctx.meta.noun.replace("this ", "the ")}">
        ${grid.join("")}
        ${xLabels}
        <path class="cd-trend__line cd-trend__line--received" d="${path("received")}"/>
        <path class="cd-trend__line cd-trend__line--reviewed" d="${path("reviewed")}"/>
        ${lonePoints}
        <text class="cd-trend__end" x="${endX}" y="${yReceived + 4}">Received</text>
        <text class="cd-trend__end" x="${endX}" y="${yReviewed + 4}">Reviewed</text>
        <g class="cd-trend__hover" hidden>
          <line class="cd-trend__cursor" y1="${top}" y2="${top + plotH}"/>
          <circle class="cd-trend__dot cd-trend__dot--received" r="4.5"/>
          <circle class="cd-trend__dot cd-trend__dot--reviewed" r="4.5"/>
        </g>
        <rect class="cd-trend__hit" x="${left}" y="${top}" width="${plotW}" height="${plotH}" fill="transparent"/>
      </svg>
      <div class="cd-trend__tip" hidden></div>`;

    const svg = container.querySelector("svg");
    const hover = container.querySelector(".cd-trend__hover");
    const cursor = container.querySelector(".cd-trend__cursor");
    const dotReceived = container.querySelector(".cd-trend__dot--received");
    const dotReviewed = container.querySelector(".cd-trend__dot--reviewed");
    const tip = container.querySelector(".cd-trend__tip");
    const hit = container.querySelector(".cd-trend__hit");

    function show(clientX) {
      const box = svg.getBoundingClientRect();
      const svgX = ((clientX - box.left) / box.width) * width;
      const i = Math.max(0, Math.min(drawn.length - 1, Math.round(((svgX - left) / plotW) * (points.length - 1))));
      const p = drawn[i];
      hover.removeAttribute("hidden");
      cursor.setAttribute("x1", x(i));
      cursor.setAttribute("x2", x(i));
      dotReceived.setAttribute("cx", x(i));
      dotReceived.setAttribute("cy", y(p.received));
      dotReviewed.setAttribute("cx", x(i));
      dotReviewed.setAttribute("cy", y(p.reviewed));
      tip.hidden = false;
      tip.innerHTML = `<strong>${escapeHtml(p.title)}</strong>
        <span><i class="cd-legend__swatch cd-legend__swatch--received"></i>Received <b>${p.received}</b></span>
        <span><i class="cd-legend__swatch cd-legend__swatch--reviewed"></i>Reviewed <b>${p.reviewed}</b></span>`;
      // Keep the tooltip inside the card on either side of the cursor.
      const px = (x(i) / width) * box.width;
      const flip = px > box.width * 0.6;
      tip.style.left = flip ? "auto" : `${px + 12}px`;
      tip.style.right = flip ? `${box.width - px + 12}px` : "auto";
    }
    function hide() {
      hover.setAttribute("hidden", "");
      tip.hidden = true;
    }
    hit.addEventListener("mousemove", (e) => show(e.clientX));
    hit.addEventListener("mouseleave", hide);
    hit.addEventListener("touchstart", (e) => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener("touchmove", (e) => show(e.touches[0].clientX), { passive: true });
    hit.addEventListener("touchend", hide);
  }

  // ---- Latest concerns ----

  let latestListLimit = 5;
  const latestPageSizeSelect = document.getElementById("latestPageSize");

  if (latestPageSizeSelect) {
    latestPageSizeSelect.addEventListener("change", () => {
      latestListLimit = latestPageSizeSelect.value === "all" ? Infinity : Number(latestPageSizeSelect.value);
      renderLatest();
    });
  }
  wireFiltersDropdown(document.getElementById("latestFiltersToggleBtn"), document.getElementById("latestFiltersPanel"));

  function renderLatest() {
    const body = document.getElementById("latestBody");
    const latest = sortConcernsByStatusThenDate(liveConcerns()).slice(0, latestListLimit);
    if (!latest.length) {
      body.innerHTML = `<tr><td colspan="5" class="ordinances-empty">No concerns or suggestions yet.</td></tr>`;
      return;
    }
    body.innerHTML = latest
      .map((c) => {
        const text = c.concernText || "";
        const summary = text.length > 90 ? `${text.slice(0, 90).trimEnd()}…` : text;
        return `
        <tr>
          <td>${formatConcernDate(c.dateSubmitted)}</td>
          <td>${c.folderName ? escapeHtml(c.folderName) : `<span class="cd-muted">No topic yet</span>`}</td>
          <td class="cd-summary">${escapeHtml(summary)}</td>
          <td><span class="status-pill ${c.status === "Reviewed" ? "status-pill--resolved" : "status-pill--in-process"}">${c.status === "Reviewed" ? "Reviewed" : "Waiting"}</span></td>
          <td><a class="recent-reports-table__view-btn" href="concern-detail.html?id=${encodeURIComponent(c.id)}">View Details</a></td>
        </tr>`;
      })
      .join("");
  }

  // ---- Wire up ----

  function renderAll() {
    const ranges = periodRanges(state.period);
    const all = liveConcerns();
    const ctx = {
      meta: periodMeta(state.period),
      ranges,
      received: all.filter((c) => within(c.dateSubmitted, ranges.start, ranges.end)),
      previousReceived: all.filter((c) => within(c.dateSubmitted, ranges.prevStart, ranges.prevEnd)),
      reviewedInPeriod: all.filter((c) => c.status === "Reviewed" && within(c.dateReviewed, ranges.start, ranges.end)),
      waiting: all.filter((c) => c.status !== "Reviewed"),
    };

    renderPeriodMenu();
    renderKpis(ctx);
    const topics = renderTopics(ctx);
    renderTrend(ctx);
    renderAttention(ctx, topics);
    renderStreets(ctx);
    renderLatest();
  }

  renderAll();

  // The trend chart is sized to its card, so it's redrawn when that changes.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderAll, 150);
  });
});
