// Report detail (staff): shows a report. The Investigator who claimed it can
// change its status and remarks (PATCH /api/reports/staff/<id>/).

function formatTime12h(hhmmss) {
  if (!hhmmss) return "Not specified";
  const [h, m] = hhmmss.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");
  const main = document.querySelector(".report-detail-main");

  try {
    await ensureOrdinancesLoaded();
    await ensureReportsLoaded();
  } catch (err) {
    main.innerHTML = `<p>${err.message}</p>`;
    return;
  }

  let report = getReportById(id);

  if (!report) {
    main.innerHTML = "<p>Report not found.</p>";
    return;
  }

  document.title = `${report.incidentType} — Barangay Platero OVRMS`;

  document.getElementById("reportName").value = report.reporter;
  document.getElementById("reportContact").value = report.contactNumber || "";
  document.getElementById("reportLocation").value = report.location;
  document.getElementById("reportOrdinance").append(new Option(report.ordinance, report.ordinance, true, true));
  document.getElementById("reportDate").value = report.incidentDate;
  const timeLabel = formatTime12h(report.incidentTimeRaw);
  document.getElementById("reportTime").append(new Option(timeLabel, timeLabel, true, true));
  document.getElementById("reportNature").value = report.natureOfViolation;

  const evidenceEl = document.getElementById("reportEvidence");
  if (evidenceEl) renderEvidence(evidenceEl, report.attachments);

  // Every status, in timeline order.
  const STATUSES_ORDERED = REPORT_STATUS_LABELS_ORDERED;
  const STATUS_PILL_CLASS = REPORT_STATUS_PILL_CLASS;

  const statusPill = document.getElementById("statusPill");
  const statusSelect = document.getElementById("statusSelect");
  const statusEditBtn = document.getElementById("statusEditBtn");
  const remarksInput = document.getElementById("remarksInput");
  const saveBtn = document.getElementById("saveChangesBtn");
  const timelineItems = document.getElementById("timelineItems");
  const backToReportsBtn = document.getElementById("backToReportsBtn");
  const saveConfirmModal = document.getElementById("saveConfirmModal");
  const saveConfirmOk = document.getElementById("saveConfirmOk");
  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");

  // ---- Claim (Investigators only; others just see who claimed it) ----
  const claimLabel = document.getElementById("claimLabel");
  const claimBtn = document.getElementById("claimBtn");
  const claimHint = document.getElementById("claimHint");
  const currentUser = getCurrentUser();
  const isInvestigator = currentUser && currentUser.position === "Investigator";

  // Editing is only for the Investigator who claimed this report (the server
  // checks this too). Runs again after claiming.
  function renderClaim() {
    const isMine = report.assignedInvestigatorId && currentUser && report.assignedInvestigatorId === currentUser.id;
    claimLabel.textContent = report.assignedInvestigator
      ? `${report.assignedInvestigator}${isMine ? " (you)" : ""}`
      : "Unclaimed";
    claimBtn.hidden = !isInvestigator || !!report.assignedInvestigator;

    const canEdit = !!(isInvestigator && isMine);
    statusEditBtn.hidden = !canEdit;
    remarksInput.disabled = !canEdit;
    remarksInput.placeholder = canEdit ? "Enter remarks to be shown to reportee." : "No remarks yet.";
    saveBtn.hidden = !canEdit;

    if (isInvestigator && !isMine) {
      claimHint.textContent = report.assignedInvestigator
        ? `Only ${report.assignedInvestigator} can update this report — it's claimed by them.`
        : "Claim this report to update its status or remarks.";
      claimHint.hidden = false;
    } else {
      claimHint.hidden = true;
    }
  }
  renderClaim();

  // ---- Download Report (Investigators; see /shared/js/report-form-download.js) ----
  const downloadBtn = document.getElementById("downloadReportBtn");
  if (isInvestigator) {
    downloadBtn.hidden = false;
    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "Preparing download...";
      try {
        await downloadReportForm({
          id: report.id,
          reportNumber: report.reportNumber,
          reporter: report.reporter,
          contactNumber: report.contactNumber,
          location: report.location,
          ordinance: report.ordinance,
          incidentDate: report.incidentDate,
          incidentTime: report.incidentTimeRaw,
          natureOfViolation: report.natureOfViolation,
          dateFiled: report.dateSubmitted,
          attachments: report.attachments,
        });
      } catch (err) {
        siteAlert(err.message || "Could not download this report.");
      } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Download Report";
      }
    });
  }

  claimBtn.addEventListener("click", async () => {
    if (!await siteConfirm(CLAIM_CONFIRM_MESSAGE, CLAIM_CONFIRM_OPTIONS)) return;
    claimBtn.disabled = true;
    try {
      report = await claimReport(report.id);
      renderClaim();
    } catch (err) {
      siteAlert(err.message);
    } finally {
      claimBtn.disabled = false;
    }
  });

  STATUSES_ORDERED.forEach((s) => statusSelect.append(new Option(s, s)));

  let currentStatus = report.status;
  remarksInput.value = report.remarks || "";

  // The saved values, to detect unsaved edits.
  let savedStatus = currentStatus;
  let savedRemarks = remarksInput.value.trim();

  function applyPill(status) {
    statusPill.className = `status-pill ${STATUS_PILL_CLASS[status]}`;
    statusPill.textContent = status;
  }

  function renderTimeline(status, dateSubmitted, dateUpdated) {
    // The timeline's own labels (its first step is "Submitted").
    const steps = [
      { label: "Submitted", description: "The report was submitted." },
      { label: "Under Review", description: "The report is being reviewed." },
      { label: "In Action", description: "Appropriate actions are being taken." },
      { label: "Resolved/With Remarks", description: "The report is finished and closed." },
    ];
    // Resolved and With Remarks both complete step 4.
    const completedSteps = isReportClosed(status) ? steps.length : STATUSES_ORDERED.indexOf(status) + 1;

    timelineItems.innerHTML = steps
      .map((step, i) => {
        const pending = i >= completedSteps;
        // Steps after "Submitted" are dated with the last update (only the current status is stored).
        const stepDate = i === 0 ? dateSubmitted : dateUpdated;
        const dateLabel = pending
          ? "Pending"
          : `${formatReportDate(stepDate)}, ${stepDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
        return `
          <div class="status-timeline__item">
            <span class="status-timeline__dot${pending ? " status-timeline__dot--pending" : ""}"></span>
            <div>
              <div class="status-timeline__meta">
                <span class="status-timeline__label${pending ? " status-timeline__label--pending" : ""}">${step.label}</span>
                <span class="status-timeline__date">${dateLabel}</span>
              </div>
              <p class="status-timeline__desc">${step.description}</p>
            </div>
          </div>`;
      })
      .join("");
  }

  applyPill(currentStatus);
  renderTimeline(currentStatus, report.dateSubmitted, report.dateUpdated);

  statusEditBtn.addEventListener("click", () => {
    statusSelect.value = currentStatus;
    statusPill.hidden = true;
    statusSelect.hidden = false;
  });

  function pendingStatus() {
    return statusSelect.hidden ? currentStatus : statusSelect.value;
  }

  // A changed status or changed remarks both count as unsaved.
  function isDirty() {
    return pendingStatus() !== savedStatus || remarksInput.value.trim() !== savedRemarks;
  }

  async function commitSave() {
    const nextStatus = pendingStatus();
    const patch = {
      status: nextStatus,
      remarks: remarksInput.value.trim(),
    };

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";
    try {
      report = await updateReportStatus(report.id, patch);
      // The server may have moved a New Submission with remarks to Under Review.
      currentStatus = report.status;
      savedStatus = currentStatus;
      savedRemarks = patch.remarks;

      applyPill(currentStatus);
      remarksInput.value = patch.remarks;
      statusPill.hidden = false;
      statusSelect.hidden = true;
      renderTimeline(currentStatus, report.dateSubmitted, report.dateUpdated);
          return true;
    } catch (err) {
      siteAlert(err.message);
      return false;
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
    }
  }

  saveBtn.addEventListener("click", async () => {
    if (await commitSave()) saveConfirmModal.hidden = false;
  });
  saveConfirmOk.addEventListener("click", () => {
    saveConfirmModal.hidden = true;
  });

  // "Back" returns to the page this report was opened from (or Reports).
  function goToReports() {
    let target = "reports.html";
    try {
      const from = new URL(document.referrer);
      if (
        from.origin === window.location.origin &&
        from.pathname.includes("/staff/") &&
        !/\/staff\/(index\.html)?$/.test(from.pathname) &&
        from.pathname !== window.location.pathname
      ) {
        target = from.href;
      }
    } catch {
      // No referrer (opened directly / from a bookmark).
    }
    window.location.href = target;
  }

  backToReportsBtn.addEventListener("click", () => {
    if (isDirty()) {
      unsavedChangesModal.hidden = false;
    } else {
      goToReports();
    }
  });
  unsavedSaveBtn.addEventListener("click", async () => {
    unsavedChangesModal.hidden = true;
    if (await commitSave()) goToReports();
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    goToReports();
  });
  unsavedCancelBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
  });
  [saveConfirmModal, unsavedChangesModal].forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
});
