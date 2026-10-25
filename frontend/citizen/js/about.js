// Barangay Platero OVRMS — About Us: renders the logo strip and the Sangguniang Barangay
// from GET /api/site/about/ (shared loader in site-footer.js, which also
// fills the contact card and description cards). All of it is maintained by
// an Administrator from the Admin Portal's About Us Setup page, so a new
// administration after an election is a data change, not a code change.

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
  const byGroup = (group) => council.filter((m) => m.group === group);
  rows.innerHTML = renderCouncilLead(byGroup("chairman"), byGroup("officer")) +
    chunkIntoBalancedRows(byGroup("member"), COUNCIL_MAX_PER_ROW)
      .map((row) => `<div class="council__row">${row.map(renderCouncilMember).join("")}</div>`)
      .join("");
}

// Top row, like the wall in the barangay hall: the Punong Barangay in the
// middle with the appointed officers flanking him, alternating sides in
// their API order (1st left, 2nd right, 3rd further left, ...). The left
// side is laid out row-reverse in CSS, so its first item sits next to the
// captain and any extra officers grow outward without moving him off-center.
function renderCouncilLead(chairmen, officers) {
  if (!chairmen.length && !officers.length) return "";
  const left = officers.filter((_, i) => i % 2 === 0);
  const right = officers.filter((_, i) => i % 2 === 1);
  return `
    <div class="council__lead">
      <div class="council__lead-side council__lead-side--left">${left.map(renderCouncilMember).join("")}</div>
      <div class="council__lead-center">${chairmen.map(renderCouncilMember).join("")}</div>
      <div class="council__lead-side council__lead-side--right">${right.map(renderCouncilMember).join("")}</div>
    </div>`;
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
