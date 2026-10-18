// Barangay Platero OVRMS — Manage Accounts: render + sort + filter the account list.
// Data now comes from the real API (see accounts-data.js) instead of a
// hardcoded array, so this file is async where it fetches/updates accounts.

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const tbody = document.getElementById("accountsTableBody");
  const sortSelect = document.getElementById("sortSelect");
  const typeFilter = document.getElementById("typeFilter");
  const pagination = document.getElementById("accountsPagination");
  const pageSizeSelect = document.getElementById("accountsPageSize");

  let accounts = [];
  let page = 1;

  async function loadAccounts() {
    tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="4">Loading accounts...</td></tr>`;
    try {
      accounts = await getAllAccounts();
      render();
    } catch (err) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="4">${err.message}</td></tr>`;
    }
  }

  function render() {
    const filterValue = typeFilter.value;
    let rows = accounts.filter((a) => filterValue === "all" || accountTypeGroup(a.type) === filterValue);

    const sortValue = sortSelect.value;
    rows = rows.slice().sort((a, b) => {
      if (sortValue === "owner") return a.owner.localeCompare(b.owner);
      if (sortValue === "owner_desc") return b.owner.localeCompare(a.owner);
      // Lower activityMinutes = less time since last activity = more recent.
      if (sortValue === "recent") return a.activityMinutes - b.activityMinutes;
      if (sortValue === "recent_desc") return b.activityMinutes - a.activityMinutes;
      // Account IDs are UUIDs (not sequential numbers), so "Newest"/"Oldest"
      // sort by join date instead of trying to compare IDs numerically.
      if (sortValue === "id_asc") return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });

    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    if (pagination) {
      renderPaginationControls(pagination, page, totalPages, (n) => {
        page = n;
        render();
      });
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="4">No accounts match this filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageRows
      .map(
        (a) => `
        <tr data-id="${a.id}">
          <td><a class="admin-table__owner-link" href="#" data-id="${a.id}">${a.owner}</a></td>
          <td>${a.email}</td>
          <td>${a.type}</td>
          <td>${
            a.setupPending
              ? '<span class="status-pending">Setup Pending</span>'
              : a.active
                ? '<span class="status-active">Active</span>'
                : '<span class="status-inactive">Disabled</span>'
          }</td>
        </tr>`
      )
      .join("");
  }

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  sortSelect.addEventListener("change", () => {
    page = 1;
    render();
  });
  typeFilter.addEventListener("change", () => {
    page = 1;
    render();
  });
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
      page = 1;
      render();
    });
  }
  await loadAccounts();

  // Edit Account popup: opened by clicking an account owner's name
  const editModal = document.getElementById("editAccountModal");
  const editName = document.getElementById("editAccountName");
  const editEmail = document.getElementById("editAccountEmail");
  const editStatus = document.getElementById("editAccountStatus");
  const editReportsRow = document.getElementById("editAccountReportsRow");
  const editReports = document.getElementById("editAccountReports");
  const editSuggestionsRow = document.getElementById("editAccountSuggestionsRow");
  const editSuggestions = document.getElementById("editAccountSuggestions");

  const REPORT_STATUS_LABELS = {
    submitted: "Submitted",
    under_review: "Under Review",
    in_action: "In Action",
    resolved: "Resolved",
    with_remarks: "With Remarks",
  };
  const SUGGESTION_STATUS_LABELS = { submitted: "Submitted", reviewed: "Reviewed" };

  // Renders e.g. "4 filed (2 Submitted, 1 Under Review, 1 Resolved)", or a
  // plain "no X filed" message when the citizen hasn't filed any yet.
  function formatStats(stats, labels, noneLabel) {
    if (!stats || !stats.total) return noneLabel;
    const parts = Object.entries(stats.byStatus)
      .map(([key, count]) => `${count} ${labels[key] || key}`)
      .join(", ");
    return `${stats.total} filed (${parts})`;
  }
  const editType = document.getElementById("editAccountType");
  const editCreated = document.getElementById("editAccountCreated");
  const editUpdated = document.getElementById("editAccountUpdated");
  const editDisableBtn = document.getElementById("editDisableBtn");
  const editTypeBtn = document.getElementById("editTypeBtn");
  const editDeleteBtn = document.getElementById("editDeleteBtn");

  let activeAccount = null;

  function populateEditModal(account) {
    editName.textContent = account.owner;
    editEmail.textContent = account.email;
    editStatus.textContent = account.active ? "Active" : "Disabled";
    editStatus.className = account.active ? "status-active" : "status-inactive";
    editType.textContent = account.type;
    editCreated.textContent = account.created;
    editUpdated.textContent = account.updated;

    const isCitizenAccount = account.reportStats !== null && account.reportStats !== undefined;
    editReportsRow.hidden = !isCitizenAccount;
    editSuggestionsRow.hidden = !isCitizenAccount;
    if (isCitizenAccount) {
      editReports.textContent = formatStats(account.reportStats, REPORT_STATUS_LABELS, "No reports filed.");
      editSuggestions.textContent = formatStats(account.suggestionStats, SUGGESTION_STATUS_LABELS, "No suggestions filed.");
    }
    editDisableBtn.innerHTML = account.active
      ? `<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M6 6l12 12"/></svg> Disable User`
      : `<svg class="nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.6 2.6L16.3 9"/></svg> Enable User`;
    // Swap the color too — "Enable User" is a restorative action and
    // shouldn't stay styled like the red "Disable"/"Delete" buttons.
    editDisableBtn.classList.toggle("edit-account-btn--disable", account.active);
    editDisableBtn.classList.toggle("edit-account-btn--enable", !account.active);

    // Admins can't disable, re-role, or delete their own account — see the
    // matching safeguards in AdminAccountDetailView.patch/delete. Shown as
    // disabled buttons here so it's clear upfront, not just after a failed click.
    const isSelf = account.id === (getAdminUser() || {}).id;
    editDisableBtn.disabled = isSelf && account.active;
    editDisableBtn.title = isSelf && account.active ? "You can't disable your own account." : "";
    editDeleteBtn.disabled = isSelf;
    editDeleteBtn.title = isSelf ? "You can't delete your own account." : "";

    // Update Role only applies to Barangay Staff/Administrator accounts —
    // a Citizen's account type isn't something Manage Accounts changes
    // anymore (see accounts/views.py's AdminAccountDetailView.patch).
    const isCitizen = account.type === "Barangay Citizen";
    editTypeBtn.hidden = isCitizen;
    editTypeBtn.disabled = isSelf;
    editTypeBtn.title = isSelf ? "You can't change your own role." : "";
  }

  tbody.addEventListener("click", (e) => {
    // The owner link still works on its own (desktop), and on mobile the
    // other columns are hidden (see style.css) so the whole row — really
    // just the name — is what's left to tap.
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    e.preventDefault();

    const account = accounts.find((a) => a.id === row.dataset.id);
    if (!account || !editModal) return;

    activeAccount = account;
    populateEditModal(account);
    editModal.hidden = false;
    loadClaimedReports(account);
  });

  // Claimed Reports: an Investigator can't give up a report once they've
  // claimed it, so if they leave or go inactive the Administrator releases
  // their claims here (POST .../forfeit/, Admin-only — see
  // StaffReportForfeitView). Shown for any Staff account holding claims
  // (e.g. someone re-roled away from Investigator), and always for
  // Investigators so "no claims" is visible too.
  const claimedSection = document.getElementById("claimedReports");
  const claimedList = document.getElementById("claimedReportsList");
  const releaseAllBtn = document.getElementById("releaseAllClaimsBtn");
  let claimedReports = [];

  function escapeClaimHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function renderClaimedReports(account) {
    const isInvestigator = account.position === "Investigator";
    claimedSection.hidden = !claimedReports.length && !isInvestigator;
    releaseAllBtn.hidden = claimedReports.length < 2;
    claimedList.innerHTML = claimedReports.length
      ? claimedReports
          .map(
            (r) => `
        <li class="claimed-reports__item">
          <div>
            <span class="claimed-reports__name">${escapeClaimHtml(r.ordinance)}</span>
            <span class="claimed-reports__meta">${escapeClaimHtml(r.location)} · ${CLAIM_STATUS_LABELS[r.status] || r.status}</span>
          </div>
          <button type="button" class="claimed-reports__release" data-release="${r.id}">Release</button>
        </li>`
          )
          .join("")
      : `<li class="claimed-reports__empty">No claimed reports.</li>`;
  }

  async function loadClaimedReports(account) {
    claimedReports = [];
    claimedSection.hidden = true;
    if (account.type === "Barangay Citizen") return;
    try {
      const reports = await getClaimedReports(account.id);
      // The popup may have moved on to another account while this loaded.
      if (activeAccount !== account) return;
      claimedReports = reports;
      renderClaimedReports(account);
    } catch (err) {
      if (activeAccount !== account) return;
      claimedSection.hidden = false;
      claimedList.innerHTML = `<li class="claimed-reports__empty">${escapeClaimHtml(err.message)}</li>`;
      releaseAllBtn.hidden = true;
    }
  }

  // Fresh count right before disabling/deleting — the popup's list may still
  // be loading, or be stale if someone claimed something meanwhile. Citizens
  // can't hold claims, so skip the request for them.
  async function countClaims(account) {
    if (account.type === "Barangay Citizen") return 0;
    try {
      return (await getClaimedReports(account.id)).length;
    } catch {
      return claimedReports.length;
    }
  }

  const claimsModal = document.getElementById("claimsWarningModal");
  const claimsTitle = document.getElementById("claimsWarningTitle");
  const claimsText = document.getElementById("claimsWarningText");
  const claimsPrimary = document.getElementById("claimsWarningPrimary");
  const claimsSecondary = document.getElementById("claimsWarningSecondary");
  const claimsCancel = document.getElementById("claimsWarningCancel");

  // Resolves "primary", "secondary", or null (Cancel / backdrop click).
  function askAboutClaims({ title, text, primary, secondary }) {
    claimsTitle.textContent = title;
    claimsText.textContent = text;
    claimsPrimary.textContent = primary;
    claimsSecondary.textContent = secondary || "";
    claimsSecondary.hidden = !secondary;
    claimsModal.hidden = false;
    return new Promise((resolve) => {
      function finish(choice) {
        claimsModal.hidden = true;
        claimsPrimary.removeEventListener("click", onPrimary);
        claimsSecondary.removeEventListener("click", onSecondary);
        claimsCancel.removeEventListener("click", onCancel);
        claimsModal.removeEventListener("click", onBackdrop);
        resolve(choice);
      }
      const onPrimary = () => finish("primary");
      const onSecondary = () => finish("secondary");
      const onCancel = () => finish(null);
      const onBackdrop = (e) => {
        if (e.target === claimsModal) finish(null);
      };
      claimsPrimary.addEventListener("click", onPrimary);
      claimsSecondary.addEventListener("click", onSecondary);
      claimsCancel.addEventListener("click", onCancel);
      claimsModal.addEventListener("click", onBackdrop);
    });
  }

  async function releaseClaims(ids) {
    const account = activeAccount;
    for (const id of ids) {
      await releaseReportClaim(id);
      claimedReports = claimedReports.filter((r) => r.id !== id);
    }
    if (activeAccount === account) renderClaimedReports(account);
  }

  claimedList.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-release]");
    if (!btn || !activeAccount) return;
    const report = claimedReports.find((r) => r.id === btn.dataset.release);
    if (!report) return;
    if (!await siteConfirm(`Release ${activeAccount.owner}'s claim on "${report.ordinance}"? Another Investigator will be able to claim it.`)) return;
    btn.disabled = true;
    try {
      await releaseClaims([report.id]);
    } catch (err) {
      btn.disabled = false;
      siteAlert(err.message);
    }
  });

  releaseAllBtn.addEventListener("click", async () => {
    if (!activeAccount || !claimedReports.length) return;
    const count = claimedReports.length;
    if (!await siteConfirm(`Release all ${count} of ${activeAccount.owner}'s claimed reports? Other Investigators will be able to claim them.`)) return;
    releaseAllBtn.disabled = true;
    try {
      await releaseClaims(claimedReports.map((r) => r.id));
    } catch (err) {
      // Whatever was released before the failure is already gone from the list.
      renderClaimedReports(activeAccount);
      siteAlert(err.message);
    } finally {
      releaseAllBtn.disabled = false;
    }
  });

  // Disable/Enable User: PATCHes is_active on the real account. A disabled
  // account is rejected by the backend on their next request too, not just
  // hidden here — see AdminAccountDetailView.patch in accounts/views.py.
  editDisableBtn.addEventListener("click", async () => {
    if (!activeAccount) return;
    const account = activeAccount;

    // Disabling someone who still holds claimed reports would leave those
    // reports stuck (they can't log in to work them, and nobody else can
    // while they're claimed) — so ask whether to release them first.
    let shouldRelease = false;
    if (account.active) {
      const count = await countClaims(account);
      if (count) {
        const noun = count === 1 ? "report" : "reports";
        const choice = await askAboutClaims({
          title: "Disable this account?",
          text: `${account.owner} still has ${count} claimed ${noun}. Release ${count === 1 ? "it" : "them"} so another Investigator can take over, or keep ${count === 1 ? "it" : "them"} assigned (e.g. for a short leave)?`,
          primary: "Release & Disable",
          secondary: "Disable, Keep Claims",
        });
        if (!choice) return;
        shouldRelease = choice === "primary";
      }
    }

    const previousLabel = editDisableBtn.innerHTML;
    editDisableBtn.disabled = true;
    editDisableBtn.textContent = "Saving...";
    try {
      const updated = account.active
        ? await disableAccount(account.id, { releaseClaims: shouldRelease })
        : await updateAccount(account.id, { active: true });
      Object.assign(activeAccount, updated);
      if (shouldRelease) loadClaimedReports(account);
      // Sets the correct label, color, and disabled state for the new
      // active/disabled status — restoring `previousLabel` here instead (as
      // this used to, unconditionally, in a `finally`) would overwrite that
      // with the pre-click label, leaving the button's text/icon out of
      // sync with its now-updated color.
      populateEditModal(activeAccount);
      render();
    } catch (err) {
      // Nothing changed — put the button back exactly as it was.
      editDisableBtn.innerHTML = previousLabel;
      editDisableBtn.disabled = false;
      siteAlert(err.message);
    }
  });

  // Update Role popup — one of the 4 Barangay Staff roles (see
  // accounts/serializers.py's STAFF_ROLE_CHOICES); picking Administrator is
  // what grants Admin Portal access, not a separate account type anymore.
  const updateTypeModal = document.getElementById("updateTypeModal");
  const updateTypeSelect = document.getElementById("updateTypeSelect");
  const updateTypeSave = document.getElementById("updateTypeSave");
  const STAFF_ROLES = ["Barangay Captain", "Secretary", "Investigator", "Administrator"];

  editTypeBtn.addEventListener("click", () => {
    if (!activeAccount) return;
    updateTypeSelect.value = STAFF_ROLES.includes(activeAccount.position) ? activeAccount.position : STAFF_ROLES[0];
    editModal.hidden = true;
    updateTypeModal.hidden = false;
  });

  updateTypeSave.addEventListener("click", async () => {
    if (!activeAccount) return;
    updateTypeSave.disabled = true;
    try {
      const updated = await updateAccount(activeAccount.id, { staff_role: updateTypeSelect.value });
      Object.assign(activeAccount, updated);
      updateTypeModal.hidden = true;
      populateEditModal(activeAccount);
      editModal.hidden = false;
      render();
    } catch (err) {
      siteAlert(err.message);
    } finally {
      updateTypeSave.disabled = false;
    }
  });

  // Cancelling (X or Cancel button, or clicking the backdrop) returns to the
  // Edit Account popup instead of leaving nothing open.
  updateTypeModal.addEventListener("click", (e) => {
    if (e.target === updateTypeModal || e.target.closest("[data-close-modal]")) {
      editModal.hidden = false;
    }
  });

  // Reset Password is disabled for now (see editResetBtn's `disabled`
  // attribute in manage-accounts.html) — no email service is wired up yet
  // to actually deliver a reset link, so there's nothing useful for it to do.

  // Delete Account: permanently removes the account. Guarded the same way
  // as disabling/retyping (can't target yourself), plus the last-remaining-
  // Administrator check — see AdminAccountDetailView.delete.
  editDeleteBtn.addEventListener("click", async () => {
    if (!activeAccount) return;
    const count = await countClaims(activeAccount);
    if (count) {
      const noun = count === 1 ? "report" : "reports";
      const choice = await askAboutClaims({
        title: "Delete this account?",
        text: `${activeAccount.owner} still has ${count} claimed ${noun}. Deleting the account releases ${count === 1 ? "it" : "them"} so another Investigator can claim ${count === 1 ? "it" : "them"}. This can't be undone.`,
        primary: "Release & Delete",
      });
      if (!choice) return;
    } else if (!await siteConfirm(`Permanently delete ${activeAccount.owner}'s account? This can't be undone.`)) {
      return;
    }

    editDeleteBtn.disabled = true;
    try {
      await deleteAccount(activeAccount.id);
      accounts = accounts.filter((a) => a.id !== activeAccount.id);
      editModal.hidden = true;
      activeAccount = null;
      render();
    } catch (err) {
      siteAlert(err.message);
    } finally {
      editDeleteBtn.disabled = false;
    }
  });
});
