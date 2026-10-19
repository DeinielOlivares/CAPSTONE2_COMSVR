// Barangay Platero OVRMS — site footer (About Us, Privacy Policy, Terms and Agreements),
// plus the shared loader for the barangay's details.
//
// The details (address, phone, email, About Us text, council, logos) are
// Admin-editable from the Admin Portal's About Us Setup page and served by
// GET /api/site/about/ — loadSiteAbout() fetches them once per page and
// fills the footer's contact column and every [data-barangay="<field>"]
// element (About Us' cards, the legal pages' contact lines). Add
// data-barangay-link to make a phone/email/address a tap-to-call/email/map link.
//
// Load this BEFORE main.js: the footer's File Report / Submit Suggestion
// links carry data-auth-gate, which main.js wires up on load.

let _siteAboutPromise = null;

function loadSiteAbout() {
  if (!_siteAboutPromise) {
    _siteAboutPromise = fetch("/api/site/about/").then((response) => {
      if (!response.ok) throw new Error("Could not load the barangay's details. Try refreshing the page.");
      return response.json();
    });
  }
  return _siteAboutPromise;
}

function escapeSiteHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function barangayLinks(profile) {
  const digits = (profile.phone || "").replace(/\D/g, "");
  return {
    phone: digits ? `tel:${digits.startsWith("0") ? `+63${digits.slice(1)}` : digits}` : "",
    email: profile.email ? `mailto:${profile.email}` : "",
    address: profile.address ? `https://maps.google.com/?q=${encodeURIComponent(profile.address)}` : "",
  };
}

function fillBarangayFields(profile) {
  const links = barangayLinks(profile);
  document.querySelectorAll("[data-barangay]").forEach((el) => {
    const key = el.dataset.barangay;
    const value = profile[key];
    // An empty field hides its whole line (e.g. office hours not set yet).
    const line = el.closest("[data-barangay-line]");
    if (line) line.hidden = !value;
    if (!value) {
      el.textContent = "";
      return;
    }
    if (links[key] && el.hasAttribute("data-barangay-link")) {
      const a = document.createElement("a");
      a.href = links[key];
      a.textContent = value;
      if (key === "address") {
        a.target = "_blank";
        a.rel = "noopener";
      }
      el.replaceChildren(a);
    } else {
      el.textContent = value;
    }
  });
}

const DEFAULT_FOOTER_QUICK_LINKS = [
  { label: "Ordinances", url: "ordinances.html" },
  { label: "File a Report", url: "file-report.html" },
  { label: "Submit a Suggestion", url: "submit-suggestion.html" },
  { label: "FAQs", url: "faqs.html" },
  { label: "About Us", url: "about.html" },
];

const DEFAULT_FOOTER_LEGAL_LINKS = [
  { label: "Privacy Policy", url: "privacy-policy.html" },
  { label: "Terms and Agreements", url: "terms.html" },
  { label: "Your Data Privacy Rights", url: "privacy-policy.html#your-rights" },
];

const FOOTER_AUTH_GATES = { "file-report.html": "report", "submit-suggestion.html": "suggestion" };

function footerLinksHtml(links) {
  return links
    .map((link) => {
      const gate = FOOTER_AUTH_GATES[link.url];
      return `<li><a href="${escapeSiteHtml(link.url)}"${gate ? ` data-auth-gate="${gate}"` : ""}>${escapeSiteHtml(link.label)}</a></li>`;
    })
    .join("");
}

// Saved lists from Admin's About Us Setup; an empty saved list means "use the defaults".
function renderFooterLists(profile) {
  const lists = [
    ["quick", profile.footer_quick_links, DEFAULT_FOOTER_QUICK_LINKS],
    ["legal", profile.footer_legal_links, DEFAULT_FOOTER_LEGAL_LINKS],
  ];
  lists.forEach(([key, saved, fallback]) => {
    const ul = document.querySelector(`[data-footer-list="${key}"]`);
    if (ul) ul.innerHTML = footerLinksHtml(saved && saved.length ? saved : fallback);
  });
}

(function renderSiteFooter() {
  const footer = document.getElementById("siteFooter");
  if (footer) {
    footer.className = "site-footer";
    footer.innerHTML = `
      <div class="site-footer__inner">
        <div class="site-footer__brand">
          <img src="drawables/logo-barangay-platero.png" alt="Barangay Platero seal" width="64" height="64" />
          <div>
            <p class="site-footer__name" data-barangay="name">Barangay Platero</p>
            <p class="site-footer__sub" data-barangay="city"></p>
            <p class="site-footer__tagline" data-barangay="footer_tagline">Ordinance Violation Reporting and Monitoring System</p>
          </div>
        </div>

        <nav class="site-footer__col" aria-label="Quick links">
          <h2 class="site-footer__heading">Quick Links</h2>
          <ul data-footer-list="quick">${footerLinksHtml(DEFAULT_FOOTER_QUICK_LINKS)}</ul>
        </nav>

        <nav class="site-footer__col" aria-label="Legal">
          <h2 class="site-footer__heading">Legal</h2>
          <ul data-footer-list="legal">${footerLinksHtml(DEFAULT_FOOTER_LEGAL_LINKS)}</ul>
        </nav>

        <div class="site-footer__col">
          <h2 class="site-footer__heading">Contact Us</h2>
          <ul class="site-footer__contact">
            <li data-barangay-line hidden><span data-barangay="address" data-barangay-link></span></li>
            <li data-barangay-line hidden><span data-barangay="phone" data-barangay-link></span></li>
            <li data-barangay-line hidden><span data-barangay="email" data-barangay-link></span></li>
            <li data-barangay-line hidden><span data-barangay="office_hours"></span></li>
          </ul>
          <p class="site-footer__emergency">Emergency? Call <a id="footerEmergencyLink" href="tel:911">911</a>. Barangay Platero OVRMS is not an emergency service.</p>
        </div>
      </div>

      <div class="site-footer__bottom">
        <p>&copy; ${new Date().getFullYear()} <span data-barangay="name">Barangay Platero</span>, <span data-barangay="city">City of Biñan, Laguna</span>. All rights reserved.</p>
        <p data-barangay="footer_notice">Personal data is processed under the Data Privacy Act of 2012 (Republic Act No. 10173).</p>
      </div>`;
  }

  loadSiteAbout()
    .then(({ profile }) => {
      fillBarangayFields(profile);
      renderFooterLists(profile);
      const emergency = document.getElementById("footerEmergencyLink");
      if (emergency && profile.emergency_hotline) {
        emergency.textContent = profile.emergency_hotline;
        emergency.href = `tel:${profile.emergency_hotline.replace(/[^\d+]/g, "")}`;
      }
    })
    .catch(() => {
      // Footer links still work; only the contact details are missing.
    });
})();
