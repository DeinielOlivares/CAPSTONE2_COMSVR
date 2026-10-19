// reports-data.js (staff) — loads every report from GET /api/reports/staff/
// once per page and keeps it in memory; also the date/period helpers used by
// the dashboards. Call `await ensureReportsLoaded()` before liveReports() / getReportById().

const REPORT_STATUS_TO_LABEL = {
  submitted: "New Submission",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};
const REPORT_LABEL_TO_STATUS = {
  "New Submission": "submitted",
  "Under Review": "under_review",
  "In Action": "in_action",
  Resolved: "resolved",
  "With Remarks": "with_remarks",
};

// Every status label, in timeline order (the timeline shows the first as "Submitted").
const REPORT_STATUS_LABELS_ORDERED = ["New Submission", "Under Review", "In Action", "Resolved", "With Remarks"];

// Resolved and With Remarks close a report; anything else is still open.
const REPORT_CLOSED_LABELS = ["Resolved", "With Remarks"];
function isReportClosed(status) {
  return REPORT_CLOSED_LABELS.includes(status);
}

// Badge (list rows) and pill (tables/detail) classes per status label.
const REPORT_STATUS_BADGE_CLASS = {
  "New Submission": "status-badge--submitted",
  "Under Review": "status-badge--in-process",
  "In Action": "status-badge--with-remarks",
  Resolved: "status-badge--resolved",
  "With Remarks": "status-badge--remarked",
};
const REPORT_STATUS_PILL_CLASS = {
  "New Submission": "status-pill--new",
  "Under Review": "status-pill--in-process",
  "In Action": "status-pill--remarks",
  Resolved: "status-pill--resolved",
  "With Remarks": "status-pill--remarked",
};

// Sorted by status (timeline order), then newest first.
const REPORT_STATUS_RANK = {
  "New Submission": 0,
  "Under Review": 1,
  "In Action": 2,
  Resolved: 3,
  "With Remarks": 3,
};

function sortReportsByStatusThenDate(reports) {
  return reports.slice().sort((a, b) => {
    const rankDiff = (REPORT_STATUS_RANK[a.status] ?? 99) - (REPORT_STATUS_RANK[b.status] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return b.dateSubmitted - a.dateSubmitted;
  });
}

let _reportsCache = null;

// A report keeps the ordinance text the citizen picked; its category is found
// by matching that text against liveOrdinances().
// Call ensureOrdinancesLoaded() before ensureReportsLoaded().
function categoryForOrdinance(ordinanceText) {
  const match = liveOrdinances().find((o) => `${o.number} — ${o.title}` === ordinanceText);
  return match ? match.category : "Other";
}

function mapReport(r) {
  return {
    id: r.id,
    incidentType: r.ordinance, // closest real analog to the old mock "category" — Ordinances aren't a separate model yet
    ordinance: r.ordinance,
    category: categoryForOrdinance(r.ordinance),
    location: r.location,
    // Device position when filed, or null (the heatmap then uses the street).
    latitude: r.latitude,
    longitude: r.longitude,
    reporter: r.reporter,
    reporterId: r.reporterId,
    contactNumber: r.contact_number,
    natureOfViolation: r.nature_of_violation,
    status: REPORT_STATUS_TO_LABEL[r.status] || r.status,
    remarks: r.remarks,
    dateSubmitted: new Date(r.created_at),
    // When the current status was reached (only the latest status is stored).
    dateUpdated: new Date(r.updated_at),
    incidentDate: r.incident_date,
    incidentTimeRaw: r.incident_time,
    attachments: r.attachments,
    // The Investigator who claimed it, or null.
    assignedInvestigator: r.assignedInvestigator,
    assignedInvestigatorId: r.assignedInvestigatorId,
    // "YYYYMMDD-N" (also the Download Report file name).
    reportNumber: r.report_number,
  };
}

async function ensureReportsLoaded() {
  if (_reportsCache) return _reportsCache;
  const response = await authFetch("/api/reports/staff/");
  if (!response.ok) throw new Error("Could not load reports.");
  const data = await response.json();
  _reportsCache = sortReportsByStatusThenDate(data.map(mapReport));
  return _reportsCache;
}

function liveReports() {
  return _reportsCache || [];
}

// Number of approved, active citizens (for "% of registered citizens"), or null.
let _registeredCitizensPromise = null;
function loadRegisteredCitizenCount() {
  if (!_registeredCitizensPromise) {
    _registeredCitizensPromise = authFetch("/api/reports/staff/analysis-base/")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (data && typeof data.registered_citizens === "number" ? data.registered_citizens : null))
      .catch(() => null);
  }
  return _registeredCitizensPromise;
}

function getReportById(id) {
  return (_reportsCache || []).find((r) => r.id === id) || null;
}

// Reloads one report into the cache (after a save).
async function refreshReportInCache(id) {
  const response = await authFetch(`/api/reports/staff/${encodeURIComponent(id)}/`);
  if (!response.ok) throw new Error("Could not reload this report.");
  const updated = mapReport(await response.json());
  if (_reportsCache) {
    const idx = _reportsCache.findIndex((r) => r.id === id);
    if (idx !== -1) _reportsCache[idx] = updated;
    _reportsCache = sortReportsByStatusThenDate(_reportsCache);
  }
  return updated;
}

// patch: { status?: <display label>, remarks?: <string> }
async function updateReportStatus(id, patch) {
  const body = {};
  if (patch.status !== undefined) body.status = REPORT_LABEL_TO_STATUS[patch.status] || patch.status;
  if (patch.remarks !== undefined) body.remarks = patch.remarks;

  const response = await authFetch(`/api/reports/staff/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    // Show {detail} (e.g. "Claim this report first") or the first field error.
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not update this report.");
  }
  return refreshReportInCache(id);
}

// Claims a report for the logged-in Investigator. Throws the server's message
// (e.g. "already claimed by X").
async function claimReport(id) {
  const response = await authFetch(`/api/reports/staff/${encodeURIComponent(id)}/claim/`, { method: "POST" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not claim this report.");
  }
  const updated = mapReport(await response.json());
  if (_reportsCache) {
    const idx = _reportsCache.findIndex((r) => r.id === id);
    if (idx !== -1) _reportsCache[idx] = updated;
  }
  return updated;
}

// Claiming can't be undone by the Investigator, so both Claim buttons ask first.
const CLAIM_CONFIRM_MESSAGE = "";
const CLAIM_CONFIRM_OPTIONS = { title: "Are you sure?", confirmText: "Claim Report" };

// ---- Date / period helpers ----

function formatReportDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const THIS_WEEK_START = startOfWeek(new Date());

function getWeekRange(offset) {
  const start = addDays(THIS_WEEK_START, -7 * offset);
  const end = addDays(start, 6);
  return { start, end, label: `${formatReportDate(start)} - ${formatReportDate(end)}` };
}

function getMonthRange(monthsBack) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 0);
  return { start, end };
}

// quartersBack counts back from the current quarter (0 = this quarter).
function getQuarterRange(quartersBack) {
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3);
  const totalQuarters = now.getFullYear() * 4 + currentQuarter - quartersBack;
  const year = Math.floor(totalQuarters / 4);
  const quarter = totalQuarters % 4;
  const start = new Date(year, quarter * 3, 1);
  const end = new Date(year, quarter * 3 + 3, 0);
  return { start, end, quarter: quarter + 1, year };
}

// yearsBack counts back from the current year (0 = this year).
function getYearRange(yearsBack) {
  const year = new Date().getFullYear() - yearsBack;
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return { start, end, year };
}

// The period choices (values understood by getReportsForPeriod).
const REPORT_PERIOD_MONTHS_BACK = 5;
const REPORT_PERIOD_QUARTERS_BACK = 3;
const REPORT_PERIOD_YEARS_BACK = 2;

function buildReportPeriodOptions() {
  const opts = [{ value: "week", label: "This Week" }];
  for (let m = 0; m <= REPORT_PERIOD_MONTHS_BACK; m++) {
    const { start } = getMonthRange(m);
    opts.push({
      value: `month${m}`,
      label: m === 0 ? "This Month" : start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    });
  }
  for (let q = 0; q <= REPORT_PERIOD_QUARTERS_BACK; q++) {
    const { quarter, year } = getQuarterRange(q);
    opts.push({ value: `quarter${q}`, label: q === 0 ? `This Quarter (Q${quarter} ${year})` : `Q${quarter} ${year}` });
  }
  for (let y = 0; y <= REPORT_PERIOD_YEARS_BACK; y++) {
    const { year } = getYearRange(y);
    opts.push({ value: `year${y}`, label: y === 0 ? `This Year (${year})` : `${year}` });
  }
  opts.push({ value: "all", label: "All Time" });
  return opts;
}

// The period before the given one (for "vs last month" etc.), or null.
function previousReportPeriod(period) {
  if (typeof period !== "string") return null;
  if (period === "week") return "week1";
  const match = period.match(/^(week|month|quarter|year)(\d+)$/);
  if (!match) return null;
  return `${match[1]}${Number(match[2]) + 1}`;
}

// A period <-> URL query string (so the Geospatial Analysis page opens on
// the dashboard's period). reportPeriodFromQuery returns null if unknown.
function reportPeriodToQuery(period) {
  if (period && typeof period === "object") {
    return `from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}`;
  }
  return `period=${encodeURIComponent(period)}`;
}

function reportPeriodFromQuery(search) {
  const params = new URLSearchParams(search);
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
  const from = params.get("from");
  const to = params.get("to");
  if (isDate(from) && isDate(to) && from <= to) return { type: "custom", from, to };
  const period = params.get("period");
  return buildReportPeriodOptions().some((o) => o.value === period) ? period : null;
}

function getReportsForWeekOffset(offset) {
  const { start, end } = getWeekRange(offset);
  const endDate = endOfDay(end);
  return liveReports().filter((r) => r.dateSubmitted >= start && r.dateSubmitted <= endDate);
}

function getReportsForPeriod(periodValue) {
  // A custom range: {type: "custom", from: "YYYY-MM-DD", to: "YYYY-MM-DD"} (both days included).
  if (periodValue && typeof periodValue === "object" && periodValue.type === "custom") {
    const start = new Date(`${periodValue.from}T00:00:00`);
    const end = endOfDay(new Date(`${periodValue.to}T00:00:00`));
    return liveReports().filter((r) => r.dateSubmitted >= start && r.dateSubmitted <= end);
  }
  if (periodValue === "all") return liveReports();
  if (periodValue === "week") return getReportsForWeekOffset(0);
  if (periodValue.startsWith("week")) return getReportsForWeekOffset(Number(periodValue.slice(4)));
  if (periodValue.startsWith("quarter")) {
    const { start, end } = getQuarterRange(Number(periodValue.slice(7)));
    const endDate = endOfDay(end);
    return liveReports().filter((r) => r.dateSubmitted >= start && r.dateSubmitted <= endDate);
  }
  if (periodValue.startsWith("year")) {
    const { start, end } = getYearRange(Number(periodValue.slice(4)));
    const endDate = endOfDay(end);
    return liveReports().filter((r) => r.dateSubmitted >= start && r.dateSubmitted <= endDate);
  }
  const monthsBack = Number(periodValue.replace("month", ""));
  const { start, end } = getMonthRange(monthsBack);
  const endDate = endOfDay(end);
  return liveReports().filter((r) => r.dateSubmitted >= start && r.dateSubmitted <= endDate);
}
