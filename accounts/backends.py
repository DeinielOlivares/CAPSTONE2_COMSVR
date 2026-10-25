from django.contrib.auth.backends import ModelBackend

from .models import User


class CaseInsensitiveEmailBackend(ModelBackend):
    """
    ModelBackend, but the email is matched without regard to case.

    Emails are stored as typed (Django only lowercases the domain), while the
    default backend looks them up exactly — so an account registered as
    "Juan@gmail.com" refused "juan@gmail.com", and the other way round. Phone
    keyboards capitalize the first letter on their own, which made logins fail
    "sometimes", depending on the device. Forgot Password already matched
    case-insensitively, so a reset seemed to work and the next login still
    failed. Every other email lookup in accounts/ is iexact; this brings login
    in line.
    """

    def authenticate(self, request, username=None, password=None, **kwargs):
        email = kwargs.get(User.USERNAME_FIELD, username)
        if email is None or password is None:
            return None
        matches = list(User._default_manager.filter(email__iexact=email.strip())[:2])
        # Signup refuses an email that differs only in case, but an older pair
        # could exist; never guess between two accounts — only an exact match wins.
        if len(matches) > 1:
            matches = [u for u in matches if u.email == email.strip()]
        if len(matches) != 1:
            # Same cost as a real check, so response time doesn't reveal
            # whether the email has an account (as ModelBackend does).
            User().set_password(password)
            return None
        user = matches[0]
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
