"""
Barangay Platero OVRMS — builds the "Download PDF" an Investigator (or any
Staff/Admin) gets from a Resolved report's detail page (see
StaffReportPdfView in reports/views.py). Only ever called on a report whose
status is already Resolved — the view enforces that before this runs.
"""

import io
import os
import tempfile

from orms_backend.encrypted_storage import EncryptedStorage, is_encrypted_name
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

NAVY = colors.HexColor("#16223f")
MUTED = colors.HexColor("#5b5748")
BORDER = colors.HexColor("#cde8d0")

_styles = getSampleStyleSheet()
_title_style = ParagraphStyle("ReportTitle", parent=_styles["Title"], textColor=NAVY, fontSize=18, spaceAfter=4)
_heading_style = ParagraphStyle(
    "ReportHeading", parent=_styles["Heading2"], textColor=NAVY, fontSize=12, spaceBefore=14, spaceAfter=6
)
_label_style = ParagraphStyle("ReportLabel", parent=_styles["Normal"], textColor=MUTED, fontSize=8)
_value_style = ParagraphStyle("ReportValue", parent=_styles["Normal"], textColor=colors.black, fontSize=10.5)
_body_style = ParagraphStyle("ReportBody", parent=_styles["Normal"], fontSize=10.5, leading=15)
_caption_style = ParagraphStyle("ReportCaption", parent=_styles["Normal"], textColor=MUTED, fontSize=8, spaceAfter=10)


def _field_row(label, value):
    return [
        Paragraph(label.upper(), _label_style),
        Paragraph(value or "—", _value_style),
    ]


def _field_table(rows):
    table = Table(rows, colWidths=[1.6 * inch, 4.9 * inch])
    table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("LINEBELOW", (0, 0), (-1, -1), 0.5, BORDER),
            ]
        )
    )
    return table


def _format_datetime(dt):
    return dt.strftime("%B %d, %Y, %I:%M %p") if dt else "—"


def _looks_like_image(data):
    """Sniffs the actual bytes rather than trusting a filename/extension —
    Cloudinary strips extensions from the names it hands back (see below),
    and an encrypted photo's on-disk name is a random `enc/....enc` either
    way, so there's often nothing usable to guess from."""
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
    extension to check instead (see Report.pdf's caller)."""
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


def _attachment_flowables(report):
    flowables = []
    attachments = list(report.attachments.all())
    if not attachments:
        return flowables

    flowables.append(Paragraph("Evidence", _heading_style))
    max_width = 6.5 * inch
    max_height = 3.5 * inch

    for attachment in attachments:
        name = attachment.file.name
        filename = name.rsplit("/", 1)[-1]
        try:
            data = _attachment_bytes(attachment)
        except (OSError, FileNotFoundError, ValueError):
            flowables.append(Paragraph(f"• {filename} (could not be read)", _caption_style))
            continue

        if _looks_like_image(data):
            image_bytes = data
            caption = _format_datetime(attachment.uploaded_at)
        else:
            image_bytes = _video_thumbnail(data)
            if image_bytes is None:
                # Not a readable image and not a readable video either —
                # nothing to show inline, just note it was uploaded.
                flowables.append(Paragraph(f"• {filename}", _caption_style))
                continue
            caption = f"{_format_datetime(attachment.uploaded_at)} — video, first frame shown"

        buffer = io.BytesIO(image_bytes)
        reader = ImageReader(buffer)
        img_width, img_height = reader.getSize()
        scale = min(max_width / img_width, max_height / img_height, 1)
        buffer.seek(0)
        flowables.append(Image(buffer, width=img_width * scale, height=img_height * scale))
        flowables.append(Paragraph(caption, _caption_style))

    return flowables


def build_report_pdf(report):
    """A Report (already Resolved) -> PDF bytes."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.7 * inch,
        bottomMargin=0.7 * inch,
        leftMargin=0.8 * inch,
        rightMargin=0.8 * inch,
        title=f"Report {report.id}",
    )

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
        Paragraph("Barangay Platero OVRMS", _label_style),
        Paragraph("Ordinance Violation Report", _title_style),
        Spacer(1, 10),
        _field_table(
            [
                _field_row("Status", report.get_status_display()),
                _field_row("Ordinance Violated", report.ordinance),
                _field_row("Date/Time of Incident", incident_datetime),
                _field_row("Location", report.location),
                _field_row("Date Submitted", _format_datetime(report.created_at)),
                _field_row("Date Resolved", _format_datetime(report.updated_at)),
            ]
        ),
        Paragraph("Reporter", _heading_style),
        _field_table(
            [
                _field_row("Name", reporter_name),
                _field_row("Contact Number", report.citizen.contact_number),
            ]
        ),
        Paragraph("Investigation", _heading_style),
        _field_table([_field_row("Assigned Investigator", investigator_name)]),
        Paragraph("Nature of Violation", _heading_style),
        Paragraph(report.nature_of_violation or "—", _body_style),
        Paragraph("Remarks / Resolution", _heading_style),
        Paragraph(report.remarks or "—", _body_style),
    ]
    story.extend(_attachment_flowables(report))

    doc.build(story)
    return buffer.getvalue()
