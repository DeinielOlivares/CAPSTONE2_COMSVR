// Home page (citizen): News and Announcements (full text in a popup, with an
// "unread" mark per citizen), Latest Ordinances, and Ordinances by Category.

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

const NEWS_EXCERPT_LENGTH = 180;

let _announcements = [];

async function loadAnnouncements(loggedIn) {
  const response = loggedIn
    ? await authFetch("/api/announcements/")
    : await fetch("/api/announcements/");
  if (!response.ok) throw new Error("Could not load announcements.");
  return response.json();
}

function formatNewsDate(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

const TAG_WINDOW_DAYS = 180; // 6 months

// "Updated" if it was edited within the last 6 months, otherwise "New" if it was
// uploaded within the last 6 months. Ordinances older than that get no tag.
function tagFor(o) {
  const daysSince = (iso) => (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
  const fresh = daysSince(o.created_at) < TAG_WINDOW_DAYS || daysSince(o.updated_at) < TAG_WINDOW_DAYS;
  return fresh ? '<span class="latest-ord-card__new">New</span>' : "";
}

function excerpt(text) {
  return text.length > NEWS_EXCERPT_LENGTH ? `${text.slice(0, NEWS_EXCERPT_LENGTH).trimEnd()}…` : text;
}

function isUnread(announcement, loggedIn) {
  return loggedIn && !announcement.is_read;
}

const HOME_PAGE_SIZE = 3;
// Rows shown before "See more" (the same for both side-by-side lists).
const LATEST_ORDINANCES_COUNT = 5;

// Fewer rows on phones (the page's 560px breakpoint).
function isMobileWidth() {
  return window.matchMedia("(max-width: 560px)").matches;
}

const SEE_MORE_CHEVRON =
  '<svg class="home-see-more__icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

// Fades each element in the first time it scrolls into view (.home-reveal in style.css).
const _revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            _revealObserver.unobserve(entry.target);
          });
        },
        { threshold: 0.15 }
      )
    : null;

function revealItems(elements) {
  Array.from(elements).forEach((el, i) => {
    el.classList.add("home-reveal");
    el.style.setProperty("--reveal-delay", `${i * 70}ms`);
    if (_revealObserver) _revealObserver.observe(el);
    else el.classList.add("is-visible");
  });
}

// Shows the first `perPage` cards and a "See more" button for the rest.
// `wire` (optional) adds the cards' click listeners after each render.
function renderPaginated(container, gridClass, cardsHtml, perPage, wire) {
  if (cardsHtml.length <= perPage) {
    container.innerHTML = `<div class="${gridClass}">${cardsHtml.join("")}</div>`;
    revealItems(container.querySelector(`.${gridClass}`).children);
    if (wire) wire(container.querySelector(`.${gridClass}`));
    return;
  }
  // Only newly shown cards animate in.
  function paint(showAll, initial) {
    const items = showAll ? cardsHtml : cardsHtml.slice(0, perPage);
    container.innerHTML =
      `<div class="${gridClass}">${items.join("")}</div>` +
      `<div class="home-see-more"><button type="button" class="btn btn-muted home-see-more__btn${showAll ? " is-open" : ""}">${showAll ? "See less" : "See more"}${SEE_MORE_CHEVRON}</button></div>`;
    const grid = container.querySelector(`.${gridClass}`);
    if (initial) revealItems(grid.children);
    else if (showAll) revealItems(Array.from(grid.children).slice(perPage));
    if (wire) wire(grid);
    container.querySelector(".home-see-more__btn").addEventListener("click", () => {
      paint(!showAll, false);
      if (showAll) container.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }
  paint(false, true);
}

function renderNewsGrid(container, announcements, loggedIn) {
  if (!announcements.length) {
    container.innerHTML = `<div class="ordinances-empty">No announcements yet.</div>`;
    return;
  }
  const cardsHtml = announcements.map((a) => {
    const unread = isUnread(a, loggedIn);
    return `
      <article class="news-card${unread ? " news-card--unread" : ""}" data-announcement-id="${a.id}">
        ${a.image_url ? `<div class="news-card__thumb"><img class="news-card__image" src="${escapeHtml(a.image_url)}" alt="" /></div>` : ""}
        <div class="news-card__body">
          ${unread ? `<span class="news-card__banner">New</span>` : ""}
          <h2 class="news-card__title">${escapeHtml(a.title)}</h2>
          <p class="news-card__excerpt">${escapeHtml(excerpt(a.description))}</p>
          <div class="news-card__footer">
            <span class="news-card__date">${formatNewsDate(a.created_at)}${a.is_edited ? ` &middot; <em>(edited)</em>` : ""}</span>
            <button type="button" class="news-card__more" data-read-more="${a.id}">Read more</button>
          </div>
        </div>
      </article>`;
  });

  renderPaginated(container, "news-grid", cardsHtml, isMobileWidth() ? 1 : HOME_PAGE_SIZE, () => {
    // Clicking anywhere on the card opens the announcement.
    container.querySelectorAll(".news-card").forEach((card) => {
      card.addEventListener("click", () => openAnnouncement(card.dataset.announcementId, container));
    });
  });
}

function openAnnouncement(id, grid) {
  const a = _announcements.find((item) => item.id === id);
  if (!a) return;
  const modal = document.getElementById("announcementModal");
  document.getElementById("announcementModalBody").innerHTML = `
    ${a.image_url ? `<img class="news-modal__image" src="${escapeHtml(a.image_url)}" alt="" />` : ""}
    <h2 class="news-modal__title">${escapeHtml(a.title)}</h2>
    <p class="news-modal__meta">${formatNewsDate(a.created_at)}${a.posted_by_name ? ` &middot; Posted by ${escapeHtml(a.posted_by_name)}` : ""}${a.is_edited ? ` &middot; <em>(edited)</em>` : ""}</p>
    <p class="news-modal__description">${escapeHtml(a.description)}</p>`;
  modal.hidden = false;

  // Opening an announcement marks it as read (on screen and on the server).
  if (isUnread(a, isLoggedIn())) {
    a.is_read = true;
    const card = grid.querySelector(`[data-announcement-id="${id}"]`);
    if (card) {
      card.classList.remove("news-card--unread");
      const banner = card.querySelector(".news-card__banner");
      if (banner) banner.remove();
    }
    authFetch(`/api/announcements/${encodeURIComponent(id)}/view/`, { method: "POST" }).catch(() => {});
  }
}

async function renderLatestOrdinances(container, loggedIn) {
  const response = loggedIn ? await authFetch("/api/ordinances/") : await fetch("/api/ordinances/");
  if (!response.ok) throw new Error("Could not load ordinances.");
  const all = await response.json();

  // Everyone sees all ordinances here, read or not — newest first by date
  // approved, like the Ordinances page.
  const rows = all.slice().sort((a, b) => b.date_approved.localeCompare(a.date_approved));

  if (!rows.length) {
    container.innerHTML = `<div class="ordinances-empty">No ordinances have been posted yet.</div>`;
    return;
  }
  // A short list of the most recent; the full list is on the Ordinances page.
  const rowsHtml = rows.slice(0, isMobileWidth() ? 3 : LATEST_ORDINANCES_COUNT).map(
    (o) => `
        <a class="latest-ord-row" href="ordinance-detail.html?id=${encodeURIComponent(o.id)}">
          <span class="latest-ord-row__main">
            <span class="latest-ord-row__title">${escapeHtml(o.title)}</span>
            <span class="latest-ord-row__meta">${escapeHtml(o.number)} &middot; ${escapeHtml(o.category)} &middot; Approved ${formatNewsDate(`${o.date_approved}T00:00:00`)}</span>
          </span>
          ${tagFor(o)}
          <span class="latest-ord-row__chevron" aria-hidden="true">&rsaquo;</span>
        </a>`
  );
  container.innerHTML =
    `<div class="latest-ord-rows">${rowsHtml.join("")}</div>` +
    (rows.length > rowsHtml.length
      ? `<div class="home-see-more"><a class="btn btn-muted home-see-more__btn" href="ordinances.html">View all ${rows.length} ordinances<span class="home-see-more__arrow" aria-hidden="true">&rarr;</span></a></div>`
      : "");
  revealItems(container.querySelector(".latest-ord-rows").children);
}

document.addEventListener("DOMContentLoaded", async () => {
  const loggedIn = isLoggedIn();

  const newsGrid = document.getElementById("announcementList");
  try {
    _announcements = await loadAnnouncements(loggedIn);
    renderNewsGrid(newsGrid, _announcements, loggedIn);
  } catch (err) {
    newsGrid.innerHTML = `<div class="ordinances-empty">${escapeHtml(err.message)}</div>`;
  }

  const modal = document.getElementById("announcementModal");
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.hidden = true;
  });

  try {
    await renderLatestOrdinances(document.getElementById("latestOrdinancesBody"), loggedIn);
  } catch (err) {
    document.getElementById("latestOrdinancesBody").innerHTML = `<div class="ordinances-empty">${escapeHtml(err.message)}</div>`;
  }
});


// Clicking a bar in "Ordinances by Category" opens a popup listing that
// category's ordinances (with a link to the filtered Ordinances page).
function openCategoryOrdinances(category, items) {
  const modal = document.getElementById("categoryOrdinancesModal");
  const sorted = items.slice().sort((a, b) => b.date_approved.localeCompare(a.date_approved));
  document.getElementById("categoryOrdinancesModalBody").innerHTML = `
    <h2 class="news-modal__title">${escapeHtml(category)}</h2>
    <p class="news-modal__meta">${sorted.length} ${sorted.length === 1 ? "ordinance" : "ordinances"}</p>
    <ul class="category-ord-list">
      ${sorted
        .map(
          (o) => `
        <li><a href="ordinance-detail.html?id=${encodeURIComponent(o.id)}">${escapeHtml(o.title)}</a></li>`
        )
        .join("")}
    </ul>
    <a class="btn btn-muted" href="ordinances.html?category=${encodeURIComponent(category)}">View all in Ordinances</a>`;
  modal.hidden = false;
}

async function renderCategorySummary() {
  const container = document.getElementById("categorySummary");
  if (!container) return;
  try {
    const response = await fetch("/api/ordinances/");
    if (!response.ok) throw new Error("Could not load ordinances.");
    const all = await response.json();
    const groups = new Map();
    all.forEach((o) => {
      if (!groups.has(o.category)) groups.set(o.category, []);
      groups.get(o.category).push(o);
    });
    if (!groups.size) {
      container.innerHTML = `<div class="ordinances-empty">No ordinances have been posted yet.</div>`;
      return;
    }
    const total = all.length;
    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const barsHtml = sortedGroups.map(([category, items]) => {
      const pct = Math.round((items.length / total) * 100);
      return `
        <button type="button" class="category-bar" data-category="${escapeHtml(category)}">
          <span class="category-bar__label">${escapeHtml(category)}</span>
          <span class="category-bar__track"><span class="category-bar__fill" style="width:${pct}%"></span></span>
          <span class="category-bar__pct">${pct}% (${items.length})</span>
        </button>`;
    });
    renderPaginated(container, "category-bars", barsHtml, isMobileWidth() ? 2 : LATEST_ORDINANCES_COUNT, (scope) => {
      scope.querySelectorAll("[data-category]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const [, items] = sortedGroups.find(([c]) => c === btn.dataset.category);
          openCategoryOrdinances(btn.dataset.category, items);
        });
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="ordinances-empty">${escapeHtml(err.message)}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  renderCategorySummary();
  const categoryModal = document.getElementById("categoryOrdinancesModal");
  categoryModal.addEventListener("click", (e) => {
    if (e.target === categoryModal) categoryModal.hidden = true;
  });

  // Esc closes whichever of the two home popups is open.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    categoryModal.hidden = true;
    document.getElementById("announcementModal").hidden = true;
  });
});
