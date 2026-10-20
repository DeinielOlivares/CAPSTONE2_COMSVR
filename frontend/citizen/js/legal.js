// Barangay Platero OVRMS — Legal pages (Privacy Policy, Terms and Agreements): render the
// Administrator-edited sections from GET /api/site/legal/<key>/ into the
// #legalSections container. The text format is described on siteinfo's
// LegalDocument model: blank lines separate blocks; "- " bullets, "1. " numbered
// items, "| a | b |" table rows (first row is the header), **bold**,
// [text](url), and {{address}} / {{email}} / {{phone}} / {{name}} filled from
// the barangay's details.

function legalEscape(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function legalInline(text, profile) {
  let out = legalEscape(text);
  out = out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const isExternal = /^https?:\/\//i.test(url);
    const target = isExternal ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${url}"${target}>${label}</a>`;
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_, field) => legalEscape((profile && profile[field]) || ""));
  return out;
}

function renderLegalBody(body, profile) {
  const blocks = body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.every((l) => l.startsWith("|"))) {
        const rows = lines
          .filter((l) => !/^\|[\s:|-]+\|$/.test(l))
          .map((l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
        const [header, ...dataRows] = rows;
        return `<div class="legal-table-wrap"><table class="legal-table"><thead><tr>${header
          .map((c) => `<th>${legalInline(c, profile)}</th>`)
          .join("")}</tr></thead><tbody>${dataRows
          .map((r) => `<tr>${r.map((c) => `<td>${legalInline(c, profile)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`;
      }
      if (lines.every((l) => l.startsWith("- "))) {
        return `<ul>${lines.map((l) => `<li>${legalInline(l.slice(2), profile)}</li>`).join("")}</ul>`;
      }
      if (lines.every((l) => /^\d+\. /.test(l))) {
        return `<ol>${lines.map((l) => `<li>${legalInline(l.replace(/^\d+\. /, ""), profile)}</li>`).join("")}</ol>`;
      }
      return `<p>${legalInline(lines.join(" "), profile)}</p>`;
    })
    .join("");
}

async function renderLegalPage(key) {
  const container = document.getElementById("legalSections");
  if (!container) return;
  try {
    const [legalResponse, about] = await Promise.all([
      fetch(`/api/site/legal/${encodeURIComponent(key)}/`),
      loadSiteAbout().catch(() => ({ profile: {} })),
    ]);
    if (!legalResponse.ok) throw new Error("Could not load this page.");
    const { sections, effective_date: effectiveDate } = await legalResponse.json();
    const effectiveEl = document.getElementById("legalEffectiveDate");
    if (effectiveEl && effectiveDate) {
      effectiveEl.textContent = `Effective date: ${effectiveDate}`;
      effectiveEl.hidden = false;
    }
    const profile = about.profile || {};
    container.innerHTML = sections
      .map((section) => {
        const heading = section.heading
          ? `<h2${section.anchor ? ` id="${legalEscape(section.anchor)}"` : ""}>${legalEscape(section.heading)}</h2>`
          : "";
        return heading + renderLegalBody(section.body, profile);
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<p>${legalEscape(err.message)}</p>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("legalSections");
  if (container) renderLegalPage(container.dataset.legalKey);
});
