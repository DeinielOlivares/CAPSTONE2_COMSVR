// Barangay Platero OVRMS — My Reports data, backed by the real API.

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

// Maps the backend's status values to the labels the UI already uses (see
// the statusFilter options in my-reports.html and the badgeClass map in
// my-reports-list.js).
const REPORT_STATUS_LABELS = {
  submitted: "Submitted",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};
