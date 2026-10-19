"""
Anti-abuse rules for File a Report (all checked in ReportListCreateView.create):

1. Identity check — a citizen's first report, and their first report after
   REVERIFY_AFTER_DAYS without one, needs a 6-digit emailed code first.
2. Cooldown — at most one report every COOLDOWN_HOURS.
3. Abuse lockout — filing ABUSE_MAX_REPORTS within ABUSE_WINDOW_HOURS
   disables the account (an Administrator must enable it again) and the
   citizen is emailed.
"""

from datetime import timedelta

from django.utils import timezone

from accounts.models import log_action
from orms_backend.emails import send_account_suspicious_activity_email

from .models import Report, ReportVerificationCode

REVERIFY_AFTER_DAYS = 30
COOLDOWN_HOURS = 2
ABUSE_WINDOW_HOURS = 12
ABUSE_MAX_REPORTS = 5


def _last_report(user):
    return Report.objects.filter(citizen=user).order_by("-created_at").first()


def verification_required(user):
    last_report = _last_report(user)
    if not last_report:
        return True
    return timezone.now() - last_report.created_at > timedelta(days=REVERIFY_AFTER_DAYS)


def has_valid_verification(user):
    cutoff = timezone.now() - timedelta(minutes=ReportVerificationCode.VERIFIED_GRACE_MINUTES)
    return ReportVerificationCode.objects.filter(user=user, verified_at__gte=cutoff).exists()


def cooldown_remaining(user):
    """How long until the citizen may file again (a timedelta), or None."""
    last_report = _last_report(user)
    if not last_report:
        return None
    elapsed = timezone.now() - last_report.created_at
    cooldown = timedelta(hours=COOLDOWN_HOURS)
    return cooldown - elapsed if elapsed < cooldown else None


def check_and_apply_abuse_lockout(user):
    """Called right after a report is created."""
    cutoff = timezone.now() - timedelta(hours=ABUSE_WINDOW_HOURS)
    recent_count = Report.objects.filter(citizen=user, created_at__gte=cutoff).count()
    if recent_count >= ABUSE_MAX_REPORTS and user.is_active:
        user.is_active = False
        user.save(update_fields=["is_active"])
        log_action(user, "Account disabled automatically — too many reports filed in a short time")
        send_account_suspicious_activity_email(user)
