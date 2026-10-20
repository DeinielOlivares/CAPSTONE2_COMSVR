"""
One-time account setup links — how every account someone else creates for a
person (an Administrator creating Barangay Staff/Administrator accounts, or a
Barangay Citizen account with or without its details filled in) gets
finished by its owner. No password is ever generated or emailed: the
account is created with an unusable password, and the emailed link lets the
owner fill in their details and choose their own.

The token is Django's PasswordResetTokenGenerator (an HMAC over the user's
id, password hash, last login, email and a timestamp, signed with
SECRET_KEY), with its own salt so a setup token can't be used as a password
reset token or the other way around. That gives these properties for free:

  - Single use: setting a password changes the hash, so the link dies the
    moment setup completes.
  - Revocable: issuing a new link calls set_unusable_password() again,
    which stores a fresh random unusable hash — every older link dies.
  - Expires after SETUP_LINK_TTL_HOURS (settings.PASSWORD_RESET_TIMEOUT).
  - Nothing to store or look up: no token table, nothing to leak from it.

The token rides in the URL fragment (#...), not the query string, so it
never reaches the server's access logs or a Referer header; the setup page
reads it with JavaScript and posts it to the API.
"""

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.core.exceptions import ValidationError
from django.utils.encoding import force_bytes, force_str
from django.utils.http import base36_to_int, urlsafe_base64_decode, urlsafe_base64_encode

from orms_backend.emails import send_account_setup_link_email, send_password_reset_link_email

User = get_user_model()

SETUP_LINK_TTL_HOURS = settings.PASSWORD_RESET_TIMEOUT // 3600


class AccountSetupTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "accounts.setup_links.AccountSetupTokenGenerator"


setup_token_generator = AccountSetupTokenGenerator()


def is_pending_setup(user):
    return user is not None and user.is_active and not user.has_usable_password()


def build_setup_url(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = setup_token_generator.make_token(user)
    portal = "citizen" if user.role == User.Role.CITIZEN else "staff"
    return f"{settings.FRONTEND_BASE_URL}/{portal}/account-setup.html#uid={uid}&token={token}"


def send_setup_link(user):
    """Emails a fresh setup link, killing every link sent before it."""
    user.set_unusable_password()
    user.save(update_fields=["password"])
    send_account_setup_link_email(user, build_setup_url(user), SETUP_LINK_TTL_HOURS)


def user_from_uid(uid):
    try:
        return User.objects.filter(pk=force_str(urlsafe_base64_decode(str(uid or "")))).first()
    except (TypeError, ValueError, OverflowError, ValidationError):
        return None


def pending_user_for_link(uid, token):
    """The account a still-valid setup link belongs to, or None."""
    user = user_from_uid(uid)
    if not is_pending_setup(user):
        return None
    if not setup_token_generator.check_token(user, str(token or "")):
        return None
    return user


# --- Administrator-initiated password reset links (Staff/Administrator only) ---
#
# Manage Accounts → Reset Password emails one of these to a Barangay Staff or
# Administrator account that's already set up. Same mechanism as the setup
# link, with its own salt (so neither token works as the other) and a shorter
# life. The account's current password keeps working until the link is used,
# so an Administrator clicking the button can't lock anyone out. Using the
# link changes the password hash, which kills it and every other reset link
# sent before it; logging in also kills it (last_login is part of the hash).
# Citizens don't get this: they reset their own password with Forgot Password.

RESET_LINK_TTL_HOURS = 24


class AdminPasswordResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "accounts.setup_links.AdminPasswordResetTokenGenerator"

    def check_token(self, user, token):
        if not super().check_token(user, token):
            return False
        # super() only enforces PASSWORD_RESET_TIMEOUT (the 72h setup window);
        # a reset link gets the shorter RESET_LINK_TTL_HOURS on top of it.
        issued = base36_to_int(token.split("-")[0])
        return self._num_seconds(self._now()) - issued <= RESET_LINK_TTL_HOURS * 3600


reset_token_generator = AdminPasswordResetTokenGenerator()


def can_receive_reset_link(user):
    return (
        user is not None
        and user.is_active
        and user.role in (User.Role.STAFF, User.Role.ADMIN)
        and user.has_usable_password()
    )


def send_reset_link(user):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = reset_token_generator.make_token(user)
    url = f"{settings.FRONTEND_BASE_URL}/staff/new-password.html#uid={uid}&token={token}"
    send_password_reset_link_email(user, url, RESET_LINK_TTL_HOURS)


def user_for_reset_link(uid, token):
    """The Staff/Administrator account a still-valid reset link belongs to, or None."""
    user = user_from_uid(uid)
    if not can_receive_reset_link(user):
        return None
    if not reset_token_generator.check_token(user, str(token or "")):
        return None
    return user
