"""
Barangay Platero OVRMS — File Report anti-abuse rules: identity verification, a cooldown
between submissions, and an automatic lockout for rapid-fire filing.

Three independent checks, all enforced in ReportListCreateView.create():

  1. Identity verification (verification_required / has_valid_verification):
     required on a citizen's first-ever report, and again if it's been more
     than REVERIFY_AFTER_DAYS since their last one — a dormant account
     suddenly filing again is exactly the case a hijacked/shared account
     looks like. Cleared by ReportVerifyCodeView, consumed (deleted) once
     the gated report actually goes through.
  2. Cooldown (cooldown_remaining): a citizen can't file back-to-back
     reports faster than COOLDOWN_HOURS apart.
  3. Abuse lockout (check_and_apply_abuse_lockout): filing
     ABUSE_MAX_REPORTS within ABUSE_WINDOW_HOURS disables the account
     automatically (is_active=False, same flag Manage Accounts' Disable
     User button controls) and emails the citizen to reset their password —
     an admin has to manually re-enable the account from there afterward.
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


def verification_required(user):
    last_report = Report.objects.filter(citizen=user).order_by("-created_at").first()
    if not last_report:
        return True
    return timezone.now() - last_report.created_at > timedelta(days=REVERIFY_AFTER_DAYS)


def has_valid_verification(user):
    cutoff = timezone.now() - timedelta(minutes=ReportVerificationCode.VERIFIED_GRACE_MINUTES)
    return ReportVerificationCode.objects.filter(user=user, verified_at__gte=cutoff).exists()


def cooldown_remaining(user):
    """A timedelta if the citizen is still in cooldown, else None."""
    last_report = Report.objects.filter(citizen=user).order_by("-created_at").first()
    if not last_report:
        return None
    elapsed = timezone.now() - last_report.created_at
    cooldown = timedelta(hours=COOLDOWN_HOURS)
    if elapsed < cooldown:
        return cooldown - elapsed
    return None


def check_and_apply_abuse_lockout(user):
    """Call right after a report is successfully created."""
    cutoff = timezone.now() - timedelta(hours=ABUSE_WINDOW_HOURS)
    recent_count = Report.objects.filter(citizen=user, created_at__gte=cutoff).count()
    if recent_count >= ABUSE_MAX_REPORTS and user.is_active:
        user.is_active = False
        user.save(update_fields=["is_active"])
        log_action(user, "Account disabled automatically — too many reports filed in a short time")
        send_account_suspicious_activity_email(user)
