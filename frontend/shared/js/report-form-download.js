// report-form-download.js — "Download Report": draws a report as the filled-in
// File a Report form (Reporting As, Report Details, photos, consent line) on a
// canvas and saves it as a one-page PDF named after the report number
// (e.g. "20260101-5.pdf"). Used by the citizen's My Report detail page and the
// staff Report detail page. Needs no extra library.
//
// downloadReportForm(data) takes:
//   { id, reportNumber ("YYYYMMDD-N"), reporter, contactNumber, location
//     ("Block/Lot, Street"), ordinance, incidentDate
//     ("YYYY-MM-DD"), incidentTime ("HH:MM[:SS]" or null),
//     natureOfViolation, dateFiled (Date), attachments (urls) }

const REPORT_FORM_VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm"];

// Laid out in CSS pixels at A4 width (794px = 210mm at 96dpi), matching the
// citizen stylesheet's sizes, then drawn REPORT_FORM_SCALE times larger so
// the PDF stays sharp when printed.
const REPORT_FORM_PAGE_W = 794;
const REPORT_FORM_PAGE_MIN_H = 1123; // A4 height at the same 96dpi
const REPORT_FORM_SCALE = 2.5;
const REPORT_FORM_MARGIN = 37;
const REPORT_FORM_FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Same palette as /citizen/css/style.css's :root.
const REPORT_FORM_COLORS = {
  page: "#f7fdf8",
  card: "#ffffff",
  cream: "#e3f7e5",
  navy: "#057a12",
  text: "#2b2a27",
  muted: "#5e665c",
  border: "#cde8d0",
  placeholder: "#8a8a8a",
};

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

// A video's first frame, as a canvas, or null if it won't load in time.
function reportFormLoadVideoFrame(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.muted = true;
    video.preload = "auto";
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.1, video.duration || 0);
    };
    video.onseeked = () => {
      try {
        const frame = document.createElement("canvas");
        frame.width = video.videoWidth;
        frame.height = video.videoHeight;
        frame.getContext("2d").drawImage(video, 0, 0);
        finish(frame.width && frame.height ? frame : null);
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    video.src = url;
  });
}

function reportFormIsVideo(url) {
  const path = String(url).toLowerCase().split("?")[0];
  return REPORT_FORM_VIDEO_EXTENSIONS.some((ext) => path.endsWith(ext));
}

// "Block/Lot, Street" back into its two form fields — File a Report joins
// them with ", " (see file-report.js), and a street name has no comma.
function reportFormSplitLocation(location) {
  const text = String(location || "");
  const cut = text.lastIndexOf(", ");
  return cut === -1 ? { street: text, blockLot: "" } : { street: text.slice(cut + 2), blockLot: text.slice(0, cut) };
}

// How the browser's own date/time inputs show a filled-in value.
function reportFormInputDate(yyyyMmDd) {
  const [y, m, d] = String(yyyyMmDd || "").split("-");
  return y && m && d ? `${m}/${d}/${y}` : "";
}

function reportFormInputTime(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(h % 12 || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function reportFormLongDate(date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// The report number, or (for a report somehow without one) its filing
// date plus the start of its id — still unique, still dated.
function reportFormNumber(data) {
  if (data.reportNumber) return data.reportNumber;
  const d = data.dateFiled instanceof Date && !isNaN(data.dateFiled) ? data.dateFiled : new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `${ymd}-${String(data.id || "").slice(0, 8).toUpperCase()}`;
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

function reportFormRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A checked box in the browser's accent-color style (accent = --navy).
function reportFormCheckbox(ctx, x, y, checked) {
  const size = 13;
  reportFormRoundRect(ctx, x, y, size, size, 2.5);
  if (checked) {
    ctx.fillStyle = REPORT_FORM_COLORS.navy;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x + 3, y + 6.8);
    ctx.lineTo(x + 5.6, y + 9.4);
    ctx.lineTo(x + 10.2, y + 3.8);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#767676";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Draws the whole form and returns the layout it ended up with:
// { reportingH, detailsH, height }. The cards' backgrounds need their
// heights before anything goes on top, so this runs twice — once to
// measure (layout = null), once for real with the measured layout.
function reportFormDraw(ctx, data, media, layout) {
  const C = REPORT_FORM_COLORS;
  const W = REPORT_FORM_PAGE_W;
  const M = REPORT_FORM_MARGIN;
  const cardW = W - M * 2;
  const font = (weight, size) => `${weight} ${size}px ${REPORT_FORM_FONT}`;
  const setSpacing = (px) => {
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
  };

  if (layout) {
    ctx.fillStyle = C.page;
    ctx.fillRect(0, 0, W, layout.height);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  function card(y, h, { cream } = {}) {
    if (!layout) return;
    ctx.save();
    ctx.shadowColor = "rgba(5, 122, 18, 0.15)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 6;
    reportFormRoundRect(ctx, M, y, cardW, h, 10);
    ctx.fillStyle = cream ? C.cream : C.card;
    ctx.fill();
    ctx.restore();
    if (cream) {
      ctx.save();
      reportFormRoundRect(ctx, M, y, cardW, h, 10);
      ctx.clip();
      ctx.fillStyle = C.navy;
      ctx.fillRect(M, y, 4, h);
      ctx.restore();
    }
  }

  function label(x, y, text, hint) {
    ctx.fillStyle = C.text;
    ctx.font = font(600, 13.12);
    ctx.fillText(text, x, y + 13);
    if (hint) {
      const w = ctx.measureText(`${text} `).width;
      ctx.fillStyle = C.muted;
      ctx.font = font(400, 12.48);
      ctx.fillText(hint, x + w, y + 13);
    }
    return y + 13 + 6 + 3;
  }

  // A single-line input box; `icon` draws the date/time inputs' glyph.
  function input(x, y, w, value, { placeholder, icon, height = 43 } = {}) {
    reportFormRoundRect(ctx, x + 0.5, y + 0.5, w - 1, height - 1, 6);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.font = font(400, 14.4);
    ctx.fillStyle = value ? C.text : C.placeholder;
    ctx.fillText(value || placeholder || "", x + 14, y + height / 2 + 5);
    if (icon) {
      const cx = x + w - 22;
      const cy = y + height / 2;
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 1.4;
      if (icon === "date") {
        ctx.strokeRect(cx - 6, cy - 5.5, 12, 11);
        ctx.fillStyle = C.text;
        ctx.fillRect(cx - 6, cy - 5.5, 12, 3);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
        ctx.moveTo(cx, cy - 3.5);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx + 2.8, cy + 1.6);
        ctx.stroke();
      }
    }
    return y + height;
  }

  let y = M - 6;

  // Which report this is, above the form itself.
  ctx.font = font(700, 13);
  ctx.fillStyle = C.text;
  ctx.fillText(`Report No. ${reportFormNumber(data)}`, M, y + 13);
  ctx.textAlign = "right";
  ctx.font = font(400, 12.5);
  ctx.fillStyle = C.muted;
  const filed = data.dateFiled instanceof Date && !isNaN(data.dateFiled) ? data.dateFiled : null;
  if (filed) {
    ctx.fillText(
      `Date Filed: ${reportFormLongDate(filed)}, ${filed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
      W - M,
      y + 13
    );
  }
  ctx.textAlign = "left";
  y += 30;

  // ---- Reporting As ----
  const reportingTop = y;
  card(reportingTop, layout ? layout.reportingH : 0, { cream: true });
  const rx = M + 36;
  const rw = cardW - 72;
  y += 22;
  ctx.font = font(700, 14.08);
  setSpacing(0.6);
  ctx.fillStyle = C.text;
  ctx.fillText("REPORTING AS", rx, y + 14);
  setSpacing(0);
  y += 14 + 4 + 12;
  const colW = (rw - 16) / 2;
  let fieldY = label(rx, y, "Name");
  label(rx + colW + 16, y, "Contact Number");
  fieldY = input(rx, fieldY, colW, data.reporter);
  input(rx + colW + 16, fieldY - 43, colW, data.contactNumber);
  y = fieldY + 16 + 8;
  const reportingH = y - reportingTop;
  y += 22;

  // ---- Report Details ----
  const detailsTop = y;
  card(detailsTop, layout ? layout.detailsH : 0);
  const dx = M + 36;
  const dw = cardW - 72;
  y += 32;
  ctx.font = font(700, 16.32);
  setSpacing(0.6);
  ctx.textAlign = "center";
  ctx.fillStyle = C.text;
  ctx.fillText("REPORT DETAILS", W / 2, y + 16);
  ctx.textAlign = "left";
  setSpacing(0);
  y += 16 + 26;

  const { street, blockLot } = reportFormSplitLocation(data.location);

  y = label(dx, y, "Street");
  y = input(dx, y, dw, street, { placeholder: "Type to search streets..." });
  y += 16;

  // Block, Lot, etc.
  y = label(dx, y, "Block, Lot, etc.");
  y = input(dx, y, dw, blockLot, { placeholder: "e.g. Block 1, Lot 2" });
  y += 16;

  // Date | Time
  const half = (dw - 16) / 2;
  label(dx, y, "Date of Incident");
  const rowY = label(dx + half + 16, y, "Time of Incident", "(optional)");
  input(dx, rowY, half, reportFormInputDate(data.incidentDate), { placeholder: "mm/dd/yyyy", icon: "date" });
  y = input(dx + half + 16, rowY, half, reportFormInputTime(data.incidentTime), { placeholder: "--:-- --", icon: "time" });
  y += 16;

  // Ordinance in Violation — the custom dropdown's trigger, text wrapped.
  const lineH = 20.5;
  y = label(dx, y, "Ordinance in Violation");
  ctx.font = font(400, 14.4);
  const ordLines = reportFormWrap(ctx, data.ordinance || "Select", dw - 54);
  const ordH = Math.max(48, ordLines.length * lineH + 27);
  input(dx, y, dw, "", { height: ordH });
  ctx.font = font(400, 14.4);
  ctx.fillStyle = data.ordinance ? C.text : C.placeholder;
  ordLines.forEach((line, i) => ctx.fillText(line, dx + 14, y + 13 + 14.5 + i * lineH));
  ctx.fillStyle = C.text;
  ctx.font = font(400, 11);
  ctx.fillText("▾", dx + dw - 24, y + ordH / 2 + 4);
  y += ordH + 16;

  // Nature of Violation — grows to fit, never cut off.
  y = label(dx, y, "Nature of Violation");
  ctx.font = font(400, 14.4);
  const natureLines = reportFormWrap(ctx, data.natureOfViolation, dw - 28);
  const natureH = Math.max(90, natureLines.length * lineH + 22);
  input(dx, y, dw, "", { height: natureH });
  ctx.font = font(400, 14.4);
  ctx.fillStyle = C.text;
  natureLines.forEach((line, i) => ctx.fillText(line, dx + 14, y + 11 + 14.5 + i * lineH));
  y += natureH + 16;

  // Evidence: the upload box with whatever was uploaded — left out entirely
  // when nothing was.
  const tiles = media.evidence;
  if (tiles.length) {
    const thumb = 116;
    const gap = 12;
    const perRow = Math.max(1, Math.floor((dw - 32 + gap) / (thumb + gap)));
    const rows = Math.ceil(tiles.length / perRow);
    const boxH = 16 + 22 + rows * thumb + (rows - 1) * gap + 18;
    ctx.save();
    ctx.setLineDash([6, 4]);
    reportFormRoundRect(ctx, dx + 1, y + 1, dw - 2, boxH - 2, 8);
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.textAlign = "center";
    ctx.font = font(600, 13.6);
    ctx.fillStyle = C.text;
    ctx.fillText(`Uploaded photos/videos (${tiles.length})`, W / 2, y + 16 + 13);
    const rowWidth = (n) => n * thumb + (n - 1) * gap;
    tiles.forEach((tile, i) => {
      const r = Math.floor(i / perRow);
      const inRow = Math.min(perRow, tiles.length - r * perRow);
      const bx = W / 2 - rowWidth(inRow) / 2 + (i % perRow) * (thumb + gap);
      const by = y + 16 + 22 + r * (thumb + gap);
      ctx.save();
      reportFormRoundRect(ctx, bx, by, thumb, thumb, 6);
      ctx.clip();
      ctx.fillStyle = tile.isVideo ? "#1d1d1d" : "#eef4ef";
      ctx.fillRect(bx, by, thumb, thumb);
      if (tile.picture) {
        // Cover-crop to a square, the same way the page's thumbnails do.
        const pw = tile.picture.width;
        const ph = tile.picture.height;
        const side = Math.min(pw, ph);
        ctx.drawImage(tile.picture, (pw - side) / 2, (ph - side) / 2, side, side, bx, by, thumb, thumb);
      }
      ctx.restore();
      if (tile.isVideo) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        ctx.beginPath();
        ctx.moveTo(bx + thumb / 2 - 9, by + thumb / 2 - 12);
        ctx.lineTo(bx + thumb / 2 + 13, by + thumb / 2);
        ctx.lineTo(bx + thumb / 2 - 9, by + thumb / 2 + 12);
        ctx.closePath();
        ctx.fill();
      } else if (!tile.picture) {
        ctx.font = font(400, 11);
        ctx.fillStyle = C.muted;
        ctx.fillText("Photo", bx + thumb / 2, by + thumb / 2 + 4);
      }
      reportFormRoundRect(ctx, bx + 0.5, by + 0.5, thumb - 1, thumb - 1, 6);
      ctx.strokeStyle = C.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    ctx.textAlign = "left";
    y += boxH + 16;
  }

  // Consent line — required to submit, so it was ticked.
  y += 6;
  ctx.font = font(400, 12.8);
  const consent = "I understand that a penalty will occur if I submit a false report.";
  const consentW = 13 + 8 + ctx.measureText(consent).width;
  const cx = W / 2 - consentW / 2;
  reportFormCheckbox(ctx, cx, y, true);
  ctx.fillStyle = C.text;
  ctx.fillText(consent, cx + 13 + 8, y + 11);
  y += 13 + 30;
  const detailsH = y - detailsTop;

  return { reportingH, detailsH, height: Math.max(REPORT_FORM_PAGE_MIN_H, Math.ceil(y + M)) };
}

// One-page PDF holding a single JPEG, scaled to the page — the smallest
// valid PDF there is, built by hand (DCTDecode = the JPEG bytes as-is).
function reportFormBuildPdf(jpegBytes, pixelW, pixelH, pageW, pageH, title) {
  const encoder = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  const w = pageW.toFixed(2);
  const h = pageH.toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
  const safeTitle = String(title).replace(/[^\x20-\x7e]/g, "").replace(/[\\()]/g, "\\$&");

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`
  );
  push(jpegBytes);
  push("\nendstream\nendobj\n");
  object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  object(6, `<< /Title (${safeTitle}) /Producer (Barangay Platero OVRMS) >>`);

  const xrefAt = length;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let n = 1; n <= 6; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(`${xref}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

async function downloadReportForm(data) {
  if (document.fonts && document.fonts.ready) await document.fonts.ready;

  // At most 5 files can be uploaded with a report (see file-report.html).
  const urls = (data.attachments || []).slice(0, 5);
  const evidence = await Promise.all(
    urls.map(async (url) => {
      const isVideo = reportFormIsVideo(url);
      const picture = isVideo ? await reportFormLoadVideoFrame(url) : await reportFormLoadImage(url);
      return { isVideo, picture };
    })
  );

  function render(media) {
    const scratch = document.createElement("canvas").getContext("2d");
    const layout = reportFormDraw(scratch, data, media, null);
    // Very long narratives make a very tall page — scaled down a little if
    // needed so the canvas stays within what browsers can draw.
    const scale = Math.min(REPORT_FORM_SCALE, 14000 / layout.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(REPORT_FORM_PAGE_W * scale);
    canvas.height = Math.round(layout.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    reportFormDraw(ctx, data, media, layout);
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => resolve(blob && { blob, canvas, layout }), "image/jpeg", 0.92);
      } catch (err) {
        reject(err);
      }
    });
  }

  let rendered;
  try {
    rendered = await render({ evidence });
  } catch {
    // A picture the browser won't let a canvas export (e.g. served from
    // another origin) — the form still downloads, just with plain tiles.
    rendered = await render({ evidence: evidence.map((e) => ({ isVideo: e.isVideo, picture: null })) });
  }
  if (!rendered) throw new Error("Could not prepare the report for download. Please try again.");

  const number = reportFormNumber(data);
  const jpeg = new Uint8Array(await rendered.blob.arrayBuffer());
  // PDF points (1/72 in): A4 is 595.28pt wide; height keeps the drawing's proportions.
  const pageW = 595.28;
  const pageH = (pageW * rendered.layout.height) / REPORT_FORM_PAGE_W;
  const pdf = reportFormBuildPdf(jpeg, rendered.canvas.width, rendered.canvas.height, pageW, pageH, `Report ${number}`);

  const link = document.createElement("a");
  link.href = URL.createObjectURL(pdf);
  link.download = `${number}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
