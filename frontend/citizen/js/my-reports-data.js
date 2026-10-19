// my-reports-data.js — loads the citizen's own reports (GET /api/reports/).

async function getMyReports() {
  const response = await authFetch("/api/reports/");
  if (!response.ok) {
    throw new Error("Could not load your reports. Try refreshing the page.");
  }
  return response.json();
}

async function getReportById(id) {
  const response = await authFetch(`/api/reports/${encodeURIComponent(id)}/`);
  if (!response.ok) return null;
  return response.json();
}

// Server status value -> label shown on the page.
const REPORT_STATUS_LABELS = {
  submitted: "Submitted",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};
