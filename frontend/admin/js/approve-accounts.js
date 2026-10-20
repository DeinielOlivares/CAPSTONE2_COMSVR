// Barangay Platero OVRMS — Approve Accounts: render + filter the pending account list, and
// handle the approve/reject popup + ID photo preview.
// Data now comes from the real API (see pending-accounts-data.js) instead
// of a hardcoded array, so this file is async where it fetches/reviews
// accounts, and the photo preview shows the actual uploaded image.

document.addEventListener("DOMContentLoaded", async () => {
  const tbody = document.getElementById("pendingTableBody");
  const typeFilter = document.getElementById("typeFilter");
  const pagination = document.getElementById("pendingPagination");
  const pageSizeSelect = document.getElementById("pendingPageSize");

  let accounts = [];
  // null = "All" (no limit) — the default, since there's usually not enough
  // pending accounts at once to need paging through them.
  const memory = createFilterMemory("approve_accounts");
  memory.bindSelect(typeFilter);
  memory.bindSelect(pageSizeSelect);
  let pageSize = pageSizeFrom(pageSizeSelect, null);
  let page = memory.get("page", 1);

  async function loadAccounts() {
    tbody.innerHTML = skeletonTableRows(5, 4);
    try {
      accounts = await getPendingVerifications();
      render();
    } catch (err) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="4">${err.message}</td></tr>`;
    }
  }

  function render() {
    const filterValue = typeFilter.value;
    const rows = accounts.filter((a) => filterValue === "all" || accountTypeGroup(a.type) === filterValue);

    const totalPages = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    memory.set("page", page);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const pageRows = pageSize ? rows.slice(start, start + pageSize) : rows;

    if (pagination) {
      renderPaginationControls(pagination, page, totalPages, (n) => {
        page = n;
        render();
      });
    }

    if (!rows.length) {
      tbody.innerHTML = `<tr><td class="admin-table__empty" colspan="4">No accounts are waiting for approval.</td></tr>`;
      return;
    }

    tbody.innerHTML = pageRows
      .map(
        (a) => `
        <tr data-id="${a.id}">
          <td><a class="admin-table__owner-link" href="#" data-id="${a.id}">${a.owner}</a></td>
          <td>${a.email}</td>
          <td><a class="admin-table__owner-link" href="#" data-photo-id="${a.id}">View Photo</a></td>
          <td>${a.created}</td>
        </tr>`
      )
      .join("");
  }

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

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  await loadAccounts();

  // Approve Account popup: opened by clicking an account owner's name
  const approveModal = document.getElementById("approveAccountModal");
  const approveName = document.getElementById("approveAccountName");
  const approveEmail = document.getElementById("approveAccountEmail");
  const approveType = document.getElementById("approveAccountType");
  const approveCreated = document.getElementById("approveAccountCreated");
  const approvePhotoLink = document.getElementById("approveAccountPhotoLink");
  const approveYesBtn = document.getElementById("approveAccountYes");
  const approveNoBtn = document.getElementById("approveAccountNo");

  // ID Photo preview popup
  const idPhotoModal = document.getElementById("idPhotoModal");
  const idPhotoImg = document.getElementById("idPhotoImg");

  let activeAccountId = null;

  function openPhotoPreview(account) {
    idPhotoImg.src = account.photoUrl;
    idPhotoModal.hidden = false;
  }

  tbody.addEventListener("click", (e) => {
    const photoLink = e.target.closest("[data-photo-id]");
    if (photoLink) {
      e.preventDefault();
      const account = accounts.find((a) => a.id === photoLink.dataset.photoId);
      if (account) openPhotoPreview(account);
      return;
    }

    // The owner link still works on its own (desktop), and on mobile the
    // other columns are hidden (see style.css) so the whole row — really
    // just the name — is what's left to tap. "View ID Photo" itself still
    // reaches the photo from inside the popup this opens.
    const row = e.target.closest("tr[data-id]");
    if (!row) return;
    e.preventDefault();

    const account = accounts.find((a) => a.id === row.dataset.id);
    if (!account || !approveModal) return;

    activeAccountId = account.id;
    approveName.textContent = account.owner;
    approveEmail.textContent = account.email;
    approveType.textContent = account.type;
    approveCreated.textContent = account.created;
    approveModal.hidden = false;
  });

  if (approvePhotoLink) {
    approvePhotoLink.addEventListener("click", (e) => {
      e.preventDefault();
      const account = accounts.find((a) => a.id === activeAccountId);
      if (account) openPhotoPreview(account);
    });
  }

  // Shared by the Approve/Reject buttons: calls the given API action for
  // the active account, then drops it from the list on success.
  async function reviewActiveAccount(actionFn, ...args) {
    if (!activeAccountId) return null;
    try {
      await actionFn(activeAccountId, ...args);
      accounts = accounts.filter((a) => a.id !== activeAccountId);
      approveModal.hidden = true;
      render();
      return true;
    } catch (err) {
      siteAlert(err.message);
      return false;
    }
  }

  if (approveYesBtn) {
    approveYesBtn.addEventListener("click", async () => {
      approveYesBtn.disabled = true;
      await reviewActiveAccount(approveVerification);
      approveYesBtn.disabled = false;
    });
  }

  // Reject Account popup: asks for a reason (emailed to the applicant, see
  // AdminRejectVerificationView) instead of a plain confirm dialog.
  const rejectReasonModal = document.getElementById("rejectReasonModal");
  const rejectReasonForm = document.getElementById("rejectReasonForm");
  const rejectReasonInput = document.getElementById("rejectReasonInput");
  const rejectReasonCancel = document.getElementById("rejectReasonCancel");

  if (approveNoBtn && rejectReasonModal) {
    approveNoBtn.addEventListener("click", () => {
      rejectReasonInput.value = "";
      rejectReasonModal.hidden = false;
    });
  }

  if (rejectReasonCancel) {
    rejectReasonCancel.addEventListener("click", () => {
      rejectReasonModal.hidden = true;
    });
  }

  if (rejectReasonForm) {
    rejectReasonForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const reason = rejectReasonInput.value.trim();
      if (!reason) return;

      const submitBtn = rejectReasonForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      const ok = await reviewActiveAccount(rejectVerification, reason);
      submitBtn.disabled = false;
      if (ok) rejectReasonModal.hidden = true;
    });
  }
});
