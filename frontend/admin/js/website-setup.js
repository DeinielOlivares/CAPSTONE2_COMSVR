// Barangay Platero OVRMS — Website Setup: the Administrator's site-wide settings — the
// navbar/sidebar brand name and logo, and the footer's text and links. Saves
// go to the same /api/site/ endpoints as About Us Setup (see siteinfo/views.py).

document.addEventListener("DOMContentLoaded", async () => {
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
  const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const IMAGE_MIN_SIDE = 400;

  // Warnings for a picked image. A hard problem (wrong type, too big) also
  // clears the pick; soft ones (small, not square) just advise.
  function checkPickedImage(file, img, { isLogo }) {
    if (!IMAGE_TYPES.includes(file.type)) return { error: "Use a JPG, PNG or WebP image." };
    if (file.size > IMAGE_MAX_BYTES) {
      return { error: `This file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Use an image up to 5 MB.` };
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const notes = [];
    if (Math.min(w, h) < IMAGE_MIN_SIDE) {
      notes.push(`This image is ${w} × ${h} px, smaller than the recommended ${IMAGE_MIN_SIDE} × ${IMAGE_MIN_SIDE} px, so it may look blurry.`);
    }
    if (Math.abs(w - h) / Math.max(w, h) > 0.1) {
      notes.push(
        isLogo
          ? "It isn't square, so it will be shrunk to fit and look smaller than the other logos."
          : "It isn't square, so the edges will be cropped off in the circle. Check that the face is still centered."
      );
    }
    if (isLogo && file.type !== "image/png") {
      notes.push("A JPG has no transparent background, so a white box may show around the logo on the green strip.");
    }
    return { notes };
  }

  // Previews a chosen image before upload; returns a function that clears it.
  // `framed`: draw the green ring on the preview, as About Us will for an
  // uploaded portrait (seeded ones have it baked into the image already).
  function wireImagePicker(input, preview, empty, warn, options) {
    let objectUrl = null;
    let previousFramed = false;
    function show(url, framed) {
      if (objectUrl && url !== objectUrl) URL.revokeObjectURL(objectUrl);
      preview.src = url || "";
      preview.hidden = !url;
      empty.hidden = !!url;
      preview.classList.toggle("is-framed", !!(url && framed && !options.isLogo));
    }
    function setWarning(text, isError) {
      warn.textContent = text || "";
      warn.hidden = !text;
      warn.classList.toggle("setup-photo__warn--error", !!isError);
    }
    let previousUrl = "";
    input.addEventListener("change", () => {
      const file = input.files[0];
      setWarning("");
      if (!file) return;
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => {
        const { error, notes } = checkPickedImage(file, probe, options);
        if (error) {
          URL.revokeObjectURL(url);
          input.value = "";
          show(previousUrl, previousFramed);
          setWarning(error, true);
          return;
        }
        objectUrl = url;
        show(url, true);
        setWarning(notes.join(" "));
      };
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        input.value = "";
        show(previousUrl, previousFramed);
        setWarning("That file couldn't be opened as an image. Try a JPG, PNG or WebP.", true);
      };
      probe.src = url;
    });
    return (existingUrl, existingFramed) => {
      input.value = "";
      previousUrl = existingUrl || "";
      previousFramed = !!existingFramed;
      setWarning("");
      show(previousUrl, previousFramed);
    };
  }

  // =========================== Website branding ============================

  const brandingForm = document.getElementById("brandingForm");
  const brandingSave = document.getElementById("brandingSave");
  const brandingStatus = document.getElementById("brandingStatus");
  const brandingSiteName = document.getElementById("brandingSiteName");
  const brandingLogoInput = document.getElementById("brandingLogoInput");
  const resetBrandingLogo = wireImagePicker(
    brandingLogoInput,
    document.getElementById("brandingLogoPreview"),
    document.getElementById("brandingLogoEmpty"),
    document.getElementById("brandingLogoWarn"),
    { isLogo: true }
  );
  let savedBranding = null;

  function fillBrandingForm(branding) {
    savedBranding = branding;
    brandingSiteName.value = branding.site_name || "";
    resetBrandingLogo(branding.site_logo_url || "");
  }

  function isBrandingDirty() {
    if (!savedBranding) return false;
    return brandingSiteName.value.trim() !== (savedBranding.site_name || "") || brandingLogoInput.files.length > 0;
  }

  // Returns true on success — shared between the form's own submit and the
  // page-level unsaved-changes modal's "Save Changes" option below.
  async function commitBrandingSave() {
    clearFormError(brandingForm);
    const siteName = brandingSiteName.value.trim();
    if (!siteName) {
      showFormError(brandingForm, "The website name can't be empty.");
      return false;
    }
    const fields = {};
    if (savedBranding && siteName !== savedBranding.site_name) fields.site_name = siteName;
    if (brandingLogoInput.files[0]) fields.site_logo = brandingLogoInput.files[0];
    if (!Object.keys(fields).length) {
      brandingStatus.textContent = "Nothing to save.";
      return true;
    }

    brandingSave.disabled = true;
    brandingSave.textContent = "Saving...";
    try {
      fillBrandingForm(await saveBranding(fields));
      brandingStatus.textContent = "Saved. The brand is updated across every portal.";
      return true;
    } catch (err) {
      showFormError(brandingForm, err.message);
      return false;
    } finally {
      brandingSave.disabled = false;
      brandingSave.textContent = "Save Branding";
    }
  }

  brandingForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await commitBrandingSave();
  });

  // ================================ Site footer ================================

  const footerForm = document.getElementById("footerForm");
  const footerSave = document.getElementById("footerSave");
  const footerStatus = document.getElementById("footerStatus");
  const footerTagline = document.getElementById("footerTagline");
  const footerNotice = document.getElementById("footerNotice");
  const footerEditors = {
    quick: { el: document.getElementById("footerQuickEditor"), links: [] },
    legal: { el: document.getElementById("footerLegalEditor"), links: [] },
  };

  function renderFooterEditor(key) {
    const editor = footerEditors[key];
    if (!editor.links.length) {
      editor.el.innerHTML = '<p class="field-hint" style="margin: 0;">Using the built-in links.</p>';
      return;
    }
    editor.el.innerHTML = editor.links
      .map(
        (link, i) => `
        <div class="footer-link-row" data-index="${i}">
          <input type="text" class="footer-link-label" maxlength="60" placeholder="Label" value="${escapeHtml(link.label)}" />
          <input type="text" class="footer-link-url" maxlength="500" placeholder="faqs.html or https://…" value="${escapeHtml(link.url)}" />
          <div class="table-row-actions">
            ${key === "legal" && LEGAL_PAGE_KEYS[link.url] ? `<button type="button" data-legal-edit="${LEGAL_PAGE_KEYS[link.url]}">Edit page text</button>` : ""}
            <button type="button" data-footer-move="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>&uarr;</button>
            <button type="button" data-footer-move="1" aria-label="Move down" ${i === editor.links.length - 1 ? "disabled" : ""}>&darr;</button>
            <button type="button" class="table-row-actions__danger" data-footer-remove="1">Remove</button>
          </div>
        </div>`
      )
      .join("");
  }

  // Keeps typed values before a structural change (add/move/remove) re-renders the list.
  function readFooterEditor(key) {
    const editor = footerEditors[key];
    editor.el.querySelectorAll(".footer-link-row").forEach((row, i) => {
      if (!editor.links[i]) return;
      editor.links[i].label = row.querySelector(".footer-link-label").value;
      editor.links[i].url = row.querySelector(".footer-link-url").value;
    });
  }

  let savedFooterSnapshot = null;

  // Same shape saveBarangayProfile's footer fields are sent/received in —
  // doubles as both the dirty-check's comparison value and (via
  // fillFooterForm) the "Discard Changes" restore value.
  function currentFooterValues() {
    readFooterEditor("quick");
    readFooterEditor("legal");
    return {
      footer_tagline: footerTagline.value.trim(),
      footer_notice: footerNotice.value.trim(),
      footer_quick_links: footerEditors.quick.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
      footer_legal_links: footerEditors.legal.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })),
    };
  }

  function isFooterDirty() {
    if (!savedFooterSnapshot) return false;
    return JSON.stringify(currentFooterValues()) !== JSON.stringify(savedFooterSnapshot);
  }

  function fillFooterForm(profile) {
    footerTagline.value = profile.footer_tagline || "";
    footerNotice.value = profile.footer_notice || "";
    footerEditors.quick.links = (profile.footer_quick_links || []).map((l) => ({ ...l }));
    footerEditors.legal.links = (profile.footer_legal_links || []).map((l) => ({ ...l }));
    renderFooterEditor("quick");
    renderFooterEditor("legal");
    savedFooterSnapshot = currentFooterValues();
  }

  document.querySelectorAll("[data-footer-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.footerAdd;
      readFooterEditor(key);
      footerEditors[key].links.push({ label: "", url: "" });
      renderFooterEditor(key);
    });
  });

  ["quick", "legal"].forEach((key) => {
    footerEditors[key].el.addEventListener("click", (e) => {
      const editLegal = e.target.closest("[data-legal-edit]");
      if (editLegal) {
        openLegalEditor(editLegal.dataset.legalEdit);
        return;
      }
      const move = e.target.closest("[data-footer-move]");
      const remove = e.target.closest("[data-footer-remove]");
      if (!move && !remove) return;
      readFooterEditor(key);
      const links = footerEditors[key].links;
      const index = Number(e.target.closest(".footer-link-row").dataset.index);
      if (remove) {
        links.splice(index, 1);
      } else {
        const target = index + Number(move.dataset.footerMove);
        if (target < 0 || target >= links.length) return;
        [links[index], links[target]] = [links[target], links[index]];
      }
      renderFooterEditor(key);
    });
  });

  // Returns true on success — shared between the form's own submit and the
  // page-level unsaved-changes modal's "Save Changes" option below.
  async function commitFooterSave() {
    clearFormError(footerForm);
    readFooterEditor("quick");
    readFooterEditor("legal");
    const clean = (links) =>
      links
        .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
        .filter((l) => l.label || l.url);
    const fields = {
      footer_tagline: footerTagline.value.trim(),
      footer_notice: footerNotice.value.trim(),
      footer_quick_links: clean(footerEditors.quick.links),
      footer_legal_links: clean(footerEditors.legal.links),
    };
    footerSave.disabled = true;
    footerSave.textContent = "Saving...";
    try {
      fillFooterForm(await saveBarangayProfile(fields));
      footerStatus.textContent = "Saved. The footer is updated on every page.";
      return true;
    } catch (err) {
      showFormError(footerForm, err.message);
      return false;
    } finally {
      footerSave.disabled = false;
      footerSave.textContent = "Save Footer";
    }
  }

  footerForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await commitFooterSave();
  });

  // ============== Leaving with unsaved Branding/Footer changes ==============
  // One combined check across both forms (Legal pages has its own separate
  // exit-confirm modal below, scoped to that popup). beforeunload covers
  // browser back/refresh/close; the click interceptor covers in-page
  // navigation (sidebar, etc.) — same "Save Changes?" modal every other
  // editable page in the app uses.

  function isSetupDirty() {
    return isBrandingDirty() || isFooterDirty();
  }

  window.addEventListener("beforeunload", (e) => {
    if (!isSetupDirty()) return;
    e.preventDefault();
    e.returnValue = "";
  });

  const unsavedChangesModal = document.getElementById("unsavedChangesModal");
  const unsavedSaveBtn = document.getElementById("unsavedSaveBtn");
  const unsavedDiscardBtn = document.getElementById("unsavedDiscardBtn");
  const unsavedCancelBtn = document.getElementById("unsavedCancelBtn");
  let pendingAction = null;

  document.addEventListener(
    "click",
    (e) => {
      if (!isSetupDirty()) return;
      const link = e.target.closest("a[href]");
      if (!link) return;
      const href = link.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      e.preventDefault();
      e.stopPropagation();
      pendingAction = () => {
        window.location.href = href;
      };
      unsavedChangesModal.hidden = false;
    },
    true
  );

  unsavedSaveBtn.addEventListener("click", async () => {
    unsavedChangesModal.hidden = true;
    let ok = true;
    if (isBrandingDirty()) ok = (await commitBrandingSave()) && ok;
    if (ok && isFooterDirty()) ok = (await commitFooterSave()) && ok;
    if (ok && pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedDiscardBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    if (savedBranding) fillBrandingForm(savedBranding);
    if (savedFooterSnapshot) fillFooterForm(savedFooterSnapshot);
    if (pendingAction) pendingAction();
    pendingAction = null;
  });
  unsavedCancelBtn.addEventListener("click", () => {
    unsavedChangesModal.hidden = true;
    pendingAction = null;
  });
  unsavedChangesModal.addEventListener("click", (e) => {
    if (e.target === unsavedChangesModal) {
      unsavedChangesModal.hidden = true;
      pendingAction = null;
    }
  });

  // ============================== Legal pages ==============================
  // Opened from the footer's Legal list — each legal page's text and effective date.

  const LEGAL_PAGE_KEYS = { "privacy-policy.html": "privacy", "terms.html": "terms" };
  const LEGAL_PAGE_TITLES = { privacy: "Privacy Policy", terms: "Terms and Agreements" };
  const legalModal = document.getElementById("legalModal");
  const legalEditor = document.getElementById("legalSectionsEditor");
  const legalSave = document.getElementById("legalSave");
  const legalForm = document.getElementById("legalForm");
  const legalEffectiveInput = document.getElementById("legalEffectiveInput");
  let legalSections = [];
  let legalKey = null;
  let legalSnapshot = "";
  const legalExitModal = document.getElementById("legalExitModal");

  function renderLegalEditor() {
    if (!legalSections.length) {
      legalEditor.innerHTML = '<p class="field-hint" style="margin: 0 0 8px;">No sections yet. Add one below.</p>';
      return;
    }
    legalEditor.innerHTML = legalSections
      .map(
        (section, i) => `
        <div class="legal-section-row" data-index="${i}">
          <div class="field">
            <label>Section heading</label>
            <input type="text" class="legal-section-heading" maxlength="200" value="${escapeHtml(section.heading)}" />
          </div>
          <div class="field">
            <label>Text</label>
            <textarea class="legal-section-body" rows="7">${escapeHtml(section.body)}</textarea>
          </div>
          <div class="table-row-actions">
            <button type="button" data-legal-move="-1" aria-label="Move up" ${i === 0 ? "disabled" : ""}>&uarr; Up</button>
            <button type="button" data-legal-move="1" aria-label="Move down" ${i === legalSections.length - 1 ? "disabled" : ""}>&darr; Down</button>
            <button type="button" class="table-row-actions__danger" data-legal-remove="1">Remove section</button>
          </div>
        </div>`
      )
      .join("");
  }

  // Keeps typed text before any add/move/remove re-renders the editor.
  function readLegalEditor() {
    legalEditor.querySelectorAll(".legal-section-row").forEach((row, i) => {
      if (!legalSections[i]) return;
      legalSections[i].heading = row.querySelector(".legal-section-heading").value;
      legalSections[i].body = row.querySelector(".legal-section-body").value;
    });
  }

  function fillLegalForm(data) {
    legalEffectiveInput.value = data.effective_date || "";
    legalSections = data.sections.map((s) => ({ anchor: s.anchor || "", heading: s.heading || "", body: s.body || "" }));
    renderLegalEditor();
    legalSnapshot = legalState();
  }

  function legalState() {
    return JSON.stringify({
      effective: legalEffectiveInput.value.trim(),
      sections: legalSections.map((s) => [s.anchor, s.heading, s.body]),
    });
  }

  function hasUnsavedLegalChanges() {
    readLegalEditor();
    return legalState() !== legalSnapshot;
  }

  function requestCloseLegal() {
    if (!hasUnsavedLegalChanges()) {
      legalModal.hidden = true;
      return;
    }
    legalExitModal.hidden = false;
  }

  async function openLegalEditor(key) {
    legalKey = key;
    document.getElementById("legalModalTitle").textContent = `Edit ${LEGAL_PAGE_TITLES[key]}`;
    clearFormError(legalForm);
    legalEditor.innerHTML = `
      <div class="skeleton-card" style="padding: 0 0 16px; border-top: none;">
        <span class="skeleton skeleton-text skeleton-text--medium"></span>
        <span class="skeleton skeleton-text"></span>
        <span class="skeleton skeleton-text skeleton-text--short"></span>
      </div>`;
    legalModal.hidden = false;
    legalSave.disabled = true;
    try {
      fillLegalForm(await setupRequest(`/api/site/legal/${encodeURIComponent(key)}/`, {
        fallback: "Could not load this page's text.",
      }));
      legalSave.disabled = false;
    } catch (err) {
      showFormError(legalForm, err.message);
    }
  }

  document.getElementById("legalAddSection").addEventListener("click", () => {
    readLegalEditor();
    legalSections.push({ anchor: "", heading: "", body: "" });
    renderLegalEditor();
  });

  legalEditor.addEventListener("click", async (e) => {
    const move = e.target.closest("[data-legal-move]");
    const remove = e.target.closest("[data-legal-remove]");
    if (!move && !remove) return;
    readLegalEditor();
    const index = Number(e.target.closest(".legal-section-row").dataset.index);
    if (remove) {
      if (!await siteConfirm("Remove this section from the page?")) return;
      legalSections.splice(index, 1);
    } else {
      const target = index + Number(move.dataset.legalMove);
      if (target < 0 || target >= legalSections.length) return;
      [legalSections[index], legalSections[target]] = [legalSections[target], legalSections[index]];
    }
    renderLegalEditor();
  });

  async function saveLegal() {
    clearFormError(legalForm);
    readLegalEditor();
    const sections = legalSections.filter((s) => s.heading.trim() || s.body.trim());
    legalSave.disabled = true;
    legalSave.textContent = "Saving...";
    try {
      fillLegalForm(await setupRequest(`/api/site/legal/${encodeURIComponent(legalKey)}/admin/`, {
        method: "PUT",
        json: { effective_date: legalEffectiveInput.value.trim(), sections },
        fallback: "Could not save this page.",
      }));
      return true;
    } catch (err) {
      showFormError(legalForm, err.message);
      return false;
    } finally {
      legalSave.disabled = false;
      legalSave.textContent = "Save Page";
    }
  }

  legalForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (await saveLegal()) legalModal.hidden = true;
  });

  document.getElementById("legalClose").addEventListener("click", requestCloseLegal);
  legalModal.addEventListener("click", (e) => {
    if (e.target === legalModal) requestCloseLegal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !legalModal.hidden && legalExitModal.hidden) requestCloseLegal();
  });
  document.getElementById("legalExitSave").addEventListener("click", async () => {
    if (!(await saveLegal())) return;
    legalExitModal.hidden = true;
    legalModal.hidden = true;
  });
  document.getElementById("legalExitDiscard").addEventListener("click", () => {
    legalExitModal.hidden = true;
    legalModal.hidden = true;
  });
  document.getElementById("legalExitStay").addEventListener("click", () => {
    legalExitModal.hidden = true;
  });

  // ================================= Load ==================================

  brandingSave.disabled = true;
  footerSave.disabled = true;
  const [brandingResult, profileResult] = await Promise.allSettled([getBranding(), getBarangayProfile()]);

  if (brandingResult.status === "fulfilled") {
    fillBrandingForm(brandingResult.value);
    brandingSave.disabled = false;
  } else {
    showFormError(brandingForm, brandingResult.reason.message);
  }
  if (profileResult.status === "fulfilled") {
    fillFooterForm(profileResult.value);
    footerSave.disabled = false;
  } else {
    showFormError(footerForm, profileResult.reason.message);
  }
});
