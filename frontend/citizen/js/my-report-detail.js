// Barangay Platero OVRMS — My Report detail: fetch the real report by the ?id= query param.

const REPORT_TIMELINE_STEPS = [
  { label: "Submitted", description: "Your report has been submitted successfully." },
  { label: "Under Review", description: "Your report is being reviewed." },
  { label: "In Action", description: "Appropriate actions are being taken." },
  { label: "Resolved", description: "Your report is finished and closed." },
];

// How many of the 4 steps count as "done" for a given backend status. There's
// no per-stage history yet (just one status field), so anything past step 1
// is dated with updated_at as the best available approximation of when that
// stage was reached, rather than a fabricated date. Statuses mirror the 4
// stages above exactly, so this is just each status's position.
const REPORT_COMPLETED_STEPS = { submitted: 1, under_review: 2, in_action: 3, resolved: 4 };

function formatTime12h(hhmm) {
  if (!hhmm) return "Not specified";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

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

// Renders the real uploaded files (photos/videos) into `container`, or
// falls back to a plain "No uploaded evidence" notice when nothing was
// attached — same box either way, just with or without real content.
function renderEvidence(container, urls) {
  if (!urls || !urls.length) {
    container.innerHTML = `<div class="evidence-photo">No uploaded evidence</div>`;
    return;
  }
  container.className = "evidence-photo-grid";
  container.innerHTML = urls
    .map((url) => {
      const isVideo = VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
      const media = isVideo
        ? `<video src="${url}" muted></video>`
        : `<img src="${url}" alt="Uploaded evidence" />`;
      return `<button type="button" class="evidence-photo-grid__item" data-lightbox-url="${url}" data-lightbox-video="${isVideo}">${media}</button>`;
    })
    .join("");
  container.querySelectorAll("[data-lightbox-url]").forEach((btn) => {
    btn.addEventListener("click", () => openMediaLightbox(btn.dataset.lightboxUrl, btn.dataset.lightboxVideo === "true"));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");
  let report = null;
  try {
    report = id ? await getReportById(id) : null;
  } catch {
    report = null;
  }

  if (!report) {
    document.querySelector(".concern-detail__main").innerHTML = "<p>Report not found.</p>";
    return;
  }

  document.title = `${report.ordinance} — Barangay Platero OVRMS`;

  document.getElementById("reportLocation").value = report.location;
  document.getElementById("reportOrdinance").append(new Option(report.ordinance, report.ordinance, true, true));
  document.getElementById("reportDate").value = report.incident_date;
  const timeLabel = formatTime12h(report.incident_time);
  document.getElementById("reportTime").append(new Option(timeLabel, timeLabel, true, true));
  document.getElementById("reportNature").value = report.nature_of_violation;
  renderEvidence(document.getElementById("evidencePhoto"), report.attachments);

  const completedSteps = REPORT_COMPLETED_STEPS[report.status] || 1;
  const timelineItems = document.getElementById("timelineItems");
  timelineItems.innerHTML = REPORT_TIMELINE_STEPS.map((step, i) => {
    const pending = i >= completedSteps;
    const at = i === 0 ? report.created_at : report.updated_at;
    return `
      <div class="status-timeline__item">
        <span class="status-timeline__dot${pending ? " status-timeline__dot--pending" : ""}"></span>
        <div>
          <div class="status-timeline__meta">
            <span class="status-timeline__label${pending ? " status-timeline__label--pending" : ""}">${step.label}</span>
            <span class="status-timeline__date">${pending ? "Pending" : formatDateTime(at)}</span>
          </div>
          <p class="status-timeline__desc">${step.description}</p>
        </div>
      </div>`;
  }).join("");

  if (report.remarks) {
    document.getElementById("remarksCard").hidden = false;
    document.getElementById("remarksText").textContent = report.remarks;
  }

  document.getElementById("investigatorClaimedBy").textContent = report.claimed_by
    ? `Claimed by ${report.claimed_by}`
    : "Not yet claimed by an investigator.";
  document.getElementById("investigatorLastOpened").textContent = report.investigator_last_viewed_at
    ? `Last opened by the investigator on ${formatDateTime(report.investigator_last_viewed_at)}`
    : "Not yet opened by the investigator.";
});
