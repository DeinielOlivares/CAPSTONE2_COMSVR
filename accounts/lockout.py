"""
Barangay Platero OVRMS — failed-login lockout. Guessing a password gets an account locked
for a while after MAX_FAILED_LOGINS wrong attempts, and the owner is emailed so
they know someone has been trying.

Enforced in CustomTokenObtainPairSerializer.validate(). The lock is temporary
(LOCKOUT_MINUTES) rather than an is_active=False disable that needs an admin to
undo — otherwise anyone who knows an email could lock that person out
indefinitely, including the Administrator. The owner can also clear it sooner
by completing Forgot Password (see PasswordResetConfirmSerializer), since that
proves they control the email.

This protects one account from guessing. It does not stop one attacker trying
a few passwords each across many accounts — that needs per-IP throttling.
"""

import math
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from orms_backend.emails import send_account_locked_email

from .models import User, log_action

MAX_FAILED_LOGINS = 10
LOCKOUT_MINUTES = 30
# Failures only add up if they're close together — otherwise a few typos spread
# over months would eventually trip the lock on an honest user.
FAILURE_WINDOW_MINUTES = 60


def lockout_minutes_remaining(user):
    """Whole minutes (rounded up) left on an active lock, or 0 if the account isn't locked."""
    if not user.locked_until:
        return 0
    seconds = (user.locked_until - timezone.now()).total_seconds()
    return max(0, math.ceil(seconds / 60))


def record_failed_login(user):
    """
    Counts one wrong password. Returns True if this attempt tripped the lock.
    The row is locked for the read-modify-write so a burst of parallel guesses
    can't all read the same count and slip under the limit.
    """
    now = timezone.now()
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        stale = user.last_failed_login_at is None or now - user.last_failed_login_at > timedelta(
            minutes=FAILURE_WINDOW_MINUTES
        )
        user.failed_login_count = 1 if stale else user.failed_login_count + 1
        user.last_failed_login_at = now

        tripped = user.failed_login_count >= MAX_FAILED_LOGINS
        if tripped:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_login_count = 0
        # update_fields keeps updated_at untouched — it drives "last active" on Manage Accounts.
        user.save(update_fields=["failed_login_count", "last_failed_login_at", "locked_until"])

    if tripped:
        log_action(user, f"Account locked for {LOCKOUT_MINUTES} minutes — {MAX_FAILED_LOGINS} failed login attempts")
        send_account_locked_email(user, LOCKOUT_MINUTES)
    return tripped


def clear_failed_logins(user):
    """Resets the counter and any lock — after a successful login or a completed password reset."""
    if user.failed_login_count or user.locked_until or user.last_failed_login_at:
        User.objects.filter(pk=user.pk).update(
            failed_login_count=0, last_failed_login_at=None, locked_until=None
        )
