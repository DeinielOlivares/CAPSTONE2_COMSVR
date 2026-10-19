import re

from django.core.exceptions import ValidationError


class CharacterClassValidator:
    """
    A password needs at least one lowercase letter, one uppercase letter and one
    special character. Listed in AUTH_PASSWORD_VALIDATORS (settings.py), so it
    applies everywhere a password is set. The frontend shows the same rules
    (getPasswordRuleStatus in frontend/shared/js/common.js).
    """

    RULES = [
        (r"[a-z]", "At least 1 lowercase character"),
        (r"[A-Z]", "At least 1 uppercase character"),
        (r"[^A-Za-z0-9]", "At least 1 special character"),
    ]

    def validate(self, password, user=None):
        missing = [message for pattern, message in self.RULES if not re.search(pattern, password)]
        if missing:
            raise ValidationError(missing, code="password_character_classes")

    def get_help_text(self):
        return "Your password must contain at least 1 lowercase, 1 uppercase and 1 special character."
