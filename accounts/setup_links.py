"""
One-time emailed links (no password is ever emailed).

1. Account setup link — sent when someone else creates an account (an
   Administrator creating a staff account, or a citizen account). The account
   starts with no usable password; the owner opens the link, fills in their
   details and chooses a password.
2. Password reset link — sent when an Administrator presses "Reset Password"
   on a staff/administrator account in Manage Accounts.

Both use Django's PasswordResetTokenGenerator, which signs the user's id,
password hash and last login with SECRET_KEY. So a link:
  - stops working once the password is set (the hash changes),
  - stops working when a newer link is sent (set_unusable_password() makes a new hash),
  - expires after a set time,
  - needs no database table.
Each kind has its own key_salt, so one kind of token can't be used as the other.

The token travels after "#" in the URL, so it never reaches server logs.
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
RESET_LINK_TTL_HOURS = 24


class AccountSetupTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "accounts.setup_links.AccountSetupTokenGenerator"


class AdminPasswordResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "accounts.setup_links.AdminPasswordResetTokenGenerator"

    def check_token(self, user, token):
        if not super().check_token(user, token):
            return False
        # super() only checks the 72-hour limit; a reset link gets 24 hours.
        issued = base36_to_int(token.split("-")[0])
        return self._num_seconds(self._now()) - issued <= RESET_LINK_TTL_HOURS * 3600


setup_token_generator = AccountSetupTokenGenerator()
reset_token_generator = AdminPasswordResetTokenGenerator()


def user_from_uid(uid):
    """The account the link's uid points to, or None."""
    try:
        return User.objects.filter(pk=force_str(urlsafe_base64_decode(str(uid or "")))).first()
    except (TypeError, ValueError, OverflowError, ValidationError):
        return None


def _link_params(user, generator):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    return f"uid={uid}&token={generator.make_token(user)}"


# ---- Account setup links ----

def is_pending_setup(user):
    """True for an active account that hasn't chosen a password yet."""
    return user is not None and user.is_active and not user.has_usable_password()


def build_setup_url(user):
    portal = "citizen" if user.role == User.Role.CITIZEN else "staff"
    return f"{settings.FRONTEND_BASE_URL}/{portal}/account-setup.html#{_link_params(user, setup_token_generator)}"


def send_setup_link(user):
    """Emails a fresh setup link. Every link sent before it stops working."""
    user.set_unusable_password()
    user.save(update_fields=["password"])
    send_account_setup_link_email(user, build_setup_url(user), SETUP_LINK_TTL_HOURS)


def pending_user_for_link(uid, token):
    """The account a still-valid setup link belongs to, or None."""
    user = user_from_uid(uid)
    if not is_pending_setup(user) or not setup_token_generator.check_token(user, str(token or "")):
        return None
    return user


# ---- Administrator-sent password reset links (staff/administrator accounts only) ----

def can_receive_reset_link(user):
    return (
        user is not None
        and user.is_active
        and user.role in (User.Role.STAFF, User.Role.ADMIN)
        and user.has_usable_password()
    )


def send_reset_link(user):
    url = f"{settings.FRONTEND_BASE_URL}/staff/new-password.html#{_link_params(user, reset_token_generator)}"
    send_password_reset_link_email(user, url, RESET_LINK_TTL_HOURS)


def user_for_reset_link(uid, token):
    """The staff/administrator account a still-valid reset link belongs to, or None."""
    user = user_from_uid(uid)
    if not can_receive_reset_link(user) or not reset_token_generator.check_token(user, str(token or "")):
        return None
    return user
