// faqs-data.js — loads the public FAQ list (GET /api/faqs/).

async function getFAQs() {
  const response = await fetch("/api/faqs/");
  if (!response.ok) throw new Error("Could not load the FAQ list.");
  return response.json();
}
