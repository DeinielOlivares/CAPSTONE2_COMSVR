"""
Shared handling for the 6-digit emailed codes (Forgot Password's PasswordResetCode
and File Report's ReportVerificationCode).

A 6-digit code is only 1,000,000 possibilities, so on its own it's guessable
by brute force within its 15-minute life. Two things make that impractical:
codes come from a cryptographically secure generator, and each code dies after
MAX_CODE_ATTEMPTS wrong guesses — an attacker then needs a fresh code, and
requesting those is itself rate limited (see the throttle scopes in settings.py).

Both models need a `failed_attempts` integer field and an `expire()` method
that makes the code unusable.
"""

import secrets

from django.db import transaction

MAX_CODE_ATTEMPTS = 5

CODE_OK = "ok"
CODE_WRONG = "wrong"
CODE_EXHAUSTED = "exhausted"


def generate_code():
    # secrets, not random: random's Mersenne Twister is predictable from
    # enough observed outputs, and these codes are a login-equivalent secret.
    return f"{secrets.randbelow(1_000_000):06d}"


def check_code(code_obj, submitted):
    """
    Compares `submitted` to the code and counts a wrong guess. Returns
    CODE_OK, CODE_WRONG, or CODE_EXHAUSTED (this guess used up the last
    attempt, or none were left — the code is dead either way).

    The row is locked for the read-then-count, so a burst of parallel guesses
    is counted one at a time instead of all being compared before any is
    recorded — which would let the cap be dodged by sending them together.
    """
    with transaction.atomic():
        locked = type(code_obj).objects.select_for_update().get(pk=code_obj.pk)
        if locked.failed_attempts >= MAX_CODE_ATTEMPTS:
            return CODE_EXHAUSTED
        if secrets.compare_digest(locked.code.encode(), submitted.strip().encode()):
            return CODE_OK
        locked.failed_attempts += 1
        locked.save(update_fields=["failed_attempts"])
        if locked.failed_attempts >= MAX_CODE_ATTEMPTS:
            locked.expire()
            return CODE_EXHAUSTED
        return CODE_WRONG
