import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

from orms_backend.encrypted_fields import EncryptedTextField
from orms_backend.encrypted_storage import encrypted_storage


class User(AbstractUser):
    """
    Single user table for all three portals (Citizen, Staff/Barangay Official,
    Administrator). `role` determines which portal's views/permissions apply.
    Login is by email instead of Django's default username.
    """

    class Role(models.TextChoices):
        CITIZEN = "citizen", "Barangay Citizen"
        STAFF = "staff", "Barangay Official"
        ADMIN = "admin", "Administrator"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    # Not encrypted: login looks the account up by email, which an encrypted
    # column can't do (see EncryptedTextField).
    email = models.EmailField(unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.CITIZEN)
    # Personal data, encrypted at rest with the Modified Blowfish algorithm.
    # first_name/last_name override AbstractUser's plain columns for the same
    # reason. None of the four can be searched or sorted by the database.
    first_name = EncryptedTextField("first name", max_length=150, blank=True)
    middle_initial = EncryptedTextField("middle initial", max_length=10, blank=True)
    last_name = EncryptedTextField("last name", max_length=150, blank=True)
    contact_number = EncryptedTextField(max_length=20, blank=True)
    address = EncryptedTextField(max_length=255, blank=True)

    # Free-text job title for Staff accounts only (e.g. "Secretary",
    # "Investigator", "Barangay Captain") — separate from `role`, which is
    # what actually controls permissions. Purely for display on the admin
    # accounts list; left blank for citizen/admin accounts.
    position = models.CharField(max_length=50, blank=True)

    profile_picture = models.ImageField(upload_to="avatars/%Y/%m/", null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    # Residents start unverified until an admin approves their voter's ID.
    # Staff/Admin accounts are created directly by an admin, so default True.
    is_verified = models.BooleanField(default=False)

    # Failed-login lockout (see CustomTokenObtainPairSerializer). Deliberately
    # a temporary lock rather than reusing is_active=False: is_active needs an
    # admin to flip it back, which would let anyone who knows an email
    # lock that person out — the Administrator included — until an admin
    # noticed. A timed lock stops guessing just as well without that.
    failed_login_count = models.PositiveSmallIntegerField(default=0)
    last_failed_login_at = models.DateTimeField(null=True, blank=True)
    locked_until = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    def get_full_name(self):
        # AbstractUser's default joins first_name/last_name only — add the
        # middle initial (e.g. "Juan D. Dela Cruz") when one is on file.
        middle = f" {self.middle_initial.rstrip('.')}." if self.middle_initial else ""
        full_name = f"{self.first_name}{middle} {self.last_name}"
        return full_name.strip()

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.role})"


class VoterVerification(models.Model):
    """Tracks a resident's voter's ID review, per the Administrator Module scope."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="verification")
    # Stored encrypted (Modified Blowfish) — see orms_backend/encrypted_storage.py.
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
    A short-lived 6-digit code emailed for Forgot Password. Numeric (rather
    than a link/token) since the frontend flow is 3 separate pages —
    Forgot Password -> Input Code -> Reset Password — and the code has to
    survive being carried from the 2nd page to the 3rd.
    """

    CODE_TTL_MINUTES = 15

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="password_reset_codes")
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    # Set once Input Code accepts it, checked by Reset Password so a code
    # can't be used to set a new password without going through that step.
    verified_at = models.DateTimeField(null=True, blank=True)
    used_at = models.DateTimeField(null=True, blank=True)
    # Wrong guesses so far; see orms_backend/codes.py for the cap.
    failed_attempts = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]

    def is_valid(self):
        return self.used_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.used_at = timezone.now()
        self.save(update_fields=["used_at"])

    def __str__(self):
        return f"Reset code for {self.user}"


class ProfileEditVerificationCode(models.Model):
    """
    A short-lived 6-digit code emailed to confirm the real account owner is
    the one changing their email, mobile number, or address from My Profile
    → Edit Account Information (see accounts.views.MeView.patch) — sent to
    the address already on file, not any new one being entered, so this
    can't be used to hijack an account by pointing it at a different inbox.
    Same shape as PasswordResetCode; kept separate since it gates a
    different action.
    """

    CODE_TTL_MINUTES = 15

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="profile_edit_codes")
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    # Wrong guesses so far; see orms_backend/codes.py for the cap.
    failed_attempts = models.PositiveSmallIntegerField(default=0)

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
    """
    One row per login, backing the Administrator Module's View Audit Logs
    page. Created on successful login (CustomTokenObtainPairSerializer);
    logged_out_at is filled in by LogoutView when the user explicitly logs
    out, and stays null if they never did (session just expired/closed).
    """

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
    One row per notable action taken by (or on behalf of) a user — backs the
    Administrator Module's View Audit Logs page. Deliberately just
    (user, action, timestamp): a free-text, human-readable action description
    rather than a structured type, since the page only ever needs to show a
    readable "who did what when" feed, not drive any logic off of it. `user`
    is nullable so a log entry survives even if that account is later deleted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs")
    action = models.CharField(max_length=255)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    # Snapshotted from `user` at write time, so the owner's name and account
    # type stay on the entry forever even after that account is deleted
    # (when `user` goes null via SET_NULL above) — an audit log is a record
    # of what happened, and who/what it happened to shouldn't disappear just
    # because the account doesn't exist anymore. AuditLogSerializer prefers
    # these over a live lookup through `user`; entries logged before this
    # field existed fall back to that live lookup instead.
    # Encrypted like the name on the account itself — a plain copy here would
    # undo that.
    owner_name = EncryptedTextField(max_length=150, blank=True)
    owner_type = models.CharField(max_length=50, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user}: {self.action}"


def account_type_label(user):
    """Shared with AuditLogSerializer.get_type's legacy fallback — keep both in sync."""
    if user.role == User.Role.ADMIN:
        return "Administrator"
    if user.role == User.Role.CITIZEN:
        return "Barangay Citizen"
    return user.position or "Barangay Staff"


def log_action(user, action):
    """
    Best-effort audit log write, called from all over the codebase right
    after the action it's describing succeeds — wrapped in try/except so a
    logging hiccup can never turn into a 500 for the actual request (same
    reasoning as send_templated_email's try/except in orms_backend/emails.py).
    """
    # Trimmed to fit rather than failing (and being silently swallowed below)
    # when it embeds a long user-supplied value like an ordinance name.
    max_length = AuditLog._meta.get_field("action").max_length
    if len(action) > max_length:
        action = action[: max_length - 1] + "…"
    try:
        from .middleware import client_ip

        AuditLog.objects.create(
            user=user,
            action=action,
            ip_address=client_ip(),
            owner_name=(user.get_full_name() or user.username) if user else "",
            owner_type=account_type_label(user) if user else "",
        )
    except Exception:
        pass
