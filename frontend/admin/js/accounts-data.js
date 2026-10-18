// Barangay Platero OVRMS — Manage Accounts data, backed by the real API.
// This used to return a hardcoded ACCOUNTS array plus anything saved to
// localStorage by the Create Account form; it now fetches real accounts
// from GET /api/auth/admin/users/. The shape returned by that endpoint
// matches this file's old placeholder objects field-for-field (owner,
// type, active, lastActiveLabel, activityMinutes, created, updated), so
// manage-accounts.js and create-accounts.js didn't need to change how
// they read each account — only how this file fetches them.

const ADMIN_API_BASE = "/api/auth/admin";

// Fetches the live account list. Callers should await this and handle the
// case where it throws (e.g. token expired, network error) rather than
// assuming it always resolves.
async function getAllAccounts() {
  const response = await authFetch(`${ADMIN_API_BASE}/users/`);
  if (!response.ok) {
    throw new Error("Could not load accounts. Try refreshing the page.");
  }
  return response.json();
}

// Used by the "Disable/Enable User" button and "Update Role" popup —
// PATCHes just the changed fields for one account.
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

// Backs the "Reset Password" button (Barangay Staff/Administrator accounts
// that are already set up): emails the owner a one-time link to choose a
// new password — see AdminResetPasswordView. The admin never sees it.
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

// Backs the "Resend Setup Link" button (any account still Setup Pending):
// emails a fresh one-time setup link and kills older ones — see
// AdminResendSetupLinkView.
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

// Disable an account. An account still holding active claimed reports must
// have them released first — releaseClaims frees them in the same request
// (see AdminAccountDetailView.patch, which refuses it otherwise).
async function disableAccount(id, { releaseClaims = false } = {}) {
  return updateAccount(id, { active: false, release_claims: releaseClaims });
}

// Change a Barangay Staff account's role — same release rule as disabling.
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

// Used by the Create Account form's "Barangay Staff" account type — creates
// a Staff/Administrator account with just an email + role (see
// accounts/serializers.py's AdminCreateUserSerializer).
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

// Used by the Create Account form's "Barangay Citizen" account type — the
// admin enters the citizen's full details directly (see
// StaffCreateCitizenSerializer); the citizen gets a one-time setup link by
// email to confirm them and choose their own password. Throws with field errors attached (err.fields) so the caller can
// highlight the specific email/contact_number field, same pattern as
// citizen Sign Up's apiCheckAvailability.
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

// Investigator claims: once an Investigator claims a report only an
// Administrator can release it (see reports/views.py's
// StaffReportForfeitView) — for when that Investigator has left or gone
// inactive. Manage Accounts lists an account's claims with these.
const CLAIM_STATUS_LABELS = {
  submitted: "New Submission",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};

// Only the account's active claims — a Resolved/With Remarks report keeps
// its Investigator's name as the record of who handled it, so it's never
// listed for release (see accounts/views.py's _active_claims).
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
