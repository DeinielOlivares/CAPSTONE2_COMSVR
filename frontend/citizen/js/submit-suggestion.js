// Submit Suggestion (citizen): sends the concern/suggestion with POST /api/concerns/.

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("suggestionForm");
  const submitBtn = form.querySelector('button[type="submit"]');
  const successModal = document.getElementById("successModal");
  const unsavedGuard = guardUnsavedForm(form);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);

    if (!isLoggedIn()) {
      showFormError(form, "Please log in to submit a concern/suggestion.");
      return;
    }

    const formData = new FormData();
    formData.append("description", document.getElementById("suggestionDetails").value.trim());
    Array.from(document.getElementById("suggestionFiles").files).forEach((file) => formData.append("files", file));

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    try {
      const response = await authFetch("/api/concerns/", { method: "POST", body: formData });
      if (!response.ok) {
        // Show the first field error or {detail}; otherwise the status code.
        const data = await response.json().catch(() => ({}));
        const firstError = Object.values(data)[0];
        if (Array.isArray(firstError)) throw new Error(firstError[0]);
        if (typeof firstError === "string") throw new Error(firstError);
        throw new Error(`Could not submit your concern/suggestion. (server responded ${response.status})`);
      }
      unsavedGuard.allowLeave();
      successModal.hidden = false;
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Suggestion";
    }
  });

  successModal.querySelectorAll("[data-modal-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "ordinances.html";
    });
  });
});
