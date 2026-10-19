// Ordinance detail (citizen): shows the ordinance given by ?id= with a PDF preview.

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");

  try {
    await ensureOrdinancesLoaded();
  } catch (err) {
    document.getElementById("detailTitle").textContent = err.message;
    document.getElementById("detailBody").hidden = true;
    return;
  }

  const ordinance = getOrdinanceById(id);

  if (!ordinance) {
    document.getElementById("detailTitle").textContent = "Document not found";
    document.getElementById("detailBody").hidden = true;
    return;
  }

  const backLink = document.querySelector(".detail-back");
  if (backLink) {
    backLink.href = document.referrer.endsWith("/home.html") || document.referrer.endsWith("home.html")
      ? "home.html"
      : "ordinances.html";
  }

  if (isLoggedIn()) {
    authFetch(`/api/ordinances/${encodeURIComponent(id)}/view/`, { method: "POST" }).catch(() => {});
  }

  document.title = `${ordinance.number} — Barangay Platero OVRMS`;
  document.getElementById("detailTitle").textContent = `City Ordinance ${ordinance.number}`;
  document.getElementById("detailAuthor").textContent = ordinance.author;
  document.getElementById("detailDate").textContent = ordinance.dateApproved;
  document.getElementById("detailOrdinanceTitle").textContent = ordinance.title;
  document.getElementById("detailCategory").textContent = ordinance.category || "—";

  const descriptionEl = document.getElementById("detailDescription");
  descriptionEl.innerHTML = "";
  ordinance.description.split("\n\n").forEach((para) => {
    const p = document.createElement("p");
    p.textContent = para;
    p.style.margin = "0 0 12px";
    descriptionEl.appendChild(p);
  });

  const pdfPreview = document.getElementById("pdfPreview");
  const pdfPreviewFrame = document.getElementById("pdfPreviewFrame");
  const pdfPreviewNote = document.getElementById("pdfPreviewNote");
  const downloadBtn = document.getElementById("detailDownload");
  if (ordinance.pdf) {
    renderPdfPreview(pdfPreviewFrame, ordinance.pdf);
    pdfPreview.hidden = false;
    pdfPreviewNote.hidden = false;
    downloadBtn.hidden = false;
    downloadBtn.href = "#";
    downloadBtn.textContent = `Download ${ordinance.number}`;

    // Downloads go through the API (one per citizen, logged).
    // Guests get the Sign Up / Login prompt.
    downloadBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (!isLoggedIn()) {
        const authGateModal = document.getElementById("authGateModal");
        const authGateTitle = document.getElementById("authGateTitle");
        if (authGateModal && authGateTitle) {
          authGateTitle.textContent = "Want to Download This Ordinance?";
          authGateModal.hidden = false;
        }
        return;
      }

      const originalText = downloadBtn.textContent;
      downloadBtn.textContent = "Preparing download...";
      try {
        const response = await authFetch(`/api/ordinances/${encodeURIComponent(ordinance.id)}/download/`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          siteAlert(data.detail || "Could not download this ordinance.");
          return;
        }
        window.open(data.pdf_url, "_blank", "noopener");
      } catch {
        siteAlert("Could not download this ordinance. Please try again.");
      } finally {
        downloadBtn.textContent = originalText;
      }
    });
  } else {
    pdfPreview.hidden = true;
    pdfPreviewNote.hidden = true;
    downloadBtn.hidden = true;
  }
});
