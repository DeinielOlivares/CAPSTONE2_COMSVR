// Notifications page (all three portals): the full list of what's in the bell.
// Uses the portal's `notificationStore` (made in citizen/js/main.js,
// staff/js/layout.js or admin/js/layout.js), so dismissing here also updates the bell.

document.addEventListener("DOMContentLoaded", () => {
  const listEl = document.getElementById("notifPageList");
  const clearAllBtn = document.getElementById("notifPageClearAll");
  if (!listEl) return;

  function render() {
    listEl.innerHTML = notificationItemsHtml(
      notificationStore.list(),
      "notif-page__item",
      `<li class="notif-page__empty">No notifications yet.</li>`
    );
  }
  render();

  listEl.addEventListener("click", (e) => handleNotificationClick(e, notificationStore, render));

  if (clearAllBtn) {
    clearAllBtn.addEventListener("click", () => {
      notificationStore.clear();
      render();
    });
  }
});
