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
