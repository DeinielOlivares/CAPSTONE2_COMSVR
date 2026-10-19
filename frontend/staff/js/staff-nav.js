// staff-nav.js — which staff position may open which page, and the two
// helpers every staff page calls *while it is still loading* (so the wrong
// sidebar links or empty name never flash on screen):
//   hideStaffNavLinks()  right after the sidebar <ul>
//   fillStaffTopbar()    right after the top bar
// Loaded in the <head> of every logged-in staff page, after common.js.

// page -> positions allowed to see it. Each role's own dashboard is listed
// first: layout.js sends a user who opens a page they can't see to the first
// page they're allowed.
const STAFF_NAV_ACCESS = {
  "investigator-dashboard.html": ["Investigator"],
  "reports-dashboard.html": ["Barangay Captain"],
  "geo-analysis.html": ["Barangay Captain"],
  "reports.html": ["Investigator", "Barangay Captain"],
  // The Reports sub-pages; "Unclaimed Reports" falls under "reports.html".
  "reports.html?view=mine": ["Investigator"],
  "reports.html?view=others": ["Investigator"],
  "reports.html?view=claimed": ["Barangay Captain"],
  "concerns-dashboard.html": ["Barangay Captain"],
  "secretary-dashboard.html": ["Secretary"],
  "concerns.html": ["Secretary", "Barangay Captain"],
  "ordinances.html": ["Barangay Captain", "Secretary", "Investigator"],
  "questions.html": ["Barangay Captain", "Secretary", "Investigator"],
  "announcements.html": ["Barangay Captain", "Secretary"],
};

function hasNavEntry(page) {
  return Object.prototype.hasOwnProperty.call(STAFF_NAV_ACCESS, page);
}

// The pages the logged-in staff member may open.
function allowedStaffPages(user) {
  return Object.keys(STAFF_NAV_ACCESS).filter((page) => STAFF_NAV_ACCESS[page].includes(user.position));
}

// Hides sidebar links (and empty sidebar groups) this user's position can't use.
function hideStaffNavLinks() {
  const user = getCurrentUser();
  if (!user) return;
  const allowed = allowedStaffPages(user);
  document.querySelectorAll(".admin-sidebar__nav a[href]").forEach((link) => {
    // A sub-page link (reports.html?view=mine) may have its own entry;
    // otherwise its page's entry (reports.html) is used.
    let page = link.getAttribute("href");
    if (!hasNavEntry(page)) page = page.split("?")[0];
    if (hasNavEntry(page) && !allowed.includes(page)) {
      const item = link.closest("li");
      if (item) item.hidden = true;
    }
  });
  document.querySelectorAll(".admin-sidebar__group").forEach((group) => {
    if (!group.querySelector(".admin-sidebar__subnav li:not([hidden])")) group.hidden = true;
  });
}

// Puts the user's name and position in the top bar.
function fillStaffTopbar() {
  const user = getCurrentUser();
  if (!user) return;
  document.querySelectorAll(".admin-topbar__name strong").forEach((el) => {
    el.textContent = user.name;
  });
  document.querySelectorAll(".admin-topbar__name small").forEach((el) => {
    el.textContent = user.position || "Barangay Official";
  });
}
