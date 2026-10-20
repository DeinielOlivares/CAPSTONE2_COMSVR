// Barangay Platero OVRMS — View Audit Logs data, backed by the real API.
// GET /api/auth/admin/audit-logs/ (see AuditLog/AuditLogSerializer) — one
// row per logged action (logins/logouts, submissions, status changes,
// account management, etc. — see accounts.models.log_action's call sites).

const AUDIT_API_BASE = "/api/auth/admin";

async function getAuditLogs() {
  const response = await authFetch(`${AUDIT_API_BASE}/audit-logs/`);
  if (!response.ok) {
    throw new Error("Could not load audit logs. Try refreshing the page.");
  }
  return response.json();
}
