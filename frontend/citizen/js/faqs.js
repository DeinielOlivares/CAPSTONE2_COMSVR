// Barangay Platero OVRMS — FAQs page: renders the public FAQ accordion. (The floating
// "Ask a Question" "?" button itself is wired globally in main.js — it's on
// every citizen page, not just this one.)

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderFaqAccordion(container, items, { openFirst = false } = {}) {
  if (!items.length) {
    container.innerHTML = `<div class="ordinances-empty">Nothing here yet.</div>`;
    return;
  }
  container.innerHTML = items
    .map(
      (item, i) => `
      <details class="faq-item"${openFirst && i === 0 ? " open" : ""}>
        <summary>${item.summary}</summary>
        <div class="faq-item__answer">${item.answer}</div>
      </details>`
    )
    .join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  const faqList = document.getElementById("faqList");

  // ---- Public FAQ list ----
  try {
    const faqs = await getFAQs();
    renderFaqAccordion(
      faqList,
      faqs.map((f) => ({ summary: escapeHtml(f.question), answer: escapeHtml(f.answer) })),
      { openFirst: true }
    );
  } catch (err) {
    faqList.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
  }
});
