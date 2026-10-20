// Barangay Platero OVRMS — shared pagination controls: First/Prev/[page numbers with
// ellipsis]/Next/Last, plus a "Page X of Y" button that prompts for a
// specific page to jump to. Used by every paginated list on this portal.

function buildPageNumberList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("...");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

// Jump-to-page modal, built once and reused by every paginated list on the
// page — a real modal-overlay/modal-card (matching the rest of the site)
// instead of the browser's native window.prompt()/siteAlert().
let jumpModalEl = null;

function ensureJumpModal() {
  if (jumpModalEl) return jumpModalEl;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "paginationJumpModal";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="modal-card">
      <button type="button" class="modal-close" aria-label="Close">&times;</button>
      <h2>Go to Page</h2>
      <div class="field">
        <label id="paginationJumpLabel" for="paginationJumpInput"></label>
        <input type="number" id="paginationJumpInput" step="1" />
      </div>
      <p id="paginationJumpError" hidden style="color:#c0392b;margin:0 0 12px;font-size:0.85rem;"></p>
      <div class="btn-row">
        <button type="button" class="btn btn-muted" data-jump-cancel>Cancel</button>
        <button type="button" class="btn" data-jump-go>Go</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeModal = () => { overlay.hidden = true; };
  overlay.querySelector(".modal-close").addEventListener("click", closeModal);
  overlay.querySelector("[data-jump-cancel]").addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });

  jumpModalEl = overlay;
  return overlay;
}

function showJumpToPageModal(current, total, onGoTo) {
  const overlay = ensureJumpModal();
  const label = overlay.querySelector("#paginationJumpLabel");
  const input = overlay.querySelector("#paginationJumpInput");
  const error = overlay.querySelector("#paginationJumpError");
  const goBtn = overlay.querySelector("[data-jump-go]");

  label.textContent = `Page number (1–${total}):`;
  input.min = 1;
  input.max = total;
  input.value = current;
  error.hidden = true;
  overlay.hidden = false;
  input.focus();
  input.select();

  function submit() {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 1 || n > total) {
      error.textContent = `Please enter a whole number between 1 and ${total}.`;
      error.hidden = false;
      return;
    }
    overlay.hidden = true;
    onGoTo(n);
  }

  // Reassigned (not addEventListener'd) each call — this modal is a reused
  // singleton, so stacking listeners across repeated opens would fire the
  // callback once per prior open.
  goBtn.onclick = submit;
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      overlay.hidden = true;
    }
  };
}

// container: element to render the controls into.
// page/totalPages: current pagination state (1-indexed).
// goToPage(n): callback that changes to page n and re-renders.
function renderPaginationControls(container, page, totalPages, goToPage) {
  const safeTotal = Math.max(1, totalPages);
  const pages = buildPageNumberList(page, safeTotal);

  let html = `<button type="button" data-goto="first" ${page <= 1 ? "disabled" : ""} aria-label="First page">&#171;</button>`;
  html += `<button type="button" data-goto="prev" ${page <= 1 ? "disabled" : ""} aria-label="Previous page">&#8249;</button>`;
  pages.forEach((p) => {
    html +=
      p === "..."
        ? `<span class="dash-pagination__ellipsis">&hellip;</span>`
        : `<button type="button" data-goto="${p}" class="${p === page ? "active" : ""}">${p}</button>`;
  });
  html += `<button type="button" data-goto="next" ${page >= safeTotal ? "disabled" : ""} aria-label="Next page">&#8250;</button>`;
  html += `<button type="button" data-goto="last" ${page >= safeTotal ? "disabled" : ""} aria-label="Last page">&#187;</button>`;
  html += `<button type="button" class="pagination-jump-btn" data-goto="jump">Page ${page} of ${safeTotal}</button>`;
  container.innerHTML = html;

  container.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.goto;
      if (val === "jump") {
        showJumpToPageModal(page, safeTotal, goToPage);
        return;
      }
      if (val === "first") return goToPage(1);
      if (val === "prev") return goToPage(page - 1);
      if (val === "next") return goToPage(page + 1);
      if (val === "last") return goToPage(safeTotal);
      goToPage(Number(val));
    });
  });
}
