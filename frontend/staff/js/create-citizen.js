// Barangay Platero OVRMS — Create Citizen Account (Barangay Secretary): the staff member
// enters the citizen's full details directly. The account is created and usable
// immediately — its email and an auto-generated password are emailed to the citizen
// (see StaffCreateCitizenSerializer) rather than the citizen completing their own
// profile via an emailed invite.

// Highlights one input/select red with an inline message underneath it — same
// pattern as frontend/citizen/js/main.js's markFieldInvalid, duplicated here
// since this page doesn't load that file.
function markFieldInvalid(input, message) {
  if (!input) return;
  input.classList.add("field-invalid");
  const field = input.closest(".field") || input.parentElement;
  let errEl = field.querySelector(".field-error");
  if (!errEl) {
    errEl = document.createElement("p");
    errEl.className = "field-error";
    field.appendChild(errEl);
  }
  errEl.textContent = message;
  input.addEventListener("input", () => clearFieldInvalid(input), { once: true });
}

function clearFieldInvalid(input) {
  if (!input) return;
  input.classList.remove("field-invalid");
  const field = input.closest(".field") || input.parentElement;
  const errEl = field.querySelector(".field-error");
  if (errEl) errEl.remove();
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("createCitizenForm");
  const firstName = document.getElementById("citizenFirstName");
  const middleInitial = document.getElementById("citizenMiddleInitial");
  const lastName = document.getElementById("citizenLastName");
  const email = document.getElementById("citizenEmail");
  const phone = document.getElementById("citizenPhone");
  const streetInput = document.getElementById("citizenStreet");
  const streetList = document.getElementById("citizenStreetList");
  const blockLot = document.getElementById("citizenBlockLot");
  const submitBtn = document.getElementById("inviteSubmit");
  const statusEl = document.getElementById("inviteStatus");

  // Street: type-to-filter combobox over the real street list (see
  // street-coordinates.js) — same pattern as Sign Up's street field.
  ensureStreetsLoaded()
    .then(() => {
      const renderOptions = () => {
        const query = streetInput.value.trim().toLowerCase();
        const matches = query ? STREETS.filter((s) => s.toLowerCase().includes(query)) : STREETS;
        streetList.innerHTML = matches.length
          ? matches.map((s) => `<li data-value="${s}">${s}</li>`).join("")
          : `<li class="combobox__empty">No matching street</li>`;
        streetList.hidden = false;
      };
      streetInput.addEventListener("focus", renderOptions);
      streetInput.addEventListener("input", renderOptions);
      streetList.addEventListener("click", (e) => {
        const option = e.target.closest("li[data-value]");
        if (!option) return;
        streetInput.value = option.dataset.value;
        streetList.hidden = true;
      });
      document.addEventListener("click", (e) => {
        if (!streetInput.contains(e.target) && !streetList.contains(e.target)) {
          streetList.hidden = true;
        }
      });
      streetInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") streetList.hidden = true;
      });
    })
    .catch(() => {
      // Best-effort — the combobox just shows no options if this fails.
    });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearFormError(form);
    statusEl.hidden = true;
    [email, phone, streetInput].forEach(clearFieldInvalid);

    if (!STREETS.includes(streetInput.value.trim())) {
      markFieldInvalid(streetInput, "Please select a street from the list.");
      return;
    }

    const payload = {
      first_name: firstName.value.trim(),
      middle_initial: middleInitial.value.trim(),
      last_name: lastName.value.trim(),
      email: email.value.trim(),
      contact_number: phone.value.trim(),
      address: `${blockLot.value.trim()}, ${streetInput.value.trim()}`,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating...";
    try {
      const response = await authFetch("/api/auth/admin/create-citizen-direct/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.email) markFieldInvalid(email, data.email[0]);
        if (data.contact_number) markFieldInvalid(phone, data.contact_number[0]);
        if (data.email || data.contact_number) return;
        const firstError = Object.values(data)[0];
        throw new Error(data.detail || (Array.isArray(firstError) ? firstError[0] : "Could not create the account."));
      }
      statusEl.textContent = `Account created for ${payload.email}. We've emailed them their login.`;
      statusEl.hidden = false;
      form.reset();
    } catch (err) {
      showFormError(form, err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Create Account";
    }
  });
});
