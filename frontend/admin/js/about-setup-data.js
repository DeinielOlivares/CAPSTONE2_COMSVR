// Barangay Platero OVRMS — About Us Setup data, backed by /api/site/ (Administrator only
// for everything here; the citizen About Us page reads the public
// GET /api/site/about/). See siteinfo/views.py.

async function readFirstSetupError(response, fallback) {
  const data = await response.json().catch(() => null);
  if (data) {
    if (typeof data.detail === "string") throw new Error(data.detail);
    const firstError = Object.values(data)[0];
    if (Array.isArray(firstError)) throw new Error(firstError[0]);
    if (typeof firstError === "string") throw new Error(firstError);
  }
  throw new Error(`${fallback} (server responded ${response.status})`);
}

async function setupRequest(path, { method = "GET", json, form, fallback } = {}) {
  const options = { method };
  if (json !== undefined) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(json);
  } else if (form) {
    options.body = form; // multipart — the browser sets the boundary header
  }
  const response = await authFetch(path, options);
  if (!response.ok) await readFirstSetupError(response, fallback || "Something went wrong.");
  return response.status === 204 ? null : response.json();
}

// ---- Barangay details ----

function getBarangayProfile() {
  return setupRequest("/api/site/profile/", { fallback: "Could not load the barangay's details." });
}

function saveBarangayProfile(fields) {
  return setupRequest("/api/site/profile/", { method: "PATCH", json: fields, fallback: "Could not save the details." });
}

// ---- Website branding ----

function getBranding() {
  return setupRequest("/api/site/branding/admin/", { fallback: "Could not load the website's branding." });
}

function saveBranding(fields) {
  return setupRequest("/api/site/branding/admin/", { method: "PATCH", ...toSetupBody(fields), fallback: "Could not save the branding." });
}

// ---- Council members / logos ----
// `fields` is a plain object; a File value (photo/image) switches the
// request to multipart so the upload can ride along.

function toSetupBody(fields) {
  const hasFile = Object.values(fields).some((v) => v instanceof File);
  if (!hasFile) return { json: fields };
  const form = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null) form.append(key, typeof value === "boolean" ? String(value) : value);
  });
  return { form };
}

function listCouncilMembers() {
  return setupRequest("/api/site/council/", { fallback: "Could not load the council members." });
}

function createCouncilMember(fields) {
  return setupRequest("/api/site/council/", { method: "POST", ...toSetupBody(fields), fallback: "Could not add this member." });
}

function updateCouncilMember(id, fields) {
  return setupRequest(`/api/site/council/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    ...toSetupBody(fields),
    fallback: "Could not update this member.",
  });
}

function deleteCouncilMember(id) {
  return setupRequest(`/api/site/council/${encodeURIComponent(id)}/`, { method: "DELETE", fallback: "Could not remove this member." });
}

function reorderCouncilMembers(ids) {
  return setupRequest("/api/site/council/reorder/", { method: "POST", json: { ids }, fallback: "Could not save the new order." });
}

function listAboutLogos() {
  return setupRequest("/api/site/logos/", { fallback: "Could not load the logos." });
}

function createAboutLogo(fields) {
  return setupRequest("/api/site/logos/", { method: "POST", ...toSetupBody(fields), fallback: "Could not add this logo." });
}

function updateAboutLogo(id, fields) {
  return setupRequest(`/api/site/logos/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    ...toSetupBody(fields),
    fallback: "Could not update this logo.",
  });
}

function deleteAboutLogo(id) {
  return setupRequest(`/api/site/logos/${encodeURIComponent(id)}/`, { method: "DELETE", fallback: "Could not remove this logo." });
}

function reorderAboutLogos(ids) {
  return setupRequest("/api/site/logos/reorder/", { method: "POST", json: { ids }, fallback: "Could not save the new order." });
}
