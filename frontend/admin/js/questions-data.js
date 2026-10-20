// Barangay Platero OVRMS — Questions data, backed by the real API (GET /api/questions/staff/).

async function getQuestions() {
  const response = await authFetch("/api/questions/staff/");
  if (!response.ok) throw new Error("Could not load questions.");
  return response.json();
}

async function answerQuestion(id, answer) {
  const response = await authFetch(`/api/questions/staff/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not send the answer.");
  }
  return response.json();
}

// ---- FAQ management (Admin only) ----

async function getManagedFAQs() {
  const response = await authFetch("/api/faqs/admin/");
  if (!response.ok) throw new Error("Could not load the FAQ list.");
  return response.json();
}

async function createFAQ(question, answer) {
  const response = await authFetch("/api/faqs/admin/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not add this FAQ.");
  }
  return response.json();
}

async function updateFAQ(id, question, answer) {
  const response = await authFetch(`/api/faqs/admin/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, answer }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not update this FAQ.");
  }
  return response.json();
}

async function deleteFAQ(id) {
  const response = await authFetch(`/api/faqs/admin/${encodeURIComponent(id)}/`, { method: "DELETE" });
  if (!response.ok) throw new Error("Could not delete this FAQ.");
}
