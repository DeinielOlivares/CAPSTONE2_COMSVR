"""
Accounts — database tables for user accounts and signing in.

    User                         one row per account (citizen, staff or admin)
    VoterVerification            a citizen's voter's ID photo, waiting for admin review
    PasswordResetCode            6-digit code emailed for Forgot Password
    ProfileEditVerificationCode  6-digit code emailed before changing email/phone/address
    LoginSession                 one row per login (when it started and ended)
    AuditLog                     "who did what, and when" (Admin > View Audit Logs)
"""

import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

from orms_backend.encrypted_fields import EncryptedTextField
from orms_backend.encrypted_storage import encrypted_storage

from .middleware import client_ip


class User(AbstractUser):
    """
    One table for all three portals. `role` decides what the account may do;
    `position` is the staff member's job title (Barangay Captain, Secretary,
    Investigator, Administrator). People log in with their email.
    """

    class Role(models.TextChoices):
        CITIZEN = "citizen", "Barangay Citizen"
        STAFF = "staff", "Barangay Official"
        ADMIN = "admin", "Administrator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Plain text (not encrypted) because login has to search by it.
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.CITIZEN)

    # Personal data — encrypted in the database with the Modified Blowfish algorithm.
    first_name = EncryptedTextField("first name", max_length=150, blank=True)
    middle_initial = EncryptedTextField("middle initial", max_length=10, blank=True)
    last_name = EncryptedTextField("last name", max_length=150, blank=True)
    contact_number = EncryptedTextField(max_length=20, blank=True)
    address = EncryptedTextField(max_length=255, blank=True)

    position = models.CharField(max_length=50, blank=True)
    profile_picture = models.ImageField(upload_to="avatars/%Y/%m/", null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Self-registered citizens stay unverified until an admin approves their voter's ID.
    is_verified = models.BooleanField(default=False)

    # Failed-login lockout (see accounts/lockout.py).
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    last_failed_login_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    def get_full_name(self):
        """e.g. "Juan D. Dela Cruz" (the middle initial is added when there is one)."""
        middle = f" {self.middle_initial.rstrip('.')}." if self.middle_initial else ""
        return f"{self.first_name}{middle} {self.last_name}".strip()

    @property
    def display_name(self):
        """The full name, or the username when no name is on file yet."""
        return self.get_full_name() or self.username

    @property
    def account_type(self):
        """The label shown on admin pages: Administrator, Barangay Citizen, or the staff position."""
        if self.role == self.Role.ADMIN:
            return "Administrator"
        if self.role == self.Role.CITIZEN:
            return "Barangay Citizen"
        return self.position or "Barangay Staff"

    def __str__(self):
        return f"{self.display_name} ({self.role})"


class VoterVerification(models.Model):
    """A citizen's voter's ID photo, reviewed by an Administrator on Approve Accounts."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="verification")
    # The photo is stored encrypted (see orms_backend/encrypted_storage.py).
    voter_id_image = models.ImageField(upload_to="verification/%Y/%m/", storage=encrypted_storage)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    rejection_reason = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_verifications"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Verification for {self.user} — {self.status}"


class PasswordResetCode(models.Model):
    """
    Forgot Password: email -> enter the 6-digit code -> choose a new password.
    `verified_at` is set when the code is entered correctly; `used_at` when the
    new password is saved (or when a newer code replaces this one).
    """

    CODE_TTL_MINUTES = 15

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="password_reset_codes")
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)  # see orms_backend/codes.py

    class Meta:
        ordering = ["-created_at"]

    def is_valid(self):
        return self.used_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])

    def __str__(self):
        return f"Reset code for {self.user}"


class SignupEmailCode(models.Model):
    """
    Sign Up: proves the person owns the email before they upload their voter's
    ID. There is no account yet, so the code is keyed by the email itself.
    A correct code gets a random `token` that RegisterSerializer requires;
    `used_at` is set when the account is created (or a newer code replaces this one).
    """

    CODE_TTL_MINUTES = 15
    # After the code is entered, how long they have to finish the ID step.
    VERIFIED_TTL_MINUTES = 60

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(db_index=True)
    code = models.CharField(max_length=6)
    token = models.CharField(max_length=64, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)  # see orms_backend/codes.py

    class Meta:
        ordering = ["-created_at"]

    def is_valid(self):
        return self.used_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])

    def __str__(self):
        return f"Sign up code for {self.email}"


class ProfileEditVerificationCode(models.Model):
    """
    6-digit code sent to the email already on file before the account's email,
    mobile number or address can be changed (see MeView.patch).
    """

    CODE_TTL_MINUTES = 15

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="profile_edit_codes")
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)  # see orms_backend/codes.py

    class Meta:
        ordering = ["-created_at"]

    def is_valid(self):
        return self.used_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])

    def __str__(self):
        return f"Profile edit code for {self.user}"


class LoginSession(models.Model):
    """One row per login. `logged_out_at` stays empty if the user never pressed Log Out."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="login_sessions")
    logged_in_at = models.DateTimeField(auto_now_add=True)
    logged_out_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-logged_in_at"]

    def __str__(self):
        return f"{self.user} @ {self.logged_in_at}"


class AuditLog(models.Model):
    """
    One row per action, shown on Admin > View Audit Logs.

    owner_name/owner_type are a copy of the account's name and type *at the
    time of the action*, so the entry still says who did it after the account
    is renamed or deleted (`user` becomes empty when the account is deleted).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs")
    action = models.CharField(max_length=255)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    owner_name = EncryptedTextField(max_length=150, blank=True)
    owner_type = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user}: {self.action}"


def log_action(user, action):
    """
    Writes one audit log entry. Called right after an action succeeds.
    Never raises: a logging problem must not break the request itself.
    """
    max_length = AuditLog._meta.get_field("action").max_length
    if len(action) > max_length:
        action = action[: max_length - 1] + "…"
    try:
        AuditLog.objects.create(
            user=user,
            action=action,
            ip_address=client_ip(),
            owner_name=user.display_name if user else "",
            owner_type=user.account_type if user else "",
        )
    except Exception:
        pass
