// evidence.js — the uploaded photos/videos of a report or concern, shown as
// thumbnails. Clicking one opens it full-size in the page's #mediaLightbox
// popup. Used by the citizen and staff report/concern detail pages.

const EVIDENCE_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

function openMediaLightbox(url, isVideo) {
  const lightbox = document.getElementById("mediaLightbox");
  const body = document.getElementById("mediaLightboxBody");
  if (!lightbox || !body) return;
  body.innerHTML = isVideo
    ? `<video src="${url}" controls autoplay></video>`
    : `<img src="${url}" alt="Uploaded evidence" />`;
  lightbox.hidden = false;
}

// Fills `container` with a thumbnail per file URL, or "No uploaded evidence".
function renderEvidence(container, urls) {
  if (!urls || !urls.length) {
    container.innerHTML = `<div class="evidence-photo">No uploaded evidence</div>`;
    return;
  }
  container.className = "evidence-photo-grid";
  container.innerHTML = urls
    .map((url) => {
      const isVideo = EVIDENCE_VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().endsWith(ext));
      const media = isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="Uploaded evidence" />`;
      return `<button type="button" class="evidence-photo-grid__item" data-lightbox-url="${url}" data-lightbox-video="${isVideo}">${media}</button>`;
    })
    .join("");
  container.querySelectorAll("[data-lightbox-url]").forEach((btn) => {
    btn.addEventListener("click", () => openMediaLightbox(btn.dataset.lightboxUrl, btn.dataset.lightboxVideo === "true"));
  });
}
