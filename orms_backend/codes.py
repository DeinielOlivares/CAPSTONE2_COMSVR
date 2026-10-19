"""
The 6-digit emailed codes (Forgot Password, File Report verification,
Profile edit).

Brute-force protection: codes come from a cryptographically secure generator,
and a code stops working after MAX_CODE_ATTEMPTS wrong guesses. Requesting a
new code is rate limited (see the throttle rates in settings.py).

The code models need a `failed_attempts` field and an `expire()` method.
"""

import secrets

from django.db import transaction

MAX_CODE_ATTEMPTS = 5

CODE_OK = "ok"
CODE_WRONG = "wrong"
CODE_EXHAUSTED = "exhausted"


def generate_code():
    # `secrets` (not `random`) because these codes must not be predictable.
    return f"{secrets.randbelow(1_000_000):06d}"


def check_code(code_obj, submitted):
    """
    Compares `submitted` with the code and counts a wrong guess.
    Returns CODE_OK, CODE_WRONG or CODE_EXHAUSTED (no attempts left).
    The row is locked while checking, so guesses sent at the same time are
    still counted one by one.
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
