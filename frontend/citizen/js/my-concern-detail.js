// Barangay Platero OVRMS — My Concern/Suggestion detail: fetch the real concern by the ?id= query param.

const CONCERN_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

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
// attached. Same idea as my-report-detail.js's renderEvidence — kept as
// its own small copy here since these two pages don't load each other's JS.
function renderConcernEvidence(container, urls) {
  if (!urls || !urls.length) {
    container.innerHTML = `<div class="evidence-photo">No uploaded evidence</div>`;
    return;
  }
  container.className = "evidence-photo-grid";
  container.innerHTML = urls
    .map((url) => {
      const isVideo = CONCERN_VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
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
  let concern = null;
  try {
    concern = id ? await getConcernById(id) : null;
  } catch {
    concern = null;
  }

  if (!concern) {
    document.querySelector(".concern-detail__main").innerHTML =
      "<p>Suggestion/Concern not found.</p>";
    return;
  }

  document.title = "Concern/Suggestion — Barangay Platero OVRMS";
  document.getElementById("concernLocation").value = concern.location;
  document.getElementById("concernDescription").value = concern.description;
  renderConcernEvidence(document.getElementById("concernEvidence"), concern.attachments);

  // Two stages, mirroring Concern.Status: Submitted, then Reviewed once the
  // Secretary has read it (their reply, if any, is the Remarks card below).
  const formatDateTime = (iso) =>
    new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const reviewed = concern.status === "reviewed";
  const steps = [
    { label: "Submitted", description: "Your concern/suggestion was submitted successfully.", pending: false, at: concern.created_at },
    {
      label: "Reviewed",
      description: reviewed
        ? "A Barangay Official has read your concern/suggestion."
        : "Waiting for a Barangay Official to read your concern/suggestion.",
      pending: !reviewed,
      at: concern.reviewed_at || concern.updated_at,
    },
  ];
  document.getElementById("timelineItems").innerHTML = steps
    .map(
      (step) => `
      <div class="status-timeline__item">
        <span class="status-timeline__dot${step.pending ? " status-timeline__dot--pending" : ""}"></span>
        <div>
          <div class="status-timeline__meta">
            <span class="status-timeline__label${step.pending ? " status-timeline__label--pending" : ""}">${step.label}</span>
            <span class="status-timeline__date">${step.pending ? "Pending" : formatDateTime(step.at)}</span>
          </div>
          <p class="status-timeline__desc">${step.description}</p>
        </div>
      </div>`
    )
    .join("");

  if (concern.remarks) {
    document.getElementById("remarksCard").hidden = false;
    document.getElementById("remarksText").textContent = concern.remarks;
    showRemarksPopupOnce(concern.id, concern.remarks);
  }
});

// Pops up once per concern/suggestion the first time its remarks are seen —
// afterwards the remarks stay visible inline in the sidebar, same as always.
function showRemarksPopupOnce(concernId, remarks) {
  const SEEN_KEY = "orms_citizen_seen_concern_remarks";
  let seen;
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || [];
  } catch {
    seen = [];
  }
  if (seen.includes(concernId)) return;

  document.getElementById("remarksPopupText").textContent = remarks;
  document.getElementById("remarksPopupModal").hidden = false;

  seen.push(concernId);
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}
