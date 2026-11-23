"""Hashes of the portal pages' inline scripts, for the Content-Security-Policy."""

import base64
import hashlib
import re
from pathlib import Path

_INLINE_SCRIPT = re.compile(r"<script\b(?![^>]*\bsrc\s*=)[^>]*>(.*?)</script>", re.IGNORECASE | re.DOTALL)


def inline_script_hashes(root):
    """CSP source values for every distinct inline script in the HTML under `root`."""
    hashes = set()
    for page in Path(root).rglob("*.html"):
        html = page.read_text(encoding="utf-8")
        for body in _INLINE_SCRIPT.findall(html):
            # Browsers hash the script after normalizing line endings to \\n.
            normalized = body.replace("\r\n", "\n").replace("\r", "\n")
            digest = hashlib.sha256(normalized.encode("utf-8")).digest()
            hashes.add(f"'sha256-{base64.b64encode(digest).decode()}'")
    return sorted(hashes)
