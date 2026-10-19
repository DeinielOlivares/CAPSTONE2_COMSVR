"""
Failed-login lockout (brute-force protection).

After MAX_FAILED_LOGINS wrong passwords within FAILURE_WINDOW_MINUTES, the
account is locked for LOCKOUT_MINUTES and the owner is emailed. The lock is
temporary on purpose: a permanent disable would let anyone lock a person out
just by knowing their email. Completing Forgot Password also clears the lock.

Used by CustomTokenObtainPairSerializer (accounts/serializers.py).
"""

import math
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from orms_backend.emails import send_account_locked_email

from .models import User, log_action

MAX_FAILED_LOGINS = 10
LOCKOUT_MINUTES = 30
FAILURE_WINDOW_MINUTES = 60


def lockout_minutes_remaining(user):
    """Minutes left on the lock (rounded up), or 0 if the account isn't locked."""
    if not user.locked_until:
        return 0
    seconds = (user.locked_until - timezone.now()).total_seconds()
    return max(0, math.ceil(seconds / 60))


def record_failed_login(user):
    """
    Counts one wrong password and returns True if this attempt locked the account.
    The row is locked while counting so many guesses sent at once are all counted.
    """
    now = timezone.now()
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user.pk)
        too_old = user.last_failed_login_at is None or now - user.last_failed_login_at > timedelta(
            minutes=FAILURE_WINDOW_MINUTES
        )
        user.failed_login_count = 1 if too_old else user.failed_login_count + 1
        user.last_failed_login_at = now

        locked = user.failed_login_count >= MAX_FAILED_LOGINS
        if locked:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_login_count = 0
        # update_fields so updated_at ("last active" on Manage Accounts) doesn't change.
        user.save(update_fields=["failed_login_count", "last_failed_login_at", "locked_until"])

    if locked:
        log_action(user, f"Account locked for {LOCKOUT_MINUTES} minutes — {MAX_FAILED_LOGINS} failed login attempts")
        send_account_locked_email(user, LOCKOUT_MINUTES, MAX_FAILED_LOGINS)
    return locked


def clear_failed_logins(user):
    """Resets the counter and lock after a successful login or password reset."""
    if user.failed_login_count or user.locked_until or user.last_failed_login_at:
        User.objects.filter(pk=user.pk).update(failed_login_count=0, last_failed_login_at=None, locked_until=None)
