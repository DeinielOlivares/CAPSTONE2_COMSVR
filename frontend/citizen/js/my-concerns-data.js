// Barangay Platero OVRMS — My Concerns/Suggestions data, backed by the real API.

async function getMyConcerns() {
  const response = await authFetch("/api/concerns/");
  if (!response.ok) {
    throw new Error("Could not load your concerns/suggestions. Try refreshing the page.");
  }
  return response.json();
}

async function getConcernById(id) {
  const response = await authFetch(`/api/concerns/${encodeURIComponent(id)}/`);
  if (!response.ok) return null;
  return response.json();
}
