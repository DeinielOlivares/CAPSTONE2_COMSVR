// Barangay Platero OVRMS — in-page PDF preview for the ordinance detail pages (citizen
// and staff both load this file).
//
// Renders each page of the PDF onto a <canvas> with PDF.js instead of
// pointing an <iframe> at something else:
//   - <iframe src="file.pdf"> shows only a bare "Open" fallback on mobile
//     browsers, which have no built-in PDF plugin.
//   - Google's Docs viewer (docs.google.com/viewer?url=...), used before
//     this, answers with a file download whenever it can't fetch or convert
//     the document — the browser then shows failed "viewer" downloads the
//     moment the page opens, without anyone clicking Download.
// Drawing the pages ourselves has neither problem and never downloads
// anything to the user's device.
//
// Depends (load order): /citizen/vendor/pdfjs/pdf.min.js — then this file.

const PDF_PREVIEW_WORKER_SRC = "/citizen/vendor/pdfjs/pdf.worker.min.js";
// Sharp enough on phones' high-density screens without making a long
// ordinance's canvases enormous.
const PDF_PREVIEW_MAX_PIXEL_RATIO = 2;

// Renders the PDF at `url` into `container` (a .pdf-preview__frame div),
// one canvas per page, each scaled to the container's width. Calling it
// again on the same container (e.g. Staff replaced the PDF) cancels the
// previous render. Resolves true once every page is drawn, false if the
// PDF couldn't be shown — a short message is left in the container then,
// and the page's download button remains the way to get the file.
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
