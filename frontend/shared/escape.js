// Makes a stored or user-supplied value safe to place in an HTML string, in
// element text or inside a quoted attribute. Use it for every value that goes
// into innerHTML; prefer textContent when no markup is needed.
function safeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
