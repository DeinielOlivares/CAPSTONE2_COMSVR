// image-picker.js — choosing a picture on Admin > About Us Setup (council
// photos, logos) and Admin > Website Setup (site logo): checks the file
// against the server's upload limits and shows a preview with warnings.
// Load before the page's own script.

// The server's upload limits, checked before uploading.
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

// Previews a chosen image; returns a function that clears it.
// `framed`: add the green ring, as About Us does for uploaded portraits.
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
