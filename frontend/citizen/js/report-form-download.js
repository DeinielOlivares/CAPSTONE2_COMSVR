// Barangay Platero OVRMS — Download Report: draws one report onto a canvas laid out
// like the barangay's printed report form (letterhead, numbered sections,
// bordered fields, status checkboxes, signature lines) and saves it as a
// PNG image. Shared by the citizen's My Report Detail page and the
// Investigator's Report Detail page (staff/report-detail.html loads it from
// here, same as pdf-preview.js) — those are the only two places it's
// offered. Drawn with the plain Canvas API, so there's nothing extra to load.
//
// downloadReportForm(data) takes:
//   { id, reporter, contactNumber, location, ordinance, incidentDate
//     ("YYYY-MM-DD"), incidentTime ("HH:MM[:SS]" or null),
//     natureOfViolation, status (display label, e.g. "With Remarks"),
//     remarks, investigator (name or null), dateFiled (Date),
//     attachments (urls) }

const REPORT_FORM_STATUSES = ["New Submission", "Under Review", "In Action", "Resolved", "With Remarks"];
// The citizen portal labels the first status "Submitted"; on the form it's
// the status's own name, same as the staff Status dropdown.
const REPORT_FORM_STATUS_ALIASES = { Submitted: "New Submission" };
const REPORT_FORM_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];
const REPORT_FORM_LOGOS = {
  left: "/citizen/drawables/logo-city-of-binan.png",
  right: "/citizen/drawables/logo-barangay-platero.png",
};

// A4 proportions at roughly 150 dpi.
const REPORT_FORM_WIDTH = 1240;
const REPORT_FORM_MIN_HEIGHT = 1754;
const REPORT_FORM_MARGIN = 80;
const REPORT_FORM_INK = "#1d1d1d";
const REPORT_FORM_MUTED = "#555555";
const REPORT_FORM_RULE = "#2b2b2b";
const REPORT_FORM_SECTION_FILL = "#1f3d2b";
const REPORT_FORM_SANS = '"Poppins", "Segoe UI", Arial, sans-serif';
const REPORT_FORM_SERIF = '"Times New Roman", Times, serif';

function reportFormLoadImage(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = url;
  });
}

function reportFormDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function reportFormTime(hhmm) {
  if (!hhmm) return "Not specified";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${period}`;
}

// Splits text into lines no wider than maxWidth, keeping the text's own
// line breaks and breaking a single over-long word if it has to.
function reportFormWrap(ctx, text, maxWidth) {
  const lines = [];
  String(text || "").split(/\r?\n/).forEach((paragraph) => {
    let line = "";
    paragraph.split(/\s+/).filter(Boolean).forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth) {
        line = candidate;
        return;
      }
      if (line) lines.push(line);
      line = word;
      while (ctx.measureText(line).width > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    });
    lines.push(line);
  });
  return lines.length ? lines : [""];
}

function reportFormDraw(ctx, data, images) {
  const W = REPORT_FORM_WIDTH;
  const M = REPORT_FORM_MARGIN;
  const innerW = W - M * 2;
  let y = M;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, ctx.canvas.height);
  ctx.textBaseline = "alphabetic";

  // ---- Letterhead ----
  const logoSize = 120;
  if (images.left) ctx.drawImage(images.left, M, y, logoSize, logoSize);
  if (images.right) ctx.drawImage(images.right, W - M - logoSize, y, logoSize, logoSize);
  ctx.fillStyle = REPORT_FORM_INK;
  ctx.textAlign = "center";
  ctx.font = `22px ${REPORT_FORM_SERIF}`;
  ctx.fillText("Republic of the Philippines", W / 2, y + 26);
  ctx.fillText("City of Biñan, Laguna", W / 2, y + 54);
  ctx.font = `bold 32px ${REPORT_FORM_SERIF}`;
  ctx.fillText("BARANGAY PLATERO", W / 2, y + 92);
  ctx.font = `italic 19px ${REPORT_FORM_SERIF}`;
  ctx.fillText("Ordinance Violation Reporting and Monitoring System", W / 2, y + 120);
  y += logoSize + 22;

  ctx.fillStyle = REPORT_FORM_RULE;
  ctx.fillRect(M, y, innerW, 4);
  ctx.fillRect(M, y + 8, innerW, 1.5);
  y += 58;

  ctx.font = `bold 34px ${REPORT_FORM_SERIF}`;
  ctx.fillStyle = REPORT_FORM_INK;
  ctx.fillText("ORDINANCE VIOLATION REPORT FORM", W / 2, y);
  y += 44;

  ctx.font = `18px ${REPORT_FORM_SANS}`;
  ctx.textAlign = "left";
  ctx.fillText(`Report No.: ${String(data.id || "").slice(0, 8).toUpperCase()}`, M, y);
  ctx.textAlign = "right";
  ctx.fillText(`Date Filed: ${reportFormDate(data.dateFiled)}`, W - M, y);
  ctx.textAlign = "left";
  y += 28;

  // ---- Building blocks ----
  const LABEL_FONT = `600 15px ${REPORT_FORM_SANS}`;
  const VALUE_FONT = `20px ${REPORT_FORM_SANS}`;
  const LINE_H = 29;
  const PAD = 14;

  function section(title) {
    y += 18;
    ctx.fillStyle = REPORT_FORM_SECTION_FILL;
    ctx.fillRect(M, y, innerW, 40);
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold 18px ${REPORT_FORM_SANS}`;
    ctx.fillText(title, M + PAD, y + 27);
    y += 40;
  }

  // One row of bordered cells: [{label, value, width (fraction), minLines}].
  function row(cells) {
    ctx.font = VALUE_FONT;
    const laid = cells.map((c) => {
      const w = innerW * c.width;
      const lines = reportFormWrap(ctx, c.value || "—", w - PAD * 2);
      while (lines.length < (c.minLines || 1)) lines.push("");
      return { ...c, w, lines };
    });
    const h = Math.max(...laid.map((c) => 40 + c.lines.length * LINE_H + PAD));
    let x = M;
    laid.forEach((c) => {
      ctx.strokeStyle = REPORT_FORM_RULE;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, c.w, h);
      ctx.fillStyle = REPORT_FORM_MUTED;
      ctx.font = LABEL_FONT;
      ctx.fillText(c.label.toUpperCase(), x + PAD, y + 26);
      ctx.fillStyle = REPORT_FORM_INK;
      ctx.font = VALUE_FONT;
      c.lines.forEach((line, i) => ctx.fillText(line, x + PAD, y + 58 + i * LINE_H));
      x += c.w;
    });
    y += h;
  }

  // ---- I. Reporter ----
  section("I. REPORTER INFORMATION");
  row([
    { label: "Name of Reporter", value: data.reporter, width: 0.6 },
    { label: "Contact Number", value: data.contactNumber, width: 0.4 },
  ]);

  // ---- II. Incident ----
  section("II. INCIDENT DETAILS");
  row([{ label: "Location of Incident", value: data.location, width: 1 }]);
  row([
    { label: "Date of Incident", value: data.incidentDate ? reportFormDate(new Date(`${data.incidentDate}T00:00:00`)) : "", width: 0.5 },
    { label: "Time of Incident", value: reportFormTime(data.incidentTime), width: 0.5 },
  ]);
  row([{ label: "Ordinance in Violation", value: data.ordinance, width: 1 }]);
  row([{ label: "Nature of Violation", value: data.natureOfViolation, width: 1, minLines: 4 }]);

  // Evidence: how many files, plus thumbnails of the photos that loaded.
  const attachments = data.attachments || [];
  const photos = images.evidence.filter(Boolean);
  const thumb = 150;
  const evidenceH = 40 + LINE_H + (photos.length ? thumb + PAD * 2 : PAD);
  ctx.strokeStyle = REPORT_FORM_RULE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(M, y, innerW, evidenceH);
  ctx.fillStyle = REPORT_FORM_MUTED;
  ctx.font = LABEL_FONT;
  ctx.fillText("EVIDENCE ATTACHED", M + PAD, y + 26);
  ctx.fillStyle = REPORT_FORM_INK;
  ctx.font = VALUE_FONT;
  ctx.fillText(
    attachments.length ? `${attachments.length} file${attachments.length === 1 ? "" : "s"} uploaded with this report` : "None",
    M + PAD,
    y + 58
  );
  photos.forEach((img, i) => {
    const bx = M + PAD + i * (thumb + PAD);
    const by = y + 40 + LINE_H + PAD;
    const scale = Math.min(thumb / img.width, thumb / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.fillStyle = "#f1f1f1";
    ctx.fillRect(bx, by, thumb, thumb);
    ctx.drawImage(img, bx + (thumb - dw) / 2, by + (thumb - dh) / 2, dw, dh);
    ctx.strokeRect(bx, by, thumb, thumb);
  });
  y += evidenceH;

  // ---- III. Action taken ----
  section("III. ACTION TAKEN (FOR BARANGAY USE)");
  const statusH = 96;
  ctx.strokeStyle = REPORT_FORM_RULE;
  ctx.strokeRect(M, y, innerW, statusH);
  ctx.fillStyle = REPORT_FORM_MUTED;
  ctx.font = LABEL_FONT;
  ctx.fillText("STATUS", M + PAD, y + 26);
  const boxSize = 22;
  const slot = (innerW - PAD * 2) / REPORT_FORM_STATUSES.length;
  REPORT_FORM_STATUSES.forEach((label, i) => {
    const bx = M + PAD + i * slot;
    const by = y + 48;
    ctx.strokeStyle = REPORT_FORM_INK;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, boxSize, boxSize);
    if (label === data.status) {
      ctx.beginPath();
      ctx.moveTo(bx + 4, by + 12);
      ctx.lineTo(bx + 9, by + 18);
      ctx.lineTo(bx + 19, by + 4);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    ctx.fillStyle = REPORT_FORM_INK;
    ctx.font = label === data.status ? `bold 19px ${REPORT_FORM_SANS}` : `19px ${REPORT_FORM_SANS}`;
    ctx.fillText(label, bx + boxSize + 10, by + 18);
  });
  ctx.lineWidth = 1.5;
  y += statusH;
  row([{ label: "Assigned Investigator", value: data.investigator || "Not yet claimed", width: 1 }]);
  row([{ label: "Remarks", value: data.remarks || "", width: 1, minLines: 3 }]);

  // ---- Signatures ----
  y += 90;
  const sigW = innerW * 0.42;
  [
    { x: M, name: data.reporter, caption: "Signature over Printed Name of Reporter" },
    { x: W - M - sigW, name: data.investigator, caption: "Signature over Printed Name of Investigator" },
  ].forEach((sig) => {
    ctx.textAlign = "center";
    ctx.fillStyle = REPORT_FORM_INK;
    ctx.font = `bold 19px ${REPORT_FORM_SANS}`;
    if (sig.name) ctx.fillText(sig.name.toUpperCase(), sig.x + sigW / 2, y - 10);
    ctx.fillRect(sig.x, y, sigW, 1.5);
    ctx.fillStyle = REPORT_FORM_MUTED;
    ctx.font = `15px ${REPORT_FORM_SANS}`;
    ctx.fillText(sig.caption, sig.x + sigW / 2, y + 24);
  });
  y += 70;

  ctx.textAlign = "center";
  ctx.fillStyle = REPORT_FORM_MUTED;
  ctx.font = `italic 14px ${REPORT_FORM_SANS}`;
  ctx.fillText(
    `System-generated copy from Barangay Platero OVRMS — downloaded ${reportFormDate(new Date())}, ${new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`,
    W / 2,
    y
  );
  ctx.textAlign = "left";
  return y + M;
}

async function downloadReportForm(data) {
  data = { ...data, status: REPORT_FORM_STATUS_ALIASES[data.status] || data.status };
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  const photoUrls = (data.attachments || [])
    .filter((url) => !REPORT_FORM_VIDEO_EXTENSIONS.some((ext) => url.toLowerCase().split("?")[0].endsWith(ext)))
    .slice(0, 5);
  const [left, right, ...evidence] = await Promise.all([
    reportFormLoadImage(REPORT_FORM_LOGOS.left),
    reportFormLoadImage(REPORT_FORM_LOGOS.right),
    ...photoUrls.map((url) => reportFormLoadImage(url)),
  ]);
  // Drawn once on a tall scratch canvas to find out how long the content
  // runs (long narratives/remarks wrap onto more lines), then again on a
  // canvas cut to that height — never shorter than one A4 page.
  async function render(images) {
    const scratch = document.createElement("canvas");
    scratch.width = REPORT_FORM_WIDTH;
    scratch.height = 6000;
    const usedHeight = reportFormDraw(scratch.getContext("2d"), data, images);

    const canvas = document.createElement("canvas");
    canvas.width = REPORT_FORM_WIDTH;
    canvas.height = Math.max(REPORT_FORM_MIN_HEIGHT, Math.ceil(usedHeight));
    reportFormDraw(canvas.getContext("2d"), data, images);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  let blob;
  try {
    blob = await render({ left, right, evidence });
  } catch {
    // A picture the browser won't let a canvas export (e.g. served from
    // another origin) — the form still downloads, just without the images.
    blob = await render({ left: null, right: null, evidence: [] });
  }
  if (!blob) throw new Error("Could not generate the report image.");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Report-${String(data.id || "").slice(0, 8).toUpperCase()}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
