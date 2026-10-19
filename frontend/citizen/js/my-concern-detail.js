// My Concern/Suggestion detail (citizen): shows the concern given by ?id=.

document.addEventListener("DOMContentLoaded", async () => {
  const id = new URLSearchParams(window.location.search).get("id");
  let concern = null;
  try {
    concern = id ? await getConcernById(id) : null;
  } catch {
    concern = null;
  }

  if (!concern) {
    document.querySelector(".concern-detail__main").innerHTML =
      "<p>Suggestion/Concern not found.</p>";
    return;
  }

  document.title = "Concern/Suggestion — Barangay Platero OVRMS";
  document.getElementById("concernLocation").value = concern.location;
  document.getElementById("concernDescription").value = concern.description;
  renderEvidence(document.getElementById("concernEvidence"), concern.attachments);

  // Two steps: Submitted, then Reviewed (the Secretary's reply is in Remarks).
  const formatDateTime = (iso) =>
    new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const reviewed = concern.status === "reviewed";
  const steps = [
    { label: "Submitted", description: "Your concern/suggestion was submitted successfully.", pending: false, at: concern.created_at },
    {
      label: "Reviewed",
      description: reviewed
        ? "A Barangay Official has read your concern/suggestion."
        : "Waiting for a Barangay Official to read your concern/suggestion.",
      pending: !reviewed,
      at: concern.reviewed_at || concern.updated_at,
    },
  ];
  document.getElementById("timelineItems").innerHTML = steps
    .map(
      (step) => `
      <div class="status-timeline__item">
        <span class="status-timeline__dot${step.pending ? " status-timeline__dot--pending" : ""}"></span>
        <div>
          <div class="status-timeline__meta">
            <span class="status-timeline__label${step.pending ? " status-timeline__label--pending" : ""}">${step.label}</span>
            <span class="status-timeline__date">${step.pending ? "Pending" : formatDateTime(step.at)}</span>
          </div>
          <p class="status-timeline__desc">${step.description}</p>
        </div>
      </div>`
    )
    .join("");

  if (concern.remarks) {
    document.getElementById("remarksCard").hidden = false;
    document.getElementById("remarksText").textContent = concern.remarks;
    showRemarksPopupOnce(concern.id, concern.remarks);
  }
});

// Shows the remarks in a popup the first time they are seen.
function showRemarksPopupOnce(concernId, remarks) {
  const SEEN_KEY = "orms_citizen_seen_concern_remarks";
  let seen;
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || [];
  } catch {
    seen = [];
  }
  if (seen.includes(concernId)) return;

  document.getElementById("remarksPopupText").textContent = remarks;
  document.getElementById("remarksPopupModal").hidden = false;

  seen.push(concernId);
  localStorage.setItem(SEEN_KEY, JSON.stringify(seen));
}
