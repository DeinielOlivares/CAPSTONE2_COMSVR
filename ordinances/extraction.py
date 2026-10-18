"""
Best-effort field extraction from an uploaded ordinance PDF, used to prefill
the Upload Ordinance form. Runs entirely on the server with pip-only
dependencies (PyMuPDF for rendering, RapidOCR/ONNX for OCR) — no paid API and
no system binaries like Tesseract, so it deploys with a plain `pip install`.

Only page 1 is read: the ordinance number, title, author and date all sit on
it, and OCR costs several seconds per page — reading a whole 20-page ordinance
would blow past the WSGI worker timeout. Nothing here is authoritative; the
caller shows the results as suggestions and staff review them before saving.
"""

import re

# Below this many characters, page 1 is treated as a scan and OCR'd. Real
# text-layer PDFs (a rare case among scanned ordinances) skip OCR entirely.
MIN_TEXT_LAYER_CHARS = 200
# 110 rather than 150: measured on 32 real scans, extraction accuracy was
# identical, but peak memory during OCR dropped from ~490MB to ~370MB — which
# matters on a 512MB host.
OCR_DPI = 110
# The pixel count (and so OCR memory) follows the page's stated physical size,
# not just the DPI — a scan saved with bogus page dimensions renders huge and
# got the instance OOM-killed. Standard paper at OCR_DPI stays under this
# (legal is ~935x1540), so only oversized pages get rendered at a lower DPI.
MAX_OCR_SIDE_PX = 1700

_MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    # Filipino month names — barangay resolutions (Kautusang Barangay) are written in Tagalog.
    "enero": 1, "pebrero": 2, "marso": 3, "abril": 4, "mayo": 5, "hunyo": 6,
    "hulyo": 7, "agosto": 8, "setyembre": 9, "oktubre": 10, "nobyembre": 11, "disyembre": 12,
}
_MONTH_PATTERN = "|".join(sorted(_MONTHS, key=len, reverse=True))

# OCR frequently drops the spaces between words, so every pattern here allows
# \s* (not \s+) between tokens.
_DATE_DMY = re.compile(
    rf"(?P<day>\d{{1,2}})\s*(?:NG)?\s*(?P<month>{_MONTH_PATTERN})\s*[,.]?\s*(?:TAONG)?\s*(?P<year>(?:19|20)\d{{2}})",
    re.IGNORECASE,
)
_DATE_MDY = re.compile(
    rf"(?P<month>{_MONTH_PATTERN})\s*(?P<day>\d{{1,2}})\s*[,.]?\s*(?P<year>(?:19|20)\d{{2}})",
    re.IGNORECASE,
)

_CITY_NUMBER = re.compile(r"ORDINANCE\s*NO\.?\s*(\d{1,4})\s*[-–]\s*\(?\s*((?:19|20)\d{2})\s*\)?", re.IGNORECASE)
_BARANGAY_NUMBER = re.compile(
    r"KAUTUSAN\w*\s*BARANGAY\s*(?:BILANG|BLG\.?|NO\.?)\s*(\d{1,4})\s*[-–]\s*((?:19|20)\d{2})", re.IGNORECASE
)
# OCR reads the zeros in "05-2022" as the letter O, hence [\dO] in the digit groups.
_BARANGAY_ORDINANCE_NUMBER = re.compile(
    r"BARANGAY\s*ORDINANCE\s*NO\.?\s*([\dO]{1,4})\s*[-–]\s*((?:19|2[0O])[\dO]{2})", re.IGNORECASE
)
_BARANGAY_HEADING = re.compile(
    r"^\W*(KAPASYAHAN|KAUTUSAN\w*\s*BARANGAY|BARANGAY\s*RESOLUTION)\s*(?:BILANG|BLG\.?|NO\.?)?", re.IGNORECASE
)
_CITY_HEADING = re.compile(r"^\W*(?:CITY|MUNICIPAL|BARANGAY)?\s*ORDINANCE\s*NO", re.IGNORECASE)
_TITLE_START = re.compile(r"^\W*AN\s*ORDINANCE", re.IGNORECASE)

# Anchored to the line start so "Co-Authors:" doesn't count. The name may be on the next line.
_AUTHOR = re.compile(r"^\W*AUTHOR(?:ED\s*BY|S)?\s*[:;.]?\s*(.*)", re.IGNORECASE)
_BODY_START = re.compile(r"^\W*(WHEREAS|SAPAGKAT|SECTION\s*1)", re.IGNORECASE)
# Lines that end the title block.
_TITLE_STOP = re.compile(
    r"^\W*(AUTHOR|CO-?AUTHOR|WHEREAS|SAPAGKAT|SECTION|BE IT|ARTICLE|KUNG KAYA|PAGE\s*\d)", re.IGNORECASE
)
_MAX_TITLE_LINES = 6
_PAGE_FOOTER = re.compile(r"^\W*(?:Page\s*\d|(?:City\s*)?Ordinance\s*No\.?.*dated)", re.IGNORECASE)
# With no WHEREAS to anchor on, also drop the author/co-author roster that follows the title.
_NON_BODY_LINE = re.compile(r"^\W*(?:AUTHOR|CO-?AUTHOR|HON\b|Chairman)|" + _PAGE_FOOTER.pattern, re.IGNORECASE)

# Matched as whole words (see _guess_category). The title is checked before the
# body, and the first matching group wins, so order more specific topics first.
# Generic words that show up in nearly every title ("providing funds", "office")
# are deliberately left out.
_CATEGORY_KEYWORDS = [
    ("Health", ("health", "disease", "pcos", "dengue", "vaccination", "reproductive", "nutrition", "kalusugan", "rabies")),
    ("Environment and Sanitation", ("garbage", "waste", "rubbish", "sanitation", "environment", "environmental", "pollution", "littering", "rainwater", "basura")),
    ("Peace and Order", ("curfew", "liquor", "alcohol", "firecrackers", "crime", "cybercrime", "kapayapaan", "katahimikan", "police", "drone")),
    ("Traffic and Transportation", ("traffic", "parking", "tricycle", "vehicle", "vehicles", "transportation", "apprehension")),
    ("Public Safety", ("safety", "fire", "disaster", "emergency", "security", "seguridad")),
    ("Youth and Education", ("youth", "student", "students", "school", "education", "scholarship", "scholarships", "kabataan", "minors")),
    ("Social Welfare", ("senior", "pwd", "pwds", "persons with disabilities", "solo", "women", "children", "welfare", "livelihood", "honorarium", "subsidy")),
    ("Land Use and Housing", ("housing", "zoning", "squatters", "squatting", "building", "boundaries", "heritage")),
    ("Finance and Taxation", ("tax", "taxes", "budget", "appropriation", "revenue", "loans")),
    ("Local Governance", ("creating", "committee", "creation", "institutionalizing", "organizing", "reorganization")),
]

# Under gunicorn's 120s worker timeout, so a stuck OCR fails this one request
# instead of getting the whole worker killed. A normal page takes ~8s locally
# and ~20s on Render.
OCR_TIMEOUT_SECONDS = 90


def read_first_page(pdf_bytes):
    """Returns the text of page 1, as one string with a line per text row."""
    import pymupdf

    document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if len(document) == 0:
            return ""
        text_layer = document[0].get_text().strip()
        if len(text_layer) >= MIN_TEXT_LAYER_CHARS:
            return text_layer
    finally:
        document.close()
    return _ocr_in_child_process(pdf_bytes)


def _ocr_in_child_process(pdf_bytes):
    """
    OCR on page 1 peaks around 250-300MB, and the memory never goes back to the
    OS afterwards — the web worker sat ~80MB higher after one run, and repeated
    runs crept upward until a 512MB Render instance was OOM-killed (twice, on
    an ordinary 11in scan). Running it in a throwaway process means the model,
    the rendered page and all that scratch memory are handed back the moment
    it exits; the web worker never loads the model at all. Costs ~1s per
    request to reload the model.
    """
    import multiprocessing

    # fork on Linux (Render): starts instantly and shares the worker's
    # already-loaded pages instead of re-importing Django. Windows (local dev)
    # only has spawn.
    method = "fork" if "fork" in multiprocessing.get_all_start_methods() else "spawn"
    context = multiprocessing.get_context(method)
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_ocr_worker, args=(pdf_bytes, sender), daemon=True)
    process.start()
    sender.close()  # Only the child writes; closing ours lets recv() see EOF if it dies.
    try:
        if not receiver.poll(OCR_TIMEOUT_SECONDS):
            raise TimeoutError(f"OCR took longer than {OCR_TIMEOUT_SECONDS}s")
        try:
            outcome, payload = receiver.recv()
        except EOFError:
            # Killed without sending anything — most likely the OOM killer,
            # which _ocr_worker asks to pick it over the web worker.
            process.join(5)
            raise RuntimeError(f"OCR process died (exit code {process.exitcode})") from None
        if outcome == "error":
            raise RuntimeError(f"OCR failed: {payload}")
        return payload
    finally:
        receiver.close()
        if process.is_alive():
            process.kill()
        process.join(5)


def _ocr_worker(pdf_bytes, sender):
    """Runs in the child process: renders page 1, OCRs it, sends back ("ok", text) or ("error", message)."""
    try:
        # If memory still runs out, have the kernel kill this process rather
        # than the web worker, so the site stays up and only the prefill fails.
        # Linux-only; raising one's own score needs no privileges.
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("1000")
    except OSError:
        pass
    try:
        import numpy as np
        import pymupdf
        from rapidocr_onnxruntime import RapidOCR

        document = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            page = document[0]
            longest_side_inches = max(page.rect.width, page.rect.height) / 72
            # PyMuPDF only accepts a whole-number dpi.
            dpi = min(OCR_DPI, int(MAX_OCR_SIDE_PX / longest_side_inches))
            pixmap = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB)
        finally:
            document.close()
        image = np.frombuffer(pixmap.samples, dtype=np.uint8).reshape(pixmap.height, pixmap.width, 3)
        result, _ = RapidOCR()(image)
        sender.send(("ok", "\n".join(row[1] for row in (result or []))))
    except Exception as exc:
        sender.send(("error", repr(exc)))
    finally:
        sender.close()


def _split_squished_words(line):
    """
    OCR often glues words together ("INSTITUTIONALIZINGTHEPOLYCYSTIC"). Only
    tokens too long to be real words are re-split, so normal words and
    acronyms are left alone.
    """
    try:
        import wordninja
    except ImportError:
        return line

    def fix(match):
        token = match.group(0)
        if len(token) < 11:
            return token
        return " ".join(wordninja.split(token))

    return re.sub(r"[A-Za-z]+", fix, line)


def _tidy(text):
    """Collapses whitespace, and fixes missing spaces after periods/commas ("HON.ELMARIO" -> "HON. ELMARIO")."""
    text = re.sub(r"(?<=[A-Za-z]{2})\.(?=[A-Za-z])|(?<=[A-Za-z])\.(?=[A-Z][a-z]{2})", ". ", text)
    text = re.sub(r",(?=\S)", ", ", text)
    return re.sub(r"\s+", " ", text).strip()


_SMALL_WORDS = {"a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"}


def _title_case_if_shouting(text):
    """All-caps OCR output reads badly in a form field; anything already mixed-case is left as typed."""
    letters = [c for c in text if c.isalpha()]
    if not letters or sum(c.isupper() for c in letters) / len(letters) < 0.6:
        return text
    words = text.lower().split()
    text = " ".join(w if (i and w in _SMALL_WORDS) else w[:1].upper() + w[1:] for i, w in enumerate(words))
    # Short parenthesised acronyms ("(pcos)") were lowercased above — restore them.
    return re.sub(r"\(([A-Za-z]{2,6})\)", lambda m: f"({m.group(1).upper()})", text)


def _fix_title_spacing(text):
    """OCR glues text to parentheses ("(ICT)Council"); put the spaces back."""
    text = re.sub(r"\)(?=[A-Za-z0-9])", ") ", text)
    return re.sub(r"(?<=[A-Za-z])\(", " (", text)


def _fix_city_name(text):
    """OCR reads the ñ in Biñan as "fi" or drops it, and the word splitter then breaks it in two."""
    return re.sub(r"\bBi(?:ñ|fi|n)\s?an\b", "Biñan", text, flags=re.IGNORECASE)


def _find_number(text):
    match = _BARANGAY_NUMBER.search(text)
    if match:
        return f"Kautusang Barangay Blg. {match.group(1)}-{match.group(2)}"
    match = _CITY_NUMBER.search(text)
    if match:
        return f"No. {int(match.group(1))}-({match.group(2)})"
    match = _BARANGAY_ORDINANCE_NUMBER.search(text)
    if match:
        number, year = (g.upper().replace("O", "0") for g in match.groups())
        return f"Kautusang Barangay Blg. {number}-{year}"
    return ""


def _find_date(text):
    for pattern in (_DATE_DMY, _DATE_MDY):
        for match in pattern.finditer(text):
            month = _MONTHS[match.group("month").lower()]
            day = int(match.group("day"))
            year = int(match.group("year"))
            if 1 <= day <= 31:
                return f"{year:04d}-{month:02d}-{day:02d}"
    return ""


def _find_author(lines):
    for index, line in enumerate(lines):
        match = _AUTHOR.match(line)
        if not match:
            continue
        name = match.group(1).strip()
        if not name and index + 1 < len(lines):
            name = lines[index + 1]
        # "Hon. Alonzo Kyne S. Garcia, SK Federation President" -> keep just the name.
        name = re.sub(r"^\W*Councilor\s*", "", name.split(",")[0], flags=re.IGNORECASE)
        name = _tidy(name)
        shouted = _title_case_if_shouting(name)
        # OCR glues initials onto names ("JaysonA. Souza"); split at lower->upper transitions.
        name = shouted if shouted != name else _tidy(re.sub(r"(?<=[a-z])(?=[A-Z])", " ", name))
        name = re.sub(r"^(?:Hon|Kgg)\.?\s*", "", name, flags=re.IGNORECASE)
        return f"Hon. {name}" if name else ""
    return ""


def _find_title_and_body(lines):
    """
    The title is the run of lines right after the "ORDINANCE NO. ..." heading
    (or, for barangay resolutions, "KAPASYAHAN BLG. ..."), up to the author
    line / first WHEREAS. If page 1 has no such heading (a continuation page,
    or a header the OCR missed), an "AN ORDINANCE ..." line starts it instead.
    The body — used as the description — starts at the first WHEREAS.
    """
    heading_index = next(
        (i for i, line in enumerate(lines) if _CITY_HEADING.match(line) or _BARANGAY_HEADING.match(line)), None
    )
    # The word splitter below only knows English; it shreds Tagalog ("Kau tu sang").
    is_tagalog = (
        heading_index is not None
        and bool(_BARANGAY_HEADING.match(lines[heading_index]))
        and "RESOLUTION" not in lines[heading_index].upper()
    )
    if heading_index is not None:
        title_start = heading_index + 1
    else:
        title_start = next((i for i, line in enumerate(lines) if _TITLE_START.match(line)), None)
        if title_start is None:
            return "", ""

    title_lines = []
    for line in lines[title_start:]:
        if _TITLE_STOP.match(line) or len(title_lines) >= _MAX_TITLE_LINES:
            break
        title_lines.append(line)

    title = " ".join(title_lines)
    if not is_tagalog:
        title = _split_squished_words(title)
    title = _fix_city_name(_title_case_if_shouting(_tidy(_fix_title_spacing(title))))

    rest = lines[title_start + len(title_lines) :]
    body_start = next((i for i, line in enumerate(rest) if _BODY_START.match(line)), None)
    if body_start is None:
        body_start, skip = 0, _NON_BODY_LINE
    else:
        skip = _PAGE_FOOTER
    body_lines = [l for l in rest[body_start:] if not skip.match(l)]
    return title, _tidy(" ".join(body_lines))


def _guess_category(title, body):
    """Suggests a category from keywords, trusting the title over the body — the body of any ordinance cites health, land, etc. in passing."""
    for text in (title, body):
        words = set(re.findall(r"[a-z]+", text.lower()))
        padded = f" {' '.join(re.findall(r'[a-z]+', text.lower()))} "
        for category, keywords in _CATEGORY_KEYWORDS:
            if any((f" {keyword} " in padded) if " " in keyword else (keyword in words) for keyword in keywords):
                return category
    return ""


def parse_fields(text, max_description_chars=1500):
    """Pulls the form fields out of page-1 text. Any field it can't find comes back as ""."""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    title, body = _find_title_and_body(lines)
    return {
        "number": _find_number(text),
        "title": title,
        "author": _find_author(lines),
        "category": _guess_category(title, body[:600]),
        "date_approved": _find_date(text),
        "description": body[:max_description_chars].rstrip(),
    }


def extract_fields(pdf_bytes):
    return parse_fields(read_first_page(pdf_bytes))
