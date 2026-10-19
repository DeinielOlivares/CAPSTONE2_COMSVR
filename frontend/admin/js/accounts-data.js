// accounts-data.js (admin) — API calls for Manage Accounts and Create Accounts
// (/api/auth/admin/...) and for releasing claimed reports.

const ADMIN_API_BASE = "/api/auth/admin";

// Every account (throws on failure).
async function getAllAccounts() {
  const response = await authFetch(`${ADMIN_API_BASE}/users/`);
  if (!response.ok) {
    throw new Error("Could not load accounts. Try refreshing the page.");
  }
  return response.json();
}

// Saves changed fields of one account.
async function updateAccount(id, changes) {
  const response = await authFetch(`${ADMIN_API_BASE}/users/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not update this account.");
  }
  return response.json();
}

// "Reset Password": emails a staff member a link to choose a new password.
async function resetAccountPassword(id) {
  const response = await authFetch(`${ADMIN_API_BASE}/users/${id}/reset-password/`, {
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Could not reset this account's password.");
  }
  return data;
}

// "Resend Setup Link": emails a new setup link (older links stop working).
async function resendSetupLink(id) {
  const response = await authFetch(`${ADMIN_API_BASE}/users/${id}/resend-setup-link/`, {
    method: "POST",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Could not resend the setup link.");
  }
  return data;
}

// Disable an account; releaseClaims also releases its claimed reports.
async function disableAccount(id, { releaseClaims = false } = {}) {
  return updateAccount(id, { active: false, release_claims: releaseClaims });
}

// Change a staff account's role (same releaseClaims rule).
async function updateAccountRole(id, staffRole, { releaseClaims = false } = {}) {
  return updateAccount(id, { staff_role: staffRole, release_claims: releaseClaims });
}

// Used by the "Delete Account" button.
async function deleteAccount(id) {
  const response = await authFetch(`${ADMIN_API_BASE}/users/${id}/`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not delete this account.");
  }
}

// Create Accounts > Barangay Staff: email + role.
async function createAccount({ email, staffRole }) {
  const response = await authFetch(`${ADMIN_API_BASE}/create-user/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, staff_role: staffRole }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    const err = new Error(Array.isArray(firstError) ? firstError[0] : "Could not create this account.");
    err.fields = data;
    throw err;
  }
  return response.json();
}

// Create Accounts > Barangay Citizen: all the citizen's details.
// Throws with err.fields so the form can mark the wrong field.
async function createCitizenAccount(details) {
  const response = await authFetch(`${ADMIN_API_BASE}/create-citizen-direct/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(details),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    const err = new Error(data.detail || (Array.isArray(firstError) ? firstError[0] : "Could not create the account."));
    err.fields = data;
    throw err;
  }
  return response.json();
}

// Claimed reports (only an Administrator can release an Investigator's claim).
const CLAIM_STATUS_LABELS = {
  submitted: "New Submission",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};

// The account's unfinished claimed reports (closed ones keep their Investigator).
async function getClaimedReports(userId) {
  const response = await authFetch(`/api/reports/staff/?assigned_to=${encodeURIComponent(userId)}&active=1`);
  if (!response.ok) {
    throw new Error("Could not load this account's claimed reports.");
  }
  return response.json();
}

async function releaseReportClaim(reportId) {
  const response = await authFetch(`/api/reports/staff/${encodeURIComponent(reportId)}/forfeit/`, { method: "POST" });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Could not release this claim.");
  }
  return response.json();
}
