"""
WSGI entry point for the stress test server:

    gunicorn stress_test.wsgi -w 4 --threads 2 -b 0.0.0.0:8000     (Linux/WSL)
    waitress-serve --threads=8 --listen=0.0.0.0:8000 stress_test.wsgi:application   (Windows)

With STRESS_REPORT_GATES=off (default), File Report's anti-abuse gates
(email verification, 2-hour cooldown, auto-lockout; see
reports/verification.py) are bypassed so each test citizen can submit
repeatedly and the write path itself can be measured. STRESS_REPORT_GATES=on
keeps them.
"""

import os

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "stress_test.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()

if os.environ.get("STRESS_REPORT_GATES", "off").lower() == "off":
    import reports.views as report_views

    report_views.cooldown_remaining = lambda user: None
    report_views.verification_required = lambda user: False
    report_views.check_and_apply_abuse_lockout = lambda user: None
