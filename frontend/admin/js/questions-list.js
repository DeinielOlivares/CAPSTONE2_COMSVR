// Answer Questions (admin): citizens' questions with a reply box (answered ones stay listed).

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function formatQuestionDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

document.addEventListener("DOMContentLoaded", async () => {
  let pageSize = 5;

  const list = document.getElementById("questionsList");
  const statusFilter = document.getElementById("statusFilter");
  const pagination = document.getElementById("questionsPagination");
  const pageSizeSelect = document.getElementById("questionsPageSize");

  const memory = createFilterMemory("admin_questions");
  memory.bindSelect(statusFilter);
  memory.bindSelect(pageSizeSelect);
  pageSize = pageSizeFrom(pageSizeSelect, pageSize);

  let questions = [];
  let page = memory.get("page", 1);

  // ---- Citizen questions ----

  function renderQuestions() {
    if (!list) return;
    const filterValue = statusFilter ? statusFilter.value : "all";
    const filtered = questions.filter((q) => {
      if (filterValue === "pending") return !q.is_answered;
      if (filterValue === "answered") return q.is_answered;
      return true;
    });

    const totalPages = pageSize ? Math.max(1, Math.ceil(filtered.length / pageSize)) : 1;
    page = Math.min(page, totalPages);
    memory.set("page", page);
    const start = pageSize ? (page - 1) * pageSize : 0;
    const rows = pageSize ? filtered.slice(start, start + pageSize) : filtered;

    if (pagination) {
      renderPaginationControls(pagination, page, totalPages, (n) => {
        page = n;
        renderQuestions();
      });
    }

    if (!rows.length) {
      list.innerHTML = `<div class="ordinances-empty">${questions.length ? "No questions match this filter." : "No questions asked yet."}</div>`;
      return;
    }

    list.innerHTML = rows
      .map(
        (q) => `
        <div class="question-row" data-id="${q.id}">
          <div class="question-row__top">
            <div>
              <div class="question-row__text">${escapeHtml(q.question)}</div>
              <div class="question-row__meta">Asked by ${escapeHtml(q.asker)} (${escapeHtml(q.asker_email)}) — ${formatQuestionDate(q.created_at)}</div>
            </div>
            <span class="status-badge ${q.is_answered ? "status-badge--resolved" : "status-badge--submitted"}">${q.is_answered ? "Answered" : "Pending"}</span>
          </div>
          ${
            q.is_answered
              ? `<div class="question-row__answer">
                   <p class="question-row__answer-label">Answer${q.answered_by_name ? ` — ${escapeHtml(q.answered_by_name)} (${escapeHtml(q.answered_by_role || "")})` : ""}</p>
                   ${escapeHtml(q.answer)}
                 </div>`
              : `<div class="question-row__respond">
                  <textarea placeholder="Type your answer..." data-answer-input></textarea>
                  <button type="button" class="btn" data-send-answer>Send Answer</button>
                </div>`
          }
        </div>`
      )
      .join("");

    list.querySelectorAll("[data-send-answer]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".question-row");
        const textarea = row.querySelector("[data-answer-input]");
        const value = textarea.value.trim();
        if (!value) return;

        btn.disabled = true;
        btn.textContent = "Sending...";
        try {
          const updated = await answerQuestion(row.dataset.id, value);
          const idx = questions.findIndex((item) => item.id === updated.id);
          if (idx !== -1) questions[idx] = updated;
          renderQuestions();
        } catch (err) {
          siteAlert(err.message);
          btn.disabled = false;
          btn.textContent = "Send Answer";
        }
      });
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      page = 1;
      renderQuestions();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener("change", () => {
      pageSize = pageSizeSelect.value === "all" ? null : Number(pageSizeSelect.value);
      page = 1;
      renderQuestions();
    });
  }

  wireFiltersDropdown(document.getElementById("filtersToggleBtn"), document.getElementById("filtersPanel"));

  if (list) list.innerHTML = skeletonCards(4);

  try {
    questions = await getQuestions();
    renderQuestions();
  } catch (err) {
    if (list) list.innerHTML = `<div class="ordinances-empty">${err.message}</div>`;
  }
});
