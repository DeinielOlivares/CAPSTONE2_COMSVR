// Barangay Platero OVRMS — File Report: populate the ordinance dropdown from the real
// uploaded ordinances, then submit the report to the real API
// (POST /api/reports/) instead of just showing a success modal with
// nothing actually saved.

document.addEventListener("DOMContentLoaded", async () => {
  // Incident date can't be in the future — you can only report something that's already happened.
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

  // ---- Verify It's You gate (first-ever report, or 30+ days since the last one) + cooldown ----
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
  // Only popped up once per page load — repeat gate-status checks (after
  // verifying, after a 429 on submit, etc.) shouldn't reopen it.
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
      // Fail soft — the real gate check still runs again on submit.
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

  // Single entry point for picking an ordinance, whichever UI triggered it
  // (the dropdown itself or a TF-IDF suggestion below) — drives the real
  // (hidden) <select> so its one "change" listener is the only place the
  // rest of the form's state (Other field, trigger label) gets synced.
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

  // "Other" reveals a free-text field for whatever isn't in the list —
  // that text is what actually gets submitted as the ordinance, not the
  // literal word "Other" (see the submit handler below).
  const otherField = document.getElementById("otherOrdinanceField");
  const otherInput = document.getElementById("otherOrdinanceInput");
  select.addEventListener("change", () => {
    const isOther = select.value === "other";
    otherField.hidden = !isOther;
    otherInput.required = isOther;
    if (!isOther) otherInput.value = "";
    ordinanceTriggerLabel.textContent = select.value ? select.options[select.selectedIndex].text : "Select";
  });

  // The Clear button is a native type="reset" — it puts the hidden <select>
  // back to its default option but (per spec) doesn't fire "change" for it,
  // so the custom dropdown's label and the Other field would otherwise be
  // left showing the old selection. Deferred so it runs after the browser's
  // own reset of the form's controls, not before.
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
      // Fail soft — a broken suggestion fetch must never block report submission.
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

  // ---- Street: type-to-filter street combobox ----
  // Best-effort — on failure STREETS just stays empty, same as any other
  // street-data.js consumer; the field degrades to "no matching street".
  await ensureStreetsLoaded().catch(() => {});
  const locationInput = document.getElementById("reportLocation");
  const locationList = document.getElementById("reportLocationList");

  function renderLocationOptions() {
    const query = locationInput.value.trim().toLowerCase();
    const matches = query ? STREETS.filter((s) => s.toLowerCase().includes(query)) : STREETS;
    locationList.innerHTML = matches.length
      ? matches.map((s) => `<li data-value="${s}">${s}</li>`).join("")
      : `<li class="combobox__empty">No matching street</li>`;
    locationList.hidden = false;
  }

  locationInput.addEventListener("focus", renderLocationOptions);
  locationInput.addEventListener("input", renderLocationOptions);
  locationList.addEventListener("click", (e) => {
    const option = e.target.closest("li[data-value]");
    if (!option) return;
    locationInput.value = option.dataset.value;
    locationList.hidden = true;
  });
  document.addEventListener("click", (e) => {
    if (!locationInput.contains(e.target) && !locationList.contains(e.target)) {
      locationList.hidden = true;
    }
  });

  locationInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") locationList.hidden = true;
  });

  // ---- Current location (optional, on top of the required street) ----
  // Asked for once, the first time the citizen starts on the Street field
  // (not on page load, so the browser prompt shows up in context). If they
  // deny it, it times out, or they untick the box, the report is filed with
  // just the street and the staff heatmap uses that street's centroid
  // instead. The backend also drops a position outside the barangay.
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

    // The real <select> is hidden (see the custom dropdown above it), which
    // takes it out of native constraint validation — so "required" has to
    // be enforced here instead of relying on the browser to block submit.
    if (!select.value) {
      showFormError(form, "Please select the ordinance in violation.");
      return;
    }

    if (select.value === "other" && !otherInput.value.trim()) {
      showFormError(form, "Please specify the ordinance in violation.");
      return;
    }

    const formData = new FormData();
    // Combines Block/Lot with the selected street into one location string
    // — same composition as Sign Up's address field — since Report.location
    // is a single text field, not separate columns.
    formData.append("location", `${blockLot}, ${locationInput.value.trim()}`);
    if (useGeoInput.checked) {
      // Usually already resolved from when the Street field was focused;
      // a still-pending prompt is only waited on briefly so it can't hold
      // up the submission.
      const coords = await Promise.race([requestGeo(), new Promise((r) => setTimeout(() => r(null), 3000))]);
      if (coords) {
        formData.append("latitude", coords.lat.toFixed(6));
        formData.append("longitude", coords.lng.toFixed(6));
      }
    }
    // Stores the ordinance's readable label as free text rather than its id
    // — Report.ordinance is a text snapshot, not a foreign key, so a report
    // still shows what it cited even if that ordinance is later edited or removed.
    formData.append(
      "ordinance",
      select.value === "other" ? `Other: ${otherInput.value.trim()}` : select.options[select.selectedIndex].text
    );
    formData.append("incident_date", document.getElementById("incidentDate").value);
    // Time of incident is optional — an unknown/unset time is common for
    // reports of ongoing or long-standing violations, so only send it when
    // the citizen actually picked one; an empty string would fail TimeField validation.
    const incidentTimeValue = document.getElementById("incidentTime").value;
    if (incidentTimeValue) formData.append("incident_time", incidentTimeValue);
    formData.append("nature_of_violation", document.getElementById("violationDetails").value.trim());
    Array.from(document.getElementById("reportFiles").files).forEach((file) => formData.append("files", file));

    // Belt-and-suspenders — the status check on load can go stale (e.g. the
    // page sat open past a cooldown boundary), so re-check right before
    // submitting rather than relying solely on refreshGateStatus().
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
        // Refusals come back as {detail: "..."}, field validation as
        // {field: ["..."]}. Anything else (a server error page, a request
        // blocked before it reached the app) has no message, so give the
        // status code instead of nothing.
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
