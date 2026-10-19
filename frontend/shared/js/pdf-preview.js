// pdf-preview.js — shows an ordinance PDF inside the page (citizen and staff
// ordinance detail pages). Each PDF page is drawn on a <canvas> with PDF.js,
// which also works on phones (they can't show PDFs in an <iframe>).
// Load /shared/vendor/pdfjs/pdf.min.js first.

const PDF_PREVIEW_WORKER_SRC = "/shared/vendor/pdfjs/pdf.worker.min.js";
// Sharp on high-density phone screens without making huge canvases.
const PDF_PREVIEW_MAX_PIXEL_RATIO = 2;

// Draws the PDF at `url` into `container` (one canvas per page, full width).
// Calling it again on the same container cancels the previous drawing.
// Resolves true when done, or false (with a short message) if it failed.
async function renderPdfPreview(container, url) {
  const token = {};
  container._pdfPreviewToken = token;
  const stale = () => container._pdfPreviewToken !== token;

  container.innerHTML = '<div class="skeleton skeleton-block"></div>';

  try {
    if (typeof pdfjsLib === "undefined") throw new Error("PDF.js not loaded");
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_PREVIEW_WORKER_SRC;

    const pdf = await pdfjsLib.getDocument({ url }).promise;
    if (stale()) return false;

    container.innerHTML = "";
    const width = container.clientWidth || 600;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, PDF_PREVIEW_MAX_PIXEL_RATIO);

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      if (stale()) return false;

      const scale = width / page.getViewport({ scale: 1 }).width;
      const viewport = page.getViewport({ scale: scale * pixelRatio });
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-preview__page";
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", `Page ${pageNumber} of ${pdf.numPages}`);
      container.appendChild(canvas);

      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      if (stale()) return false;
    }
    return true;
  } catch (err) {
    if (stale()) return false;
    console.warn("[pdf-preview] could not render", url, err);
    container.innerHTML =
      '<p class="pdf-preview__fallback">The preview couldn\'t be shown here. Use the download button below to open the file.</p>';
    return false;
  }
}
