// main.js — the citizen portal's page frame. Loaded on every citizen page
// (after /shared/js/common.js). It handles:
//   - the top navbar (brand, mobile menu, Login/Sign Up or the account menu)
//   - logging out
//   - the notification bell (status changes on the citizen's reports/concerns)
//   - the floating "Ask a Question" button
//   - file upload boxes (drag & drop, list of chosen files)
//   - Street pickers (Sign Up, My Profile, account setup)
// Login, Sign Up and Forgot Password forms are in /shared/js/auth-pages.js.

// ---- Notifications --------------------------------------------------------
// The bell shows a notification when one of the citizen's reports or
// concerns changes status/remarks. The last seen status of each item is kept
// in localStorage so changes can be detected on the next check.

const notificationStore = createNotificationStore("orms_citizen_notifications", 20);

const REPORT_NOTIF_LABELS = {
  submitted: "Submitted",
  under_review: "Under Review",
  in_action: "In Action",
  resolved: "Resolved",
  with_remarks: "With Remarks",
};
const CONCERN_NOTIF_LABELS = { submitted: "Submitted", reviewed: "Reviewed" };
const REPORT_SNAPSHOT_KEY = "orms_citizen_report_snapshot";
const CONCERN_SNAPSHOT_KEY = "orms_citizen_concern_snapshot";

function getNotifSnapshot(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};
  }
}

// Compares each item's "status|remarks" with the last saved one and adds a
// notification for every change. An item seen for the first time is only
// reported if it is no longer a fresh, untouched submission.
async function checkForUpdates(url, snapshotKey, makeNotification) {
  let list;
  try {
    const res = await authFetch(url);
    if (!res.ok) return;
    list = await res.json();
  } catch {
    return;
  }

  const snapshot = getNotifSnapshot(snapshotKey);
  list.forEach((item) => {
    const hash = `${item.status}|${item.remarks}`;
    const isFirstSight = !(item.id in snapshot);
    const isFreshSubmission = item.status === "submitted" && !item.remarks;
    const changed = isFirstSight ? !isFreshSubmission : snapshot[item.id] !== hash;
    if (changed) {
      const [message, link] = makeNotification(item);
      notificationStore.add(message, link);
    }
    snapshot[item.id] = hash;
  });
  localStorage.setItem(snapshotKey, JSON.stringify(snapshot));
}

function checkForReportUpdates() {
  return checkForUpdates("/api/reports/", REPORT_SNAPSHOT_KEY, (r) => [
    `Your report "${r.ordinance}" is now ${REPORT_NOTIF_LABELS[r.status] || r.status}.`,
    `my-report-detail.html?id=${r.id}`,
  ]);
}

function checkForConcernUpdates() {
  return checkForUpdates("/api/concerns/", CONCERN_SNAPSHOT_KEY, (c) => [
    `Your concern/suggestion is now ${CONCERN_NOTIF_LABELS[c.status] || c.status}.`,
    `my-concern-detail.html?id=${c.id}`,
  ]);
}

// ---- Small helpers used by other citizen pages ------------------------------

// The floating "Ask a Question" button (and the FAQs page) submit through this.
async function askQuestion(question) {
  const response = await authFetch("/api/questions/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const firstError = Object.values(data)[0];
    throw new Error(Array.isArray(firstError) ? firstError[0] : "Could not submit your question.");
  }
  return response.json();
}

// A staff/admin session must not be used on the citizen site: log it out so
// the page shows the normal guest view.
function enforcePortalAccess() {
  const user = getCurrentUser();
  if (user && user.role !== "citizen") logOut();
}

// Publishes the navbar's height as the CSS variable --navbar-height (sticky
// side panels use it to stop just below the navbar).
function trackNavbarHeight() {
  const navbar = document.querySelector(".navbar");
  if (!navbar) return;
  const update = () => document.documentElement.style.setProperty("--navbar-height", `${navbar.offsetHeight}px`);
  update();
  if (window.ResizeObserver) new ResizeObserver(update).observe(navbar);
  else window.addEventListener("resize", update);
}

function goToAbout() {
  window.location.href = "/citizen/about.html";
}

// ---- File upload boxes ------------------------------------------------------
// <label class="upload-drop" for="..."> boxes: show the chosen file name(s)
// and accept drag & drop. For multi-file inputs (report/suggestion evidence)
// every chosen file is listed with a thumbnail, View link and Remove button.

const MAX_EVIDENCE_FILES = 5;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function wireUploadBox(label) {
  const input = label.control;
  if (!input || input.type !== "file") return;
  const textEl = label.querySelector(".upload-drop__text");
  if (!textEl) return;
  const defaultText = textEl.textContent;

  const isMulti = input.multiple;
  let picked = []; // the chosen files; input.files is rebuilt from this
  let tray = null;
  const objectUrls = new Set();

  function releaseObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  }

  function syncInputFiles() {
    const dt = new DataTransfer();
    picked.forEach((file) => dt.items.add(file));
    input.files = dt.files;
  }

  function updateLabelText() {
    const count = input.files.length;
    textEl.textContent = !count ? defaultText : count === 1 ? input.files[0].name : `${count} files selected`;
  }

  function renderTray() {
    if (!isMulti) return;
    if (!tray) {
      tray = document.createElement("ul");
      tray.className = "evidence-list";
      input.insertAdjacentElement("afterend", tray);
    }
    releaseObjectUrls();
    tray.textContent = "";
    tray.hidden = picked.length === 0;

    if (picked.length) {
      const caption = document.createElement("li");
      caption.className = "evidence-list__caption";
      caption.textContent = `${picked.length} of ${MAX_EVIDENCE_FILES} files added`;
      tray.appendChild(caption);
    }

    picked.forEach((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrls.add(url);

      const item = document.createElement("li");
      item.className = "evidence-list__item";

      const thumb = document.createElement("span");
      thumb.className = "evidence-list__thumb";
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        thumb.appendChild(img);
      } else {
        thumb.textContent = "\u{1F3AC}";
      }

      const meta = document.createElement("span");
      meta.className = "evidence-list__meta";
      const name = document.createElement("span");
      name.className = "evidence-list__name";
      name.textContent = file.name;
      const size = document.createElement("span");
      size.className = "evidence-list__size";
      size.textContent = formatBytes(file.size);
      meta.append(name, size);

      const view = document.createElement("a");
      view.className = "evidence-list__view";
      view.href = url;
      view.target = "_blank";
      view.rel = "noopener";
      view.textContent = "View";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "evidence-list__remove";
      remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        picked.splice(index, 1);
        syncInputFiles();
        updateLabelText();
        renderTray();
      });

      item.append(thumb, meta, view, remove);
      tray.appendChild(item);
    });
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    for (const file of incoming) {
      const dupe = picked.some((f) => f.name === file.name && f.size === file.size && f.lastModified === file.lastModified);
      if (!dupe && picked.length < MAX_EVIDENCE_FILES) picked.push(file);
    }
    syncInputFiles();
    updateLabelText();
    renderTray();
  }

  input.addEventListener("change", () => {
    if (!isMulti) {
      updateLabelText();
      return;
    }
    // Picking again replaces input.files, so add the new files to the earlier ones.
    addFiles(input.files);
  });

  if (input.form) {
    input.form.addEventListener("reset", () => {
      picked = [];
      releaseObjectUrls();
      if (tray) {
        tray.textContent = "";
        tray.hidden = true;
      }
      textEl.textContent = defaultText;
    });
  }

  ["dragenter", "dragover"].forEach((evt) => {
    label.addEventListener(evt, (e) => {
      e.preventDefault();
      label.classList.add("upload-drop--dragover");
    });
  });
  ["dragleave", "dragend", "drop"].forEach((evt) => {
    label.addEventListener(evt, (e) => {
      e.preventDefault();
      label.classList.remove("upload-drop--dragover");
    });
  });
  label.addEventListener("drop", (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    if (isMulti) {
      addFiles(e.dataTransfer.files);
    } else {
      input.files = e.dataTransfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
}

// ---- Navbar -------------------------------------------------------------------

// Adds the ☰ button that opens the links on small screens. Above 860px, if
// the links no longer fit on one row, the navbar switches to the same
// collapsed style (.navbar--compact) instead of wrapping to a second row.
function wireMobileMenu(navLinks, navBrand) {
  const navHamburger = document.createElement("button");
  navHamburger.type = "button";
  navHamburger.className = "navbar__hamburger";
  navHamburger.setAttribute("aria-label", "Toggle menu");
  navHamburger.setAttribute("aria-expanded", "false");
  navHamburger.innerHTML = "&#9776;";
  navBrand.insertAdjacentElement("afterend", navHamburger);

  const navbarEl = navLinks.closest(".navbar");

  const closeNavMenu = () => {
    navLinks.classList.remove("is-open");
    navHamburger.setAttribute("aria-expanded", "false");
  };

  navHamburger.addEventListener("click", () => {
    const isOpen = navLinks.classList.toggle("is-open");
    navHamburger.setAttribute("aria-expanded", String(isOpen));
  });

  navLinks.addEventListener("click", (e) => {
    if (e.target.closest("a")) closeNavMenu();
  });

  function syncNavCompact() {
    if (!navbarEl || window.innerWidth <= 860) return; // the CSS media query handles small screens
    navbarEl.classList.remove("navbar--compact");
    // Only visible links count (guests have hidden [data-auth-only] links).
    const anchors = Array.from(navLinks.querySelectorAll("a")).filter((a) => a.offsetParent !== null);
    const wrapped = anchors.length > 1 && anchors[0].offsetTop !== anchors[anchors.length - 1].offsetTop;
    navbarEl.classList.toggle("navbar--compact", wrapped);
  }
  syncNavCompact();
  window.addEventListener("load", syncNavCompact); // fonts/images can change link widths after first paint

  window.addEventListener("resize", () => {
    if (window.innerWidth > 860) closeNavMenu();
    syncNavCompact();
  });
}

// Adds an <li><a> to the mobile menu.
function addMenuLink(navLinks, className, href, text, active) {
  const item = document.createElement("li");
  item.className = className;
  const link = document.createElement("a");
  link.href = href;
  link.textContent = text;
  if (active) link.classList.add("active");
  item.appendChild(link);
  navLinks.appendChild(item);
}

// Logged in: the profile icon shows the user's avatar, and the mobile menu
// gets the brand at the top and a Logout link at the bottom.
// Guest: the profile icon becomes "Login" with a "Sign Up" link next to it
// (both also added to the mobile menu).
function wireAccountArea(profileBtn, navLinks, user) {
  if (user) {
    renderAvatar(profileBtn, user);
    const navbarEl = profileBtn.closest(".navbar");
    if (!navbarEl) return;
    navbarEl.classList.add("navbar--authed");
    const brand = navbarEl.querySelector(".navbar__brand");
    if (navLinks && brand) {
      const brandItem = document.createElement("li");
      brandItem.className = "navbar__links-brand";
      brandItem.style.cursor = "pointer";
      brandItem.innerHTML = brand.innerHTML;
      brandItem.addEventListener("click", goToAbout);
      navLinks.insertBefore(brandItem, navLinks.firstChild);
    }
    if (navLinks) {
      const logoutItem = document.createElement("li");
      logoutItem.className = "navbar__links-logout";
      const logoutLink = document.createElement("a");
      logoutLink.href = "#";
      logoutLink.innerHTML = "&#8618; Logout";
      logoutLink.addEventListener("click", (evt) => {
        evt.preventDefault();
        const confirmModal = document.getElementById("logoutConfirmModal");
        if (confirmModal) confirmModal.hidden = false;
      });
      logoutItem.appendChild(logoutLink);
      navLinks.appendChild(logoutItem);
    }
    return;
  }

  const loginActive = window.location.pathname.startsWith("/citizen/login");
  const signUpActive = window.location.pathname.endsWith("/signup.html");

  profileBtn.textContent = "Login";
  profileBtn.classList.add("navbar__profile--login");
  if (loginActive) profileBtn.classList.add("active");

  const signUpLink = document.createElement("a");
  signUpLink.href = "/citizen/signup.html";
  signUpLink.textContent = "Sign Up";
  signUpLink.className = "navbar__profile--login";
  if (signUpActive) signUpLink.classList.add("active");
  profileBtn.insertAdjacentElement("afterend", signUpLink);

  if (navLinks) {
    addMenuLink(navLinks, "navbar__links-login", "/citizen/login.html", "Login", loginActive);
    addMenuLink(navLinks, "navbar__links-signup", "/citizen/signup.html", "Sign Up", signUpActive);
  }
}

// ---- Page setup ---------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setFavicon("/shared/images/logo.png");
  applySiteBranding();
  trackNavbarHeight();
  document.querySelectorAll(".navbar__brand").forEach((brand) => {
    brand.style.cursor = "pointer";
    brand.addEventListener("click", goToAbout);
  });
  expireStaleSession();
  enforcePortalAccess();
  setupPasswordHints();
  setupPasswordVisibilityToggles();

  // Street pickers (only on pages that load /shared/js/streets.js).
  if (typeof ensureStreetsLoaded === "function") {
    ensureStreetsLoaded()
      .then(() => {
        wireStreetCombobox("signupStreet", "signupStreetList");
        wireStreetCombobox("profileStreet", "profileStreetList");
        wireStreetCombobox("setupStreet", "setupStreetList");
      })
      .catch(() => {}); // the pickers just show no streets
  }

  wireConfirmPasswordCheck();
  wireCodeInputs();
  document.querySelectorAll("label.upload-drop").forEach(wireUploadBox);

  const navLinks = document.querySelector(".navbar__links");
  const navBrand = document.querySelector(".navbar__brand");
  if (navLinks && navBrand) wireMobileMenu(navLinks, navBrand);

  const loggedIn = isLoggedIn();
  const user = getCurrentUser();

  // My Reports, My Concerns/Suggestions and the bell are only for logged-in citizens.
  document.querySelectorAll("[data-auth-only]").forEach((el) => {
    el.hidden = !loggedIn;
  });

  // Guests who click "File a Report" / "Submit Suggestion" get a Sign Up / Login prompt.
  // (Delegated, so links the footer adds later are covered too.)
  const authGateModal = document.getElementById("authGateModal");
  const authGateTitle = document.getElementById("authGateTitle");
  document.addEventListener("click", (e) => {
    const link = e.target.closest("[data-auth-gate]");
    if (!link || loggedIn || !authGateModal || !authGateTitle) return;
    e.preventDefault();
    authGateTitle.textContent =
      link.dataset.authGate === "report" ? "Want to Submit a Report?" : "Want to Submit a Concern/Suggestion?";
    authGateModal.hidden = false;
  });

  // Profile icon: opens the account popup (guests go to the login page instead).
  const profileBtn = document.querySelector(".navbar__profile");
  const profileModal = document.getElementById("profileModal");
  if (profileBtn && profileModal) {
    wireAccountArea(profileBtn, navLinks, loggedIn && user ? user : null);

    const openProfileModal = () => {
      if (!(loggedIn && user)) {
        window.location.href = "/citizen/login.html";
        return;
      }
      document.getElementById("profileGuestView").hidden = true;
      document.getElementById("profileUserView").hidden = false;
      document.getElementById("profileUserName").textContent = user.name;
      renderAvatar(document.getElementById("profileUserInitials"), user);
      profileModal.hidden = false;
    };
    profileBtn.addEventListener("click", openProfileModal);
    profileBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openProfileModal();
      }
    });
  }

  // Log Out -> "Continue to Logout?" -> clear the session and go to the login page.
  const logoutBtn = document.getElementById("logoutBtn");
  const logoutConfirmModal = document.getElementById("logoutConfirmModal");
  if (logoutBtn && logoutConfirmModal) {
    logoutBtn.addEventListener("click", () => {
      profileModal.hidden = true;
      logoutConfirmModal.hidden = false;
    });
  }
  const logoutYes = document.getElementById("logoutYes");
  const logoutNo = document.getElementById("logoutNo");
  if (logoutYes) {
    logoutYes.addEventListener("click", async () => {
      try {
        await authFetch("/api/auth/logout/", { method: "POST" }); // records the logout time
      } catch {
        // logging out locally still happens
      }
      logOut();
      window.location.href = "/citizen/login.html";
    });
  }
  if (logoutNo) {
    logoutNo.addEventListener("click", () => {
      logoutConfirmModal.hidden = true;
    });
  }

  // Notification bell: checks for updates now and every 30 seconds while logged in.
  const bell = setupNotificationBell(notificationStore);
  if (bell && loggedIn) {
    const poll = () => Promise.all([checkForReportUpdates(), checkForConcernUpdates()]).then(bell.render);
    poll();
    setInterval(poll, 30000);
  }

  // Floating "Ask a Question" button (guests get the Sign Up / Login prompt).
  const askFab = document.getElementById("askQuestionFab");
  const askQuestionModal = document.getElementById("askQuestionModal");
  const askQuestionSentModal = document.getElementById("askQuestionSentModal");
  const askForm = document.getElementById("askQuestionForm");
  const questionInput = document.getElementById("questionInput");

  if (askFab && askQuestionModal) {
    askFab.addEventListener("click", () => {
      if (!isLoggedIn()) {
        if (authGateModal && authGateTitle) {
          authGateTitle.textContent = "Want to Ask a Question?";
          authGateModal.hidden = false;
        }
        return;
      }
      askQuestionModal.hidden = false;
    });
  }

  if (askForm) {
    askForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = askForm.querySelector('button[type="submit"]');
      const value = questionInput.value.trim();
      if (!value) return;

      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
      try {
        await askQuestion(value);
        questionInput.value = "";
        if (askQuestionModal) askQuestionModal.hidden = true;
        if (askQuestionSentModal) askQuestionSentModal.hidden = false;
      } catch (err) {
        siteAlert(err.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Submit Question";
      }
    });
  }

  if (askQuestionSentModal) {
    askQuestionSentModal.querySelectorAll("[data-modal-confirm]").forEach((btn) => {
      btn.addEventListener("click", () => {
        askQuestionSentModal.hidden = true;
      });
    });
  }

  // Closing pop-ups: their close buttons, or a click on the dark background
  // (except [data-modal-mandatory] pop-ups like the Sign Up terms).
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".modal-overlay").hidden = true;
    });
  });
  document.querySelectorAll(".modal-overlay:not([data-modal-mandatory])").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.hidden = true;
    });
  });
});
