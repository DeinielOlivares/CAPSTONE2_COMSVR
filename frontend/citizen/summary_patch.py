import os

ROOT = "C:/Users/renz/Desktop/test-site/frontend/citizen"

# 1. Home: a "by category" summary section between announcements and latest
p = os.path.join(ROOT, "home.html")
h = open(p, encoding="utf-8").read()
anchor = '''      <section class="home-section">
        <h1 class="page-heading">News and Announcements</h1>'''
assert h.count(anchor) == 1
end = h.index("      </section>\n", h.index(anchor)) + len("      </section>\n")
h = h[:end] + '''
      <section class="home-section">
        <h1 class="page-heading">Ordinances by Category</h1>
        <div id="categorySummary" class="category-summary">
          <div class="ordinances-empty">Loading...</div>
        </div>
      </section>
''' + h[end:]
open(p, "w", encoding="utf-8").write(h)

# 2. Home script: group ordinances by category
p = os.path.join(ROOT, "js/home.js")
s = open(p, encoding="utf-8").read()
s += '''

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
    container.innerHTML = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([category, items]) => {
        const count = items.length;
        return `
        <a class="category-card" href="ordinances.html?category=${encodeURIComponent(category)}">
          <span class="category-card__count">${count}</span>
          <span class="category-card__label">${count === 1 ? "ordinance" : "ordinances"} about ${escapeHtml(category)}</span>
        </a>`;
      })
      .join("");
  } catch (err) {
    container.innerHTML = `<div class="ordinances-empty">${escapeHtml(err.message)}</div>`;
  }
}

document.addEventListener("DOMContentLoaded", renderCategorySummary);
'''
open(p, "w", encoding="utf-8").write(s)

# 3. Ordinances page: honour ?category= and show a clear banner
p = os.path.join(ROOT, "js/ordinances-list.js")
s = open(p, encoding="utf-8").read()
old = '''  function getFiltered() {
    const rows = liveOrdinances();'''
assert s.count(old) == 1
s = s.replace(old, '''  const categoryFilter = new URLSearchParams(window.location.search).get("category");
  if (categoryFilter) {
    const banner = document.createElement("div");
    banner.className = "category-banner";
    banner.innerHTML = `Showing ordinances about <strong>${escapeHtml(categoryFilter)}</strong>. <a href="ordinances.html">Show all</a>`;
    document.querySelector(".ordinances-toolbar").before(banner);
  }

  function getFiltered() {
    const rows = liveOrdinances().filter((o) => !categoryFilter || o.category === categoryFilter);''')
open(p, "w", encoding="utf-8").write(s)

# 4. CSS
p = os.path.join(ROOT, "css/style.css")
c = open(p, encoding="utf-8").read()
c += """
.category-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.category-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 200px;
  background: var(--white);
  border: 1px solid var(--border);
  border-left: 5px solid var(--accent, #2f7d4a);
  border-radius: 12px;
  padding: 18px 22px;
  box-shadow: 0 8px 22px rgba(20, 60, 30, 0.1);
  text-decoration: none;
  color: var(--text);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.category-card:hover,
.category-card:focus-visible {
  transform: translateY(-3px);
  box-shadow: 0 14px 28px rgba(20, 60, 30, 0.16);
  text-decoration: none;
}

.category-card__count {
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1;
}

.category-card__label {
  font-size: 0.9rem;
  color: var(--text-muted);
}

.category-banner {
  margin-bottom: 14px;
  padding: 10px 14px;
  border-radius: 8px;
  background: #e8f4ea;
  font-size: 0.9rem;
}
"""
open(p, "w", encoding="utf-8").write(c)
os.remove(__file__)
print("patched")
