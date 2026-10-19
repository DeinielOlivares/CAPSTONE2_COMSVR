// audit-log-data.js — loads the audit log (GET /api/auth/admin/audit-logs/).

const AUDIT_API_BASE = "/api/auth/admin";

async function getAuditLogs() {
  const response = await authFetch(`${AUDIT_API_BASE}/audit-logs/`);
  if (!response.ok) {
    throw new Error("Could not load audit logs. Try refreshing the page.");
  }
  return response.json();
}
