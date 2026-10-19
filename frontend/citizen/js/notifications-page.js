// Barangay Platero OVRMS — Notifications: full, unpruned view of everything in the bell
// dropdown (which only shows the current CITIZEN_NOTIFICATIONS_MAX=20). Reuses
// the same storage + helpers as the navbar bell (see main.js) so dismissing
// or clearing here stays in sync with the dropdown.

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("notifPageList");
  const clearAllBtn = document.getElementById("notifPageClearAll");
  if (!listEl) return;

  function render() {
    const notifications = getCitizenNotifications();
    listEl.innerHTML = notifications.length
      ? notifications
          .map(
            (n) => `
            <li class="notif-page__item">
              <div class="notif-dropdown__content" data-goto="${n.id}">
                <span class="notif-dropdown__message">${n.message}</span>
                <span class="notif-dropdown__time">${citizenTimeAgo(n.time)}</span>
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
      removeCitizenNotification(dismissBtn.dataset.dismiss);
      render();
      return;
    }
    const goto = e.target.closest("[data-goto]");
    if (!goto) return;
    const notification = getCitizenNotifications().find((n) => n.id === goto.dataset.goto);
    removeCitizenNotification(goto.dataset.goto);
    if (notification && notification.link) {
      window.location.href = notification.link;
    } else {
      render();
    }
  });

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      clearAllCitizenNotifications();
      render();
    });
  }
});
