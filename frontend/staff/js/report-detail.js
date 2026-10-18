// Barangay Platero OVRMS — Report detail: view a report's real info and let staff change
// its status and remarks (remarks are always editable, independent of
// status — not gated to one specific status choice). Saves go through
// updateReportStatus (PATCH /api/reports/staff/<id>/) instead of the old
// localStorage-only mock.

function formatTime12h(hhmmss) {
  if (!hhmmss) return "Not specified";
  const [h, m] = hhmmss.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const REPORT_EVIDENCE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

// Opens the clicked thumbnail full-size in an overlay on this same page,
// instead of navigating to it in a new tab.
function openMediaLightbox(url, isVideo) {
  const lightbox = document.getElementById("mediaLightbox");
  const body = document.getElementById("mediaLightboxBody");
  if (!lightbox || !body) return;
  body.innerHTML = isVideo
    ? `<video src="${url}" controls autoplay></video>`
    : `<img src="${url}" alt="Uploaded evidence" />`;
  lightbox.hidden = false;
}

function renderReportEvidence(container, urls) {
  if (!urls || !urls.length) {
    container.innerHTML = `<div class="evidence-photo">No uploaded evidence</div>`;
    return;
  }
  container.className = "evidence-photo-grid";
  container.innerHTML = urls
    .map((url) => {
      const isVideo = REPORT_EVIDENCE_VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
      const media = isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="Uploaded evidence" />`;
      return `<button type="button" class="evidence-photo-grid__item" data-lightbox-url="${url}" data-lightbox-video="${isVideo}">${media}</button>`;
    })
    .join("");
  container.querySelectorAll("[data-lightbox-url]").forEach((btn) => {
    btn.addEventListener("click", () => openMediaLightbox(btn.dataset.lightboxUrl, btn.dataset.lightboxVideo === "true"));
  });
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
  if (evidenceEl) renderReportEvidence(evidenceEl, report.attachments);

  // Every status, in timeline order (see reports-data.js) — Resolved and
  // With Remarks are the two ways a report reaches the last stage.
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

  // ---- Claim (Investigator only — Reports is their section, see
  // frontend/staff/js/admin.js's STAFF_NAV_ACCESS). Barangay Captain/
  // Secretary reaching this page (e.g. Captain's dashboard "View Details")
  // just see who's on it, read-only. A claim is permanent: Investigators
  // can't forfeit it (only an Administrator can release one server-side,
  // see StaffReportForfeitView), so claiming asks for confirmation first. ----
  const claimLabel = document.getElementById("claimLabel");
  const claimBtn = document.getElementById("claimBtn");
  const claimHint = document.getElementById("claimHint");
  const currentUser = getAdminUser();
  const isInvestigator = currentUser && currentUser.position === "Investigator";

  // Status/remarks editing is Investigator-only, and even then only on a
  // report this Investigator has claimed — an unclaimed report, or one
  // someone else holds, is read-only (enforced server-side too, see
  // StaffReportDetailView.patch). Barangay Captain always gets a read-only
  // view. Re-run after claiming so editing turns on with it.
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

  // ---- Download Report (Investigator only — the citizen gets the same
  // form from My Report Detail; see /citizen/js/report-form-download.js) ----
  const downloadBtn = document.getElementById("downloadReportBtn");
  if (isInvestigator) {
    downloadBtn.hidden = false;
    downloadBtn.addEventListener("click", async () => {
      downloadBtn.disabled = true;
      downloadBtn.textContent = "Preparing download...";
      try {
        await downloadReportForm({
          id: report.id,
          reporter: report.reporter,
          contactNumber: report.contactNumber,
          location: report.location,
          ordinance: report.ordinance,
          incidentDate: report.incidentDate,
          incidentTime: report.incidentTimeRaw,
          natureOfViolation: report.natureOfViolation,
          status: report.status,
          remarks: report.remarks,
          investigator: report.assignedInvestigator,
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
    if (!await siteConfirm(CLAIM_CONFIRM_MESSAGE)) return;
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

  // Snapshot of what's actually persisted, so we can tell whether the user
  // has made edits that haven't been saved yet.
  let savedStatus = currentStatus;
  let savedRemarks = remarksInput.value.trim();

  function applyPill(status) {
    statusPill.className = `status-pill ${STATUS_PILL_CLASS[status]}`;
    statusPill.textContent = status;
  }

  function renderTimeline(status, dateSubmitted, dateUpdated) {
    const steps = [
      { label: "Submitted", description: "The report was submitted." },
      { label: "Under Review", description: "The report is being reviewed" },
      { label: "In Action", description: "Appropriate actions are being taken." },
      { label: "Resolved/With Remarks", description: "Report is finished and closed." },
    ];
    // Submitted/Under Review/In Action are stages 1-3; Resolved and With
    // Remarks both complete the 4th.
    const completedSteps = isReportClosed(status) ? steps.length : STATUSES_ORDERED.indexOf(status) + 1;

    timelineItems.innerHTML = steps
      .map((step, i) => {
        const pending = i >= completedSteps;
        // There's no per-stage history (just one status field), so every
        // completed stage past "Submitted" is dated with the report's last
        // update time — the best real timestamp available, rather than a
        // fabricated offset.
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

  // Remarks are always editable, so a remarks edit counts as dirty
  // regardless of which status is currently selected.
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
      currentStatus = nextStatus;
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

  function goToReports() {
    window.location.href = "reports.html";
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
