// pending-accounts-data.js — API calls for Approve Accounts (/api/auth/admin/verifications/).

const ADMIN_API_BASE = "/api/auth/admin";

async function getPendingVerifications() {
  const response = await authFetch(`${ADMIN_API_BASE}/verifications/`);
  if (!response.ok) {
    throw new Error("Could not load pending accounts. Try refreshing the page.");
  }
  return response.json();
}

// Marks the account verified — it can log in immediately after this.
async function approveVerification(id) {
  const response = await authFetch(`${ADMIN_API_BASE}/verifications/${id}/approve/`, {
    method: "POST",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not approve this account.");
  }
  return response.json();
}

// Emails the reason and deletes the pending account (so they can sign up again).
async function rejectVerification(id, reason) {
  const response = await authFetch(`${ADMIN_API_BASE}/verifications/${id}/reject/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not reject this account.");
  }
  return response.json();
}
