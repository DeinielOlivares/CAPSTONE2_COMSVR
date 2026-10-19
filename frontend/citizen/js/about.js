// Barangay Platero OVRMS — About Us: renders the logo strip and the Sangguniang Barangay
// from GET /api/site/about/ (shared loader in site-footer.js, which also
// fills the contact card and description cards). All of it is maintained by
// an Administrator from the Admin Portal's About Us Setup page, so a new
// administration after an election is a data change, not a code change.

// Row order on the page; members within a row come sorted by the API.
const COUNCIL_ROWS = [
  { group: "chairman", className: "council__row council__row--lead" },
  { group: "member", className: "council__row" },
  { group: "officer", className: "council__row" },
];

function renderAboutLogos(logos) {
  const strip = document.getElementById("aboutLogos");
  if (!strip) return;
  strip.innerHTML = logos
    .map(
      (logo) =>
        `<img src="${escapeSiteHtml(logo.imageUrl)}" alt="${escapeSiteHtml(logo.alt_text)}" width="180" height="180" />`
    )
    .join("");
  strip.hidden = !logos.length;
}

const COUNCIL_MAX_PER_ROW = 5;

// Splits a group's members into as few rows as possible with no more than
// COUNCIL_MAX_PER_ROW each, and as even as possible — e.g. 8 -> 4+4,
// 10 -> 5+5, 7 -> 4+3 — instead of letting flex-wrap fill rows unevenly.
function chunkIntoBalancedRows(members, maxPerRow) {
  if (!members.length) return [];
  const rowCount = Math.ceil(members.length / maxPerRow);
  const perRow = Math.ceil(members.length / rowCount);
  const chunks = [];
  for (let i = 0; i < members.length; i += perRow) {
    chunks.push(members.slice(i, i + perRow));
  }
  return chunks;
}

function renderCouncilMember(m) {
  return `
    <figure class="council-member">
      ${
        m.photoUrl
          ? `<img src="${escapeSiteHtml(m.photoUrl)}" alt="" width="150" height="150" loading="lazy"${
              m.hasCustomPhoto ? ' class="council-member__photo--framed"' : ""
            } />`
          : `<span class="council-member__placeholder" aria-hidden="true"></span>`
      }
      <figcaption>
        <span class="council-member__name">${escapeSiteHtml(m.name)}</span>
        <span class="council-member__role">${escapeSiteHtml(m.position)}</span>
      </figcaption>
    </figure>`;
}

function renderCouncil(council) {
  const rows = document.getElementById("councilRows");
  if (!rows) return;
  if (!council.length) {
    rows.innerHTML = `<p class="council__loading">The barangay officials will be listed here soon.</p>`;
    return;
  }
  rows.innerHTML = COUNCIL_ROWS.map(({ group, className }) => {
    const members = council.filter((m) => m.group === group);
    if (!members.length) return "";
    return chunkIntoBalancedRows(members, COUNCIL_MAX_PER_ROW)
      .map((row) => `<div class="${className}">${row.map(renderCouncilMember).join("")}</div>`)
      .join("");
  }).join("");
}

loadSiteAbout()
  .then(({ logos, council }) => {
    renderAboutLogos(logos);
    renderCouncil(council);
  })
  .catch((err) => {
    const error = document.getElementById("aboutError");
    if (error) {
      error.textContent = err.message;
      error.hidden = false;
    }
    const rows = document.getElementById("councilRows");
    if (rows) rows.innerHTML = "";
  });
