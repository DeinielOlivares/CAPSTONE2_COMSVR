// Barangay Platero OVRMS — Notifications: full, unpruned view of everything in the bell
// dropdown. Reuses the same storage + helpers as the topbar bell (see
// admin.js) so dismissing or clearing here stays in sync with the dropdown.

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("notifPageList");
  const clearAllBtn = document.getElementById("notifPageClearAll");
  if (!listEl) return;

  function render() {
    const notifications = getAdminNotifications();
    listEl.innerHTML = notifications.length
      ? notifications
          .map(
            (n) => `
            <li class="notif-page__item">
              <div class="notif-dropdown__content" data-goto="${n.id}">
                <span class="notif-dropdown__message">${n.message}</span>
                <span class="notif-dropdown__time">${timeAgo(n.time)}</span>
              </div>
              <button type="button" class="notif-dropdown__dismiss" data-dismiss="${n.id}" aria-label="Dismiss notification">&times;</button>
            </li>`
          )
          .join("")
      : `<li class="notif-page__empty">No notifications yet.</li>`;
  }
  render();

  listEl.addEventListener("click", (e) => {
    const dismissBtn = e.target.closest("[data-dismiss]");
    if (dismissBtn) {
      e.stopPropagation();
      removeAdminNotification(dismissBtn.dataset.dismiss);
      render();
      return;
    }
    const goto = e.target.closest("[data-goto]");
    if (!goto) return;
    const notification = getAdminNotifications().find((n) => n.id === goto.dataset.goto);
    removeAdminNotification(goto.dataset.goto);
    if (notification && notification.link) {
      window.location.href = notification.link;
    } else {
      render();
    }
  });

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      clearAllAdminNotifications();
      render();
    });
  }
});
