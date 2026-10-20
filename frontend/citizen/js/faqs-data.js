// Barangay Platero OVRMS — FAQs page data: the public curated FAQ list. (askQuestion()
// now lives in main.js — the "Ask a Question" FAB is on every citizen page,
// not just this one.)

async function getFAQs() {
  const response = await fetch("/api/faqs/");
  if (!response.ok) throw new Error("Could not load the FAQ list.");
  return response.json();
}
