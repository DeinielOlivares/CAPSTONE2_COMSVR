// Barangay Platero OVRMS — Manage FAQs: the public FAQ list shown on the
// citizen FAQs page. Split out from Answer Questions (questions-list.js),
// which is now citizen questions only — see questions-data.js for the
// shared FAQ API calls (getManagedFAQs/createFAQ/updateFAQ/deleteFAQ).

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", async () => {
  const faqManageList = document.getElementById("faqManageList");
  const addFaqBtn = document.getElementById("addFaqBtn");

  const faqModal = document.getElementById("faqModal");
  const faqModalTitle = document.getElementById("faqModalTitle");
  const faqQuestionInput = document.getElementById("faqQuestionInput");
  const faqAnswerInput = document.getElementById("faqAnswerInput");
  const faqModalSave = document.getElementById("faqModalSave");
  const faqModalCancel = document.getElementById("faqModalCancel");

  const faqDeleteModal = document.getElementById("faqDeleteModal");
  const faqDeleteConfirm = document.getElementById("faqDeleteConfirm");
  const faqDeleteCancel = document.getElementById("faqDeleteCancel");

  let faqs = [];
  let editingFaqId = null; // null while adding a brand-new FAQ
  let deletingFaqId = null;

  function renderFaqManageList() {
    if (!faqManageList) return;
    if (!faqs.length) {
      faqManageList.innerHTML = `<div class="ordinances-empty">No FAQs yet.</div>`;
      return;
    }
    faqManageList.innerHTML = faqs
      .map(
        (f) => `
        <div class="faq-manage-item">
          <div class="faq-manage-item__content">
            <span class="faq-manage-item__question">${escapeHtml(f.question)}</span>
            <span class="faq-manage-item__answer">${escapeHtml(f.answer)}</span>
          </div>
          <span class="faq-manage-item__actions">
            <button type="button" data-edit-faq="${f.id}" aria-label="Edit"><svg class="nav-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20H5.5a1.5 1.5 0 01-1.5-1.5V12"/><path d="M17.4 3.6a2.1 2.1 0 013 3L10 17l-4.5 1.2L6.8 13.7z"/></svg></button>
            <button type="button" data-delete-faq="${f.id}" aria-label="Delete"><svg class="nav-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 7h15"/><path d="M9.5 7V5a1.5 1.5 0 011.5-1.5h2A1.5 1.5 0 0114.5 5v2"/><path d="M6.5 7l1 12a1.5 1.5 0 001.5 1.4h6a1.5 1.5 0 001.5-1.4l1-12"/><path d="M10 11v6M14 11v6"/></svg></button>
          </span>
        </div>`
      )
      .join("");

    faqManageList.querySelectorAll("[data-edit-faq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const faq = faqs.find((f) => f.id === btn.dataset.editFaq);
        if (faq) openFaqModal(faq.id, faq);
      });
    });
    faqManageList.querySelectorAll("[data-delete-faq]").forEach((btn) => {
      btn.addEventListener("click", () => {
        deletingFaqId = btn.dataset.deleteFaq;
        if (faqDeleteModal) faqDeleteModal.hidden = false;
      });
    });
  }

  function openFaqModal(id, { question, answer }) {
    editingFaqId = id;
    if (faqModalTitle) faqModalTitle.textContent = id ? "Edit FAQ" : "Add FAQ";
    if (faqQuestionInput) faqQuestionInput.value = question || "";
    if (faqAnswerInput) faqAnswerInput.value = answer || "";
    if (faqModal) faqModal.hidden = false;
  }

  if (addFaqBtn) {
    addFaqBtn.addEventListener("click", () => openFaqModal(null, { question: "", answer: "" }));
  }

  if (faqModalCancel) {
    faqModalCancel.addEventListener("click", () => {
      if (faqModal) faqModal.hidden = true;
    });
  }

  if (faqModalSave) {
    faqModalSave.addEventListener("click", async () => {
      const question = faqQuestionInput.value.trim();
      const answer = faqAnswerInput.value.trim();
      if (!question || !answer) {
        siteAlert("Both a question and an answer are required.");
        return;
      }

      faqModalSave.disabled = true;
      try {
        if (editingFaqId) {
          const updated = await updateFAQ(editingFaqId, question, answer);
          const idx = faqs.findIndex((f) => f.id === updated.id);
          if (idx !== -1) faqs[idx] = updated;
        } else {
          const created = await createFAQ(question, answer);
          faqs.push(created);
        }
        renderFaqManageList();
        faqModal.hidden = true;
      } catch (err) {
        siteAlert(err.message);
      } finally {
        faqModalSave.disabled = false;
      }
    });
  }

  if (faqDeleteCancel) {
    faqDeleteCancel.addEventListener("click", () => {
      deletingFaqId = null;
      if (faqDeleteModal) faqDeleteModal.hidden = true;
    });
  }

  if (faqDeleteConfirm) {
    faqDeleteConfirm.addEventListener("click", async () => {
      if (!deletingFaqId) return;
      faqDeleteConfirm.disabled = true;
      try {
        await deleteFAQ(deletingFaqId);
        faqs = faqs.filter((f) => f.id !== deletingFaqId);
        renderFaqManageList();
        faqDeleteModal.hidden = true;
      } catch (err) {
        siteAlert(err.message);
      } finally {
        faqDeleteConfirm.disabled = false;
        deletingFaqId = null;
      }
    });
  }

  if (faqManageList) faqManageList.innerHTML = skeletonCards(4);

  try {
    faqs = await getManagedFAQs();
    renderFaqManageList();
  } catch (err) {
    if (faqManageList) faqManageList.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
  }
});
