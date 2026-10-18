"""
Barangay Platero OVRMS — PDF builders. build_dashboard_pdf (further down)
backs the Captain's Reports Dashboard "Download Summary (PDF)" (see
StaffReportDashboardPdfView in reports/views.py).

build_report_pdf/build_reports_pdf are currently unused: their endpoints
(a single Resolved report's "Download PDF", open to every Staff role, and
the Reports page's bulk "Download Resolved Reports (PDF)") were removed in
favor of the per-report Download Report PDF (a picture of the filled-in
File a Report form, built in the browser) that only the citizen and the
Investigator get — see frontend/citizen/js/report-form-download.js.

Each report is meant to fit on one page, whether it's the only one in the
PDF or one of several (separated by a page break). reportlab's flowable
layout doesn't have a "shrink to fit" mode on its own, so each report's
content is built at a few decreasing size scales (fonts, spacing, image
thumbnails) and the first one that actually comes out to a single page is
kept — counted with pymupdf.
Margins are one fixed size throughout, since a single shared document can't
vary them per report the way the rest of the sizing can.
"""

import io
import os
import tempfile

import pymupdf
from django.utils import timezone
from orms_backend.encrypted_storage import EncryptedStorage, is_encrypted_name
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#16223f")
MUTED = colors.HexColor("#5b5748")
BORDER = colors.HexColor("#cde8d0")

_EVIDENCE_COLUMNS = 3
_MARGIN = 0.5 * inch
# Tried largest first — most reports (short remarks, a couple of photos)
# fit at 1.0 and never need to fall back to a smaller one. The lower end is
# fairly granular since a report with long remarks and several photos tends
# to sit right at the edge of fitting — a step too coarse there would skip
# straight past a scale that actually would have worked.
_SCALE_STEPS = [1.0, 0.85, 0.7, 0.58, 0.48, 0.4, 0.33, 0.27, 0.22]


def _looks_like_image(data):
    """Sniffs the actual bytes rather than trusting a filename/extension —
    Cloudinary strips extensions from the names it hands back, and an
    encrypted photo's on-disk name is a random `enc/....enc` either way, so
    there's often nothing usable to guess from."""
    try:
        with PILImage.open(io.BytesIO(data)) as img:
            img.verify()
        return True
    except Exception:
        return False


def _video_thumbnail(data):
    """The first frame of a video's bytes -> JPEG bytes, or None if that
    fails (including if `data` isn't actually a video at all) — this is
    also how a video gets told apart from some other, unsupported file
    type, since neither storage nor Cloudinary reliably preserves a usable
    extension to check instead (see _attachment_flowables)."""
    try:
        import cv2
    except ImportError:
        return None
    # The extension is just a hint for which demuxer to try first — ffmpeg
    # (which OpenCV's VideoCapture uses under the hood) sniffs the actual
    # container from the bytes regardless, so a fixed ".mp4" here is fine
    # even for a .mov/.webm upload.
    fd, path = tempfile.mkstemp(suffix=".mp4")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        capture = cv2.VideoCapture(path)
        try:
            ok, frame = capture.read()
        finally:
            capture.release()
        if not ok:
            return None
        ok, buf = cv2.imencode(".jpg", frame)
        return buf.tobytes() if ok else None
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def _attachment_bytes(attachment):
    """The raw bytes of one attachment, decrypting first if it's an
    encrypted photo (see orms_backend/encrypted_storage.py)."""
    name = attachment.file.name
    if is_encrypted_name(name):
        return EncryptedStorage().read(name)[1]
    with attachment.file.open("rb") as f:
        return f.read()


def _page_count(pdf_bytes):
    with pymupdf.open(stream=pdf_bytes, filetype="pdf") as doc:
        return doc.page_count


class _ReportPdfStyles:
    """Every size in the document, scaled down together so a denser report
    (longer remarks, more photos) still has a shot at fitting one page
    before giving up and just rendering at the smallest scale."""

    def __init__(self, scale):
        self.scale = scale
        self.evidence_max_width = max(1.0, (6.8 / _EVIDENCE_COLUMNS - 0.15) * max(scale, 0.45)) * inch
        self.evidence_max_height = max(0.75, 2.2 * scale) * inch

        base = getSampleStyleSheet()
        self.title = ParagraphStyle(
            "ReportTitle", parent=base["Title"], textColor=NAVY,
            fontSize=max(11, 18 * scale), spaceAfter=max(2, 4 * scale),
        )
        self.heading = ParagraphStyle(
            "ReportHeading", parent=base["Heading2"], textColor=NAVY,
            fontSize=max(8.5, 12 * scale), spaceBefore=max(4, 14 * scale), spaceAfter=max(2, 6 * scale),
        )
        self.label = ParagraphStyle(
            "ReportLabel", parent=base["Normal"], textColor=MUTED, fontSize=max(6, 8 * scale)
        )
        self.value = ParagraphStyle(
            "ReportValue", parent=base["Normal"], textColor=colors.black, fontSize=max(7, 10.5 * scale)
        )
        self.body = ParagraphStyle(
            "ReportBody", parent=base["Normal"], fontSize=max(7, 10.5 * scale), leading=max(9, 15 * scale)
        )
        self.caption = ParagraphStyle(
            "ReportCaption", parent=base["Normal"], textColor=MUTED,
            fontSize=max(5.5, 7.5 * scale), spaceAfter=max(2, 8 * scale),
        )
        self.row_padding = max(2, 8 * scale)

    def field_row(self, label, value):
        return [Paragraph(label.upper(), self.label), Paragraph(value or "—", self.value)]

    def field_table(self, rows):
        table = Table(rows, colWidths=[1.6 * inch, 4.9 * inch])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), self.row_padding),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER),
                ]
            )
        )
        return table


def _format_datetime(dt):
    return dt.strftime("%B %d, %Y, %I:%M %p") if dt else "—"


def _evidence_cell(attachment, styles):
    """One attachment -> (Image, Paragraph caption), or None if there's
    nothing showable (an unreadable file, or neither an image nor a video)."""
    name = attachment.file.name
    filename = name.rsplit("/", 1)[-1]
    try:
        data = _attachment_bytes(attachment)
    except (OSError, FileNotFoundError, ValueError):
        return [Paragraph(f"{filename} (could not be read)", styles.caption)]

    if _looks_like_image(data):
        image_bytes = data
        caption = _format_datetime(attachment.uploaded_at)
    else:
        image_bytes = _video_thumbnail(data)
        if image_bytes is None:
            return [Paragraph(filename, styles.caption)]
        caption = f"{_format_datetime(attachment.uploaded_at)} (video)"

    buffer = io.BytesIO(image_bytes)
    reader = ImageReader(buffer)
    img_width, img_height = reader.getSize()
    scale = min(styles.evidence_max_width / img_width, styles.evidence_max_height / img_height, 1)
    buffer.seek(0)
    return [
        Image(buffer, width=img_width * scale, height=img_height * scale),
        Paragraph(caption, styles.caption),
    ]


def _attachment_flowables(report, styles):
    flowables = []
    attachments = list(report.attachments.all())
    if not attachments:
        return flowables

    flowables.append(Paragraph("Evidence", styles.heading))
    cells = [_evidence_cell(attachment, styles) for attachment in attachments]

    rows = [cells[i : i + _EVIDENCE_COLUMNS] for i in range(0, len(cells), _EVIDENCE_COLUMNS)]
    for row in rows:
        row.extend([""] * (_EVIDENCE_COLUMNS - len(row)))  # pad the last row so the table stays rectangular
    col_width = 6.8 * inch / _EVIDENCE_COLUMNS
    grid = Table(rows, colWidths=[col_width] * _EVIDENCE_COLUMNS)
    grid.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), max(2, 10 * styles.scale)),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    flowables.append(grid)
    return flowables


def _report_story(report, scale):
    """One report's content, at a given size scale — no page/doc wrapping,
    so this can be used standalone (build_report_pdf) or concatenated with
    other reports' stories (build_reports_pdf)."""
    styles = _ReportPdfStyles(scale)

    reporter_name = report.citizen.get_full_name() or report.citizen.username
    investigator_name = (
        report.assigned_investigator.get_full_name() or report.assigned_investigator.username
        if report.assigned_investigator
        else "—"
    )
    incident_datetime = report.incident_date.strftime("%B %d, %Y")
    if report.incident_time:
        incident_datetime += f", {report.incident_time.strftime('%I:%M %p')}"

    story = [
        Paragraph("Barangay Platero OVRMS", styles.label),
        Paragraph("Ordinance Violation Report", styles.title),
        Spacer(1, max(3, 10 * scale)),
        styles.field_table(
            [
                styles.field_row("Status", report.get_status_display()),
                styles.field_row("Ordinance Violated", report.ordinance),
                styles.field_row("Date/Time of Incident", incident_datetime),
                styles.field_row("Location", report.location),
                styles.field_row("Date Submitted", _format_datetime(report.created_at)),
                styles.field_row("Date Resolved", _format_datetime(report.updated_at)),
            ]
        ),
        Paragraph("Reporter", styles.heading),
        styles.field_table(
            [
                styles.field_row("Name", reporter_name),
                styles.field_row("Contact Number", report.citizen.contact_number),
            ]
        ),
        Paragraph("Investigation", styles.heading),
        styles.field_table([styles.field_row("Assigned Investigator", investigator_name)]),
        Paragraph("Nature of Violation", styles.heading),
        Paragraph(report.nature_of_violation or "—", styles.body),
        Paragraph("Remarks / Resolution", styles.heading),
        Paragraph(report.remarks or "—", styles.body),
    ]
    story.extend(_attachment_flowables(report, styles))
    return story


def _build_doc(story):
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        title="Report",
    )
    doc.build(story)
    return buffer.getvalue()


def _best_fit_story(report):
    """The largest scale's story that fits this one report on a single
    page by itself — tried standalone (not as part of whatever other
    reports it'll actually share a document with), since that's the only
    way to count its own page count independently of them."""
    story = _report_story(report, _SCALE_STEPS[0])
    for scale in _SCALE_STEPS[1:]:
        # doc.build() drains the list it's given, so the fit-check runs
        # against a throwaway copy — checking the real `story` directly
        # would empty it before it's returned below.
        if _page_count(_build_doc(list(story))) <= 1:
            break
        story = _report_story(report, scale)
    return story


def build_report_pdf(report):
    """A Report (already Resolved) -> PDF bytes, rendered as large as
    possible while still fitting on one page."""
    return _build_doc(_best_fit_story(report))


def build_reports_pdf(reports):
    """Several Reports (already filtered to Resolved) -> one combined PDF,
    one page per report (see the Reports page's bulk download button)."""
    combined = []
    for i, report in enumerate(reports):
        if i > 0:
            combined.append(PageBreak())
        combined.extend(_best_fit_story(report))
    return _build_doc(combined)


# ---- Reports Dashboard summary/analytics PDF -------------------------
#
# Unlike the per-report PDFs above, this isn't built from a Report
# queryset at all — every number here (stats, category/status/investigator
# breakdowns, the filed-over-time trend, the open-reports list) is already
# computed client-side in reports-dashboard.js, the same way the dashboard
# itself renders, respecting the page's date-range filter and each graph's
# own override. This just lays out whatever JSON it's handed (see
# StaffReportDashboardPdfView) into a document — it doesn't need, and
# deliberately avoids, a second implementation of that filtering logic in
# Python. There's no one-page-fit requirement here (unlike the per-report
# PDFs) — a multi-section analytics summary spanning a few pages is normal.

_dash_styles_cache = None


def _dashboard_styles():
    global _dash_styles_cache
    if _dash_styles_cache is not None:
        return _dash_styles_cache
    base = getSampleStyleSheet()
    _dash_styles_cache = {
        "title": ParagraphStyle("DashTitle", parent=base["Title"], textColor=NAVY, fontSize=18, spaceAfter=2),
        "meta": ParagraphStyle("DashMeta", parent=base["Normal"], textColor=MUTED, fontSize=9.5, spaceAfter=10),
        "section": ParagraphStyle(
            "DashSection", parent=base["Heading2"], textColor=NAVY, fontSize=13, spaceBefore=18, spaceAfter=6
        ),
        "section_meta": ParagraphStyle(
            "DashSectionMeta", parent=base["Normal"], textColor=MUTED, fontSize=8.5, spaceAfter=8
        ),
        "empty": ParagraphStyle("DashEmpty", parent=base["Normal"], textColor=MUTED, fontSize=9.5, spaceAfter=6),
        "cell": ParagraphStyle("DashCell", parent=base["Normal"], fontSize=9.5, leading=12),
        "cell_header": ParagraphStyle(
            "DashCellHeader", parent=base["Normal"], fontSize=9, leading=11, textColor=colors.white
        ),
    }
    return _dash_styles_cache


def _dashboard_table(headers, rows, col_widths):
    styles = _dashboard_styles()
    data = [[Paragraph(h, styles["cell_header"]) for h in headers]]
    data += [[Paragraph(str(cell), styles["cell"]) for cell in row] for row in rows]
    table = Table(data, colWidths=col_widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def _dashboard_section(flowables, title, period_label, headers, rows, col_widths, empty_message):
    styles = _dashboard_styles()
    flowables.append(Paragraph(title, styles["section"]))
    if period_label:
        flowables.append(Paragraph(period_label, styles["section_meta"]))
    if rows:
        flowables.append(_dashboard_table(headers, rows, col_widths))
    else:
        flowables.append(Paragraph(empty_message, styles["empty"]))


def _dashboard_stats_rows(payload_stats):
    current = payload_stats.get("current") or {}
    previous = payload_stats.get("previous")
    suffix = payload_stats.get("delta_suffix") or ""
    labels = [
        ("total", "Total Reports"),
        ("new", "New Submission"),
        ("process", "Under Review"),
        ("remarks", "In Action"),
        ("resolved", "Resolved"),
        ("withRemarks", "With Remarks"),
    ]
    rows = []
    for key, label in labels:
        cur_value = current.get(key, 0)
        if previous is None:
            change = "—"
        else:
            prev_value = previous.get(key, 0)
            if prev_value == 0:
                pct = 0 if cur_value == 0 else 100
            else:
                pct = round((cur_value - prev_value) / prev_value * 100)
            arrow = "↑" if pct >= 0 else "↓"
            change = f"{arrow} {abs(pct)}% {suffix}".strip()
        rows.append([label, cur_value, change])
    return rows


def build_dashboard_pdf(payload):
    """The Reports Dashboard's current stats/graphs/open-reports list (see
    above) -> one PDF, as a set of summary tables."""
    styles = _dashboard_styles()
    generated = timezone.localtime(timezone.now()).strftime("%B %d, %Y, %I:%M %p")
    story = [
        Paragraph("Barangay Platero OVRMS", styles["meta"]),
        Paragraph("Reports Summary &amp; Analytics", styles["title"]),
        Paragraph(f"Generated {generated} · Period: {payload.get('top_period_label') or '—'}", styles["meta"]),
    ]

    _dashboard_section(
        story,
        "Overview",
        None,
        ["Metric", "Count", "Change"],
        _dashboard_stats_rows(payload.get("stats") or {}),
        [2.6 * inch, 1.3 * inch, 2.6 * inch],
        "No data for this period.",
    )

    category = payload.get("category") or {}
    _dashboard_section(
        story,
        "Reports by Category",
        category.get("period_label"),
        ["Category", "Count", "% of Period"],
        [[s["category"], s["count"], f"{s['pct']}%"] for s in category.get("slices") or []],
        [3.6 * inch, 1.4 * inch, 1.5 * inch],
        "No reports filed in this period.",
    )

    status = payload.get("status") or {}
    status_stats = status.get("stats") or {}
    status_rows = (
        [
            [label, status_stats.get(key, 0)]
            for key, label in [
                ("new", "New Submission"),
                ("process", "Under Review"),
                ("remarks", "In Action"),
                ("resolved", "Resolved"),
                ("withRemarks", "With Remarks"),
            ]
        ]
        if status_stats.get("total")
        else []
    )
    _dashboard_section(
        story,
        "Reports by Status",
        status.get("period_label"),
        ["Status", "Count"],
        status_rows,
        [3.6 * inch, 2.9 * inch],
        "No reports filed in this period.",
    )

    investigators = payload.get("investigators") or {}
    _dashboard_section(
        story,
        "Investigator Performance",
        investigators.get("period_label"),
        ["Investigator", "Claimed Reports"],
        [[row["name"], row["count"]] for row in investigators.get("rows") or []],
        [3.6 * inch, 2.9 * inch],
        "No claimed reports for this period.",
    )

    trend = payload.get("trend") or {}
    unit = trend.get("unit") or "period"
    _dashboard_section(
        story,
        "Reports Filed Over Time",
        trend.get("period_label"),
        [unit.capitalize(), "Reports Filed"],
        [[p["title"], p["count"]] for p in trend.get("points") or []],
        [4.6 * inch, 1.9 * inch],
        "No reports filed in this period.",
    )

    aging = payload.get("aging") or []
    _dashboard_section(
        story,
        "Report Timeline — Open Reports",
        "Every not-yet-resolved report, regardless of the date filters above — oldest first.",
        ["Ordinance", "Location", "Days Open", "Status", "Investigator"],
        [[r["ordinance"], r["location"], r["days"], r["status"], r["investigator"]] for r in aging],
        [1.9 * inch, 1.7 * inch, 0.8 * inch, 1.1 * inch, 1.0 * inch],
        "Nothing open — every report has been resolved.",
    )

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=_MARGIN,
        bottomMargin=_MARGIN,
        leftMargin=_MARGIN,
        rightMargin=_MARGIN,
        title="Reports Summary & Analytics",
    )
    doc.build(story)
    return buffer.getvalue()
