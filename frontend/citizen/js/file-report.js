// File a Report (citizen). Fills the ordinance dropdown, suggests ordinances
// from the description, asks for the email code when needed, and submits
// the report with POST /api/reports/.

document.addEventListener("DOMContentLoaded", async () => {
  // The incident date can't be in the future.
  document.getElementById("incidentDate").max = new Date().toLocaleDateString("en-CA");

  // ---- Reporting As: read-only citizen info, from the session cache ----
  const reportingUser = getCurrentUser();
  if (reportingUser) {
    const nameField = document.getElementById("reporterName");
    const contactField = document.getElementById("reporterContact");
    const emailField = document.getElementById("reporterEmail");
    const addressField = document.getElementById("reporterAddress");
    if (nameField) nameField.value = reportingUser.name || "";
    if (contactField) contactField.value = reportingUser.mobile || "";
    if (emailField) emailField.value = reportingUser.email || "";
    if (addressField) addressField.value = reportingUser.address || "";
  }

  // ---- "Verify it's you" code (first report, or 30+ days since the last) and cooldown ----
  const form = document.getElementById("reportForm");
  const submitBtn = form.querySelector('button[type="submit"]');
  const successModal = document.getElementById("successModal");

  const gateNotice = document.getElementById("reportGateNotice");
  const gateNoticeText = document.getElementById("reportGateNoticeText");
  const gateVerifyBtn = document.getElementById("reportGateVerifyBtn");
  const cooldownModal = document.getElementById("reportCooldownModal");
  const cooldownModalText = document.getElementById("reportCooldownText");
  const verifyModal = document.getElementById("reportVerifyModal");
  const verifyError = document.getElementById("reportVerifyError");
  const verifySendRow = document.getElementById("reportVerifySendRow");
  const verifySendBtn = document.getElementById("reportVerifySendBtn");
  const verifyCodeRow = document.getElementById("reportVerifyCodeRow");
  const verifyCodeInput = document.getElementById("reportVerifyCodeInput");
  const verifyCheckRow = document.getElementById("reportVerifyCheckRow");
  const verifyCheckBtn = document.getElementById("reportVerifyCheckBtn");
  const verifyResendBtn = document.getElementById("reportVerifyResendBtn");

  let verificationNeeded = false;
  let cooldownActive = false;
  // The popup opens at most once per page load.
  let cooldownModalShown = false;

  function showVerifyError(message) {
    verifyError.textContent = message;
    verifyError.hidden = false;
  }

  function openVerifyModal() {
    verifyError.hidden = true;
    verifySendRow.hidden = false;
    verifyCodeRow.hidden = true;
    verifyCheckRow.hidden = true;
    verifyCodeInput.value = "";
    verifyModal.hidden = false;
  }

  function applyGateStatus({ verification_required, cooldown_seconds }) {
    verificationNeeded = !!verification_required;
    cooldownActive = cooldown_seconds > 0;
    if (cooldownActive) {
      gateNotice.hidden = true;
      submitBtn.disabled = true;
      if (!cooldownModalShown) {
        cooldownModalShown = true;
        const minutes = Math.max(1, Math.ceil(cooldown_seconds / 60));
        cooldownModalText.textContent = `You can file another report in about ${minutes} minute(s).`;
        cooldownModal.hidden = false;
      }
    } else if (verificationNeeded) {
      gateNoticeText.textContent = "Please verify it's you before filing this report.";
      gateVerifyBtn.hidden = false;
      gateNotice.hidden = false;
      submitBtn.disabled = true;
    } else {
      gateNotice.hidden = true;
      submitBtn.disabled = false;
    }
  }

  async function refreshGateStatus() {
    if (!isLoggedIn()) return;
    try {
      const res = await authFetch("/api/reports/verification-status/");
      if (!res.ok) return;
      applyGateStatus(await res.json());
    } catch {
      // Ignore; the server checks again on submit.
    }
  }

  async function sendVerificationCode() {
    verifySendBtn.disabled = true;
    verifyResendBtn.disabled = true;
    verifyError.hidden = true;
    const sendingLabel = verifySendRow.hidden ? verifyResendBtn : verifySendBtn;
    const originalLabel = sendingLabel.textContent;
    sendingLabel.textContent = "Sending...";
    try {
      const res = await authFetch("/api/reports/send-verification/", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Could not send a verification code. Please try again.");
      }
      verifySendRow.hidden = true;
      verifyCodeRow.hidden = false;
      verifyCheckRow.hidden = false;
      verifyCodeInput.focus();
    } catch (err) {
      showVerifyError(err.message);
    } finally {
      verifySendBtn.disabled = false;
      verifyResendBtn.disabled = false;
      sendingLabel.textContent = originalLabel;
    }
  }

  gateVerifyBtn.addEventListener("click", openVerifyModal);
  verifySendBtn.addEventListener("click", sendVerificationCode);
  verifyResendBtn.addEventListener("click", sendVerificationCode);

  verifyCheckBtn.addEventListener("click", async () => {
    const code = verifyCodeInput.value.trim();
    if (!code) {
      showVerifyError("Please enter the code sent to your email.");
      return;
    }
    verifyCheckBtn.disabled = true;
    verifyCheckBtn.textContent = "Verifying...";
    verifyError.hidden = true;
    try {
      const res = await authFetch("/api/reports/verify-code/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const firstError = Object.values(data)[0];
        throw new Error(Array.isArray(firstError) ? firstError[0] : data.detail || "Invalid or expired code.");
      }
      verifyModal.hidden = true;
      verificationNeeded = false;
      gateNotice.hidden = true;
      submitBtn.disabled = cooldownActive;
    } catch (err) {
      showVerifyError(err.message);
    } finally {
      verifyCheckBtn.disabled = false;
      verifyCheckBtn.textContent = "Verify";
    }
  });

  if (isLoggedIn()) refreshGateStatus();

  const select = document.getElementById("ordinanceSelect");
  const ordinanceCombobox = document.getElementById("ordinanceCombobox");
  const ordinanceTrigger = document.getElementById("ordinanceTrigger");
  const ordinanceTriggerLabel = document.getElementById("ordinanceTriggerLabel");
  const ordinanceOptionsList = document.getElementById("ordinanceOptionsList");

  function ordinanceLabel(o) {
    return `${o.number} — ${o.title}`;
  }

  let ordinancesForPicker = [];
  let ordinanceLoadError = false;
  try {
    await ensureOrdinancesLoaded();
    ordinancesForPicker = liveOrdinances();
    select.append(...ordinancesForPicker.map((o) => new Option(ordinanceLabel(o), o.id)));
  } catch {
    ordinanceLoadError = true;
    select.append(new Option("Could not load ordinances — try reloading the page.", ""));
  }
  select.append(new Option("Other", "other"));

  ordinanceOptionsList.innerHTML = ordinanceLoadError
    ? `<li class="combobox__empty">Could not load ordinances — try reloading the page.</li><li role="option" data-id="other">Other</li>`
    : `${ordinancesForPicker.map((o) => `<li role="option" data-id="${o.id}">${ordinanceLabel(o)}</li>`).join("")}<li role="option" data-id="other">Other</li>`;

  // Picks an ordinance (from the dropdown or a suggestion) by setting the
  // hidden <select>; its "change" listener updates the rest of the form.
  function selectOrdinance(id) {
    select.value = id;
    select.dispatchEvent(new Event("change"));
  }

  function openOrdinanceList() {
    ordinanceOptionsList.hidden = false;
    ordinanceTrigger.setAttribute("aria-expanded", "true");
  }
  function closeOrdinanceList() {
    ordinanceOptionsList.hidden = true;
    ordinanceTrigger.setAttribute("aria-expanded", "false");
  }
  ordinanceTrigger.addEventListener("click", () => {
    if (ordinanceOptionsList.hidden) openOrdinanceList();
    else closeOrdinanceList();
  });
  ordinanceOptionsList.addEventListener("click", (e) => {
    const item = e.target.closest("li[data-id]");
    if (!item) return;
    selectOrdinance(item.dataset.id);
    closeOrdinanceList();
  });
  document.addEventListener("click", (e) => {
    if (!ordinanceCombobox.contains(e.target)) closeOrdinanceList();
  });
  ordinanceTrigger.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeOrdinanceList();
  });

  // "Other" shows a text field; what's typed there is submitted as the ordinance.
  const otherField = document.getElementById("otherOrdinanceField");
  const otherInput = document.getElementById("otherOrdinanceInput");
  select.addEventListener("change", () => {
    const isOther = select.value === "other";
    otherField.hidden = !isOther;
    otherInput.required = isOther;
    if (!isOther) otherInput.value = "";
    ordinanceTriggerLabel.textContent = select.value ? select.options[select.selectedIndex].text : "Select";
  });

  // Clear (a reset button) doesn't fire "change", so update the dropdown
  // label and Other field ourselves — after the browser's own reset.
  form.addEventListener("reset", () => {
    setTimeout(() => select.dispatchEvent(new Event("change")), 0);
  });

  // ---- Nature of Violation: TF-IDF ordinance suggestions (GET /api/ordinances/suggest/) ----
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  const violationInput = document.getElementById("violationDetails");
  const suggestionsPanel = document.getElementById("ordinanceSuggestions");
  const suggestionsList = document.getElementById("ordinanceSuggestionsList");

  function renderSuggestions(results) {
    if (!results.length) {
      suggestionsPanel.hidden = true;
      return;
    }
    suggestionsList.innerHTML = results
      .map((r) => `<li data-id="${r.id}">${r.number} — ${r.title}</li>`)
      .join("");
    suggestionsPanel.hidden = false;
  }

  const debouncedFetchSuggestions = debounce(async (text) => {
    if (text.trim().length < 3) {
      suggestionsPanel.hidden = true;
      return;
    }
    try {
      const response = await fetch(`/api/ordinances/suggest/?q=${encodeURIComponent(text.trim())}`);
      if (!response.ok) throw new Error("suggest failed");
      const { results } = await response.json();
      renderSuggestions(results || []);
    } catch {
      // Suggestions are optional; never block the report because of them.
      suggestionsPanel.hidden = true;
    }
  }, 400);

  violationInput.addEventListener("input", () => debouncedFetchSuggestions(violationInput.value));

  suggestionsList.addEventListener("click", (e) => {
    const item = e.target.closest("li[data-id]");
    if (!item) return;
    selectOrdinance(item.dataset.id);
    suggestionsPanel.hidden = true;
  });

  // ---- Street picker (see /shared/js/streets.js) ----
  await ensureStreetsLoaded().catch(() => {}); // on failure the list is just empty
  const locationInput = document.getElementById("reportLocation");
  wireStreetCombobox("reportLocation", "reportLocationList", { announceChange: false });

  // ---- Current location (optional) ----
  // The browser asks for the device location the first time the Street field
  // is used. Without it, the heatmap uses the street's point instead.
  // (The server ignores positions outside the barangay.)
  const useGeoInput = document.getElementById("reportUseGeo");
  const geoStatus = document.getElementById("reportGeoStatus");
  let geoCoords = null;
  let geoRequest = null;

  function setGeoStatus(text, ok) {
    geoStatus.textContent = text;
    geoStatus.classList.toggle("geo-status--ok", !!ok);
    geoStatus.hidden = !text;
  }

  function requestGeo() {
    if (geoRequest) return geoRequest;
    if (!("geolocation" in navigator)) {
      setGeoStatus("Location isn't available on this device — your selected street will be used.");
      geoRequest = Promise.resolve(null);
      return geoRequest;
    }
    setGeoStatus("Getting your location...");
    geoRequest = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          geoCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (useGeoInput.checked) setGeoStatus("Current location pinned.", true);
          resolve(geoCoords);
        },
        () => {
          setGeoStatus("Location not shared — your selected street will be used instead.");
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      );
    });
    return geoRequest;
  }

  locationInput.addEventListener("focus", () => {
    if (useGeoInput.checked) requestGeo();
  });
  useGeoInput.addEventListener("change", () => {
    if (!useGeoInput.checked) {
      setGeoStatus("");
    } else if (geoCoords) {
      setGeoStatus("Current location pinned.", true);
    } else {
      geoRequest = null; // allow a retry after an earlier denial/timeout
      requestGeo();
    }
  });

  let reportFiledThisVisit = false;
  const blockLotInput = document.getElementById("reportBlockLot");
  const unsavedGuard = guardUnsavedForm(form);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);
    clearFieldInvalid(locationInput);
    clearFieldInvalid(blockLotInput);

    if (!isLoggedIn()) {
      showFormError(form, "Please log in to submit a report.");
      return;
    }

    if (!STREETS.includes(locationInput.value.trim())) {
      markFieldInvalid(locationInput, "Please select a street from the list.");
      return;
    }

    const blockLot = blockLotInput.value.trim();
    if (!blockLot) {
      markFieldInvalid(blockLotInput, "Please enter the Block, Lot, etc.");
      return;
    }

    // The <select> is hidden, so the browser doesn't check "required" — do it here.
    if (!select.value) {
      showFormError(form, "Please select the ordinance in violation.");
      return;
    }

    if (select.value === "other" && !otherInput.value.trim()) {
      showFormError(form, "Please specify the ordinance in violation.");
      return;
    }

    const formData = new FormData();
    // Location is saved as one text: "Block/Lot, Street".
    formData.append("location", `${blockLot}, ${locationInput.value.trim()}`);
    if (useGeoInput.checked) {
      // Wait only briefly for a location prompt that is still open.
      const coords = await Promise.race([requestGeo(), new Promise((r) => setTimeout(() => r(null), 3000))]);
      if (coords) {
        formData.append("latitude", coords.lat.toFixed(6));
        formData.append("longitude", coords.lng.toFixed(6));
      }
    }
    // The ordinance is saved as its label ("number — title"), so the report
    // keeps what was cited even if the ordinance changes later.
    formData.append(
      "ordinance",
      select.value === "other" ? `Other: ${otherInput.value.trim()}` : select.options[select.selectedIndex].text
    );
    formData.append("incident_date", document.getElementById("incidentDate").value);
    // The time is optional; only send it when one was picked.
    const incidentTimeValue = document.getElementById("incidentTime").value;
    if (incidentTimeValue) formData.append("incident_time", incidentTimeValue);
    formData.append("nature_of_violation", document.getElementById("violationDetails").value.trim());
    Array.from(document.getElementById("reportFiles").files).forEach((file) => formData.append("files", file));

    // Check the code/cooldown status again right before submitting.
    if (verificationNeeded) {
      openVerifyModal();
      showFormError(form, "Please verify it's you before filing this report.");
      return;
    }
    if (cooldownActive) {
      showFormError(form, "You're still in the cooldown period between reports.");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting...";
    try {
      const response = await authFetch("/api/reports/", { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.verification_required) {
          applyGateStatus({ verification_required: true, cooldown_seconds: 0 });
          openVerifyModal();
        } else if (response.status === 429) {
          refreshGateStatus();
        }
        // Show {detail} or the first field error; otherwise the status code.
        if (typeof data.detail === "string") throw new Error(data.detail);
        const firstError = Object.values(data)[0];
        if (Array.isArray(firstError)) throw new Error(firstError[0]);
        throw new Error(`Could not submit your report. (server responded ${response.status})`);
      }
      reportFiledThisVisit = true;
      unsavedGuard.allowLeave();
      successModal.hidden = false;
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      submitBtn.disabled = verificationNeeded || cooldownActive || reportFiledThisVisit;
      submitBtn.textContent = reportFiledThisVisit ? "Report Submitted" : "Submit Report";
    }
  });

  successModal.querySelectorAll("[data-modal-confirm]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "ordinances.html";
    });
  });
});
