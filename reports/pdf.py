"""
"Download Summary (PDF)" on the Reports Dashboard (StaffReportDashboardPdfView).

The browser sends the numbers it already shows on the dashboard (stats and
the category / status / investigator breakdowns) as JSON. This module only
lays them out as tables in a PDF — it does not query the database.
"""

import io
from xml.sax.saxutils import escape

from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Table, TableStyle

NAVY = colors.HexColor("#16223f")
MUTED = colors.HexColor("#5b5748")
BORDER = colors.HexColor("#cde8d0")
MARGIN = 0.5 * inch

STAT_LABELS = [
    ("total", "Total Reports"),
    ("new", "New Submission"),
    ("process", "Under Review"),
    ("remarks", "In Action"),
    ("resolved", "Resolved"),
    ("withRemarks", "With Remarks"),
]

_styles = None


def _get_styles():
    global _styles
    if _styles is None:
        base = getSampleStyleSheet()
        _styles = {
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
    return _styles


def _table(headers, rows, col_widths):
    styles = _get_styles()
    data = [[Paragraph(h, styles["cell_header"]) for h in headers]]
    # Escaped because ordinance names are free text ("&" or "<" would break the PDF).
    data += [[Paragraph(escape(str(cell)), styles["cell"]) for cell in row] for row in rows]
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


def _section(story, title, period_label, headers, rows, col_widths, empty_message):
    styles = _get_styles()
    story.append(Paragraph(title, styles["section"]))
    if period_label:
        story.append(Paragraph(period_label, styles["section_meta"]))
    story.append(_table(headers, rows, col_widths) if rows else Paragraph(empty_message, styles["empty"]))


def _stats_rows(stats):
    """Overview rows: each count plus its change from the previous period."""
    current = stats.get("current") or {}
    previous = stats.get("previous")
    suffix = stats.get("delta_suffix") or ""
    rows = []
    for key, label in STAT_LABELS:
        value = current.get(key, 0)
        if previous is None:
            change = "—"
        else:
            before = previous.get(key, 0)
            if before == 0:
                pct = 0 if value == 0 else 100
            else:
                pct = round((value - before) / before * 100)
            arrow = "↑" if pct >= 0 else "↓"
            change = f"{arrow} {abs(pct)}% {suffix}".strip()
        rows.append([label, value, change])
    return rows


def build_dashboard_pdf(payload):
    """Dashboard JSON -> PDF bytes."""
    styles = _get_styles()
    generated = timezone.localtime(timezone.now()).strftime("%B %d, %Y, %I:%M %p")
    story = [
        Paragraph(f"Generated {generated}", styles["meta"]),
        Paragraph("Reports Summary &amp; Analytics", styles["title"]),
        Paragraph(f"Period: {escape(payload.get('top_period_label') or '—')}", styles["meta"]),
    ]

    _section(story, "Overview", None, ["Metric", "Count", "Change"],
             _stats_rows(payload.get("stats") or {}),
             [2.6 * inch, 1.3 * inch, 2.6 * inch], "No data for this period.")

    category = payload.get("category") or {}
    _section(story, "Reports by Category", category.get("period_label"), ["Category", "Count", "% of Period"],
             [[s["category"], s["count"], f"{s['pct']}%"] for s in category.get("slices") or []],
             [3.6 * inch, 1.4 * inch, 1.5 * inch], "No reports filed in this period.")

    status = payload.get("status") or {}
    status_stats = status.get("stats") or {}
    status_rows = (
        [[label, status_stats.get(key, 0)] for key, label in STAT_LABELS[1:]] if status_stats.get("total") else []
    )
    _section(story, "Reports by Status", status.get("period_label"), ["Status", "Count"], status_rows,
             [3.6 * inch, 2.9 * inch], "No reports filed in this period.")

    investigators = payload.get("investigators") or {}
    _section(story, "Investigator Performance", investigators.get("period_label"), ["Investigator", "Claimed Reports"],
             [[row["name"], row["count"]] for row in investigators.get("rows") or []],
             [3.6 * inch, 2.9 * inch], "No claimed reports for this period.")

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=letter, topMargin=MARGIN, bottomMargin=MARGIN, leftMargin=MARGIN, rightMargin=MARGIN,
        title="Reports Summary & Analytics",
    )
    doc.build(story)
    return buffer.getvalue()
