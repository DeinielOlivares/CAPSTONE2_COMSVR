"""
Accounts — serializers (they check incoming data and shape outgoing JSON).

Sections:
  1. Shared checks (mobile number, email/phone already used)
  2. Sign up and accounts created by an Administrator
  3. Account setup from an emailed link
  4. Profile (view/edit, change password, delete)
  5. Login (with lockout) and Forgot Password
  6. Admin pages (Manage Accounts, Approve Accounts, Audit Logs)
"""

import re
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count
from django.utils import timezone
from django.utils.timesince import timesince
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from orms_backend.codes import CODE_EXHAUSTED, CODE_OK, check_code, generate_code
from orms_backend.emails import send_password_reset_email, send_signup_email_code

from .lockout import LOCKOUT_MINUTES, clear_failed_logins, lockout_minutes_remaining, record_failed_login
from .models import AuditLog, LoginSession, PasswordResetCode, SignupEmailCode, VoterVerification, log_action

User = get_user_model()


# ---------------------------------------------------------------------------
# 1. Shared checks
# ---------------------------------------------------------------------------

PH_MOBILE_RE = re.compile(r"^(?:\+?63|0)9\d{9}$")
EMAIL_TAKEN = "An account with this email already exists."
PHONE_TAKEN = "An account with this phone number already exists."


def clean_ph_mobile(value):
    """A Philippine mobile number: 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes ignored)."""
    cleaned = re.sub(r"[\s\-()]", "", value or "")
    if not PH_MOBILE_RE.match(cleaned):
        raise serializers.ValidationError("Enter a valid mobile number, like 09XXXXXXXXX.")
    return cleaned


def phone_already_used(value, exclude_user=None):
    """
    contact_number is encrypted with a different random salt every time, so the
    database can't compare it — each stored number is decrypted and compared here.
    """
    candidates = User.objects.exclude(contact_number="")
    if exclude_user is not None:
        candidates = candidates.exclude(pk=exclude_user.pk)
    return any(u.contact_number == value for u in candidates.only("pk", "contact_number"))


def check_email_available(value, exclude_user=None):
    """Emails are compared ignoring case, because login ignores case too."""
    others = User.objects.filter(email__iexact=value)
    if exclude_user is not None:
        others = others.exclude(pk=exclude_user.pk)
    if others.exists():
        raise serializers.ValidationError(EMAIL_TAKEN)
    return value


def check_phone_available(value, exclude_user=None):
    value = clean_ph_mobile(value)
    if phone_already_used(value, exclude_user):
        raise serializers.ValidationError(PHONE_TAKEN)
    return value


# ---------------------------------------------------------------------------
# 2. Sign up and accounts created by an Administrator
# ---------------------------------------------------------------------------

class AccountAvailabilityCheckSerializer(serializers.Serializer):
    """Sign Up step 1 checks the email and phone early, before the ID photo step."""

    email = serializers.EmailField(required=False, allow_blank=True)
    contact_number = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        return check_email_available(value) if value else value

    def validate_contact_number(self, value):
        return check_phone_available(value) if value else value


class RegisterSerializer(serializers.ModelSerializer):
    """
    Public sign up. Always creates a citizen account plus a pending
    VoterVerification; the citizen can't log in until an Administrator approves it.
    """

    password = serializers.CharField(write_only=True, validators=[validate_password])
    voter_id_image = serializers.ImageField(write_only=True)
    # From SignupCodeVerifySerializer: proves the email was confirmed first.
    email_verification_token = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = [
            "id", "email", "password", "first_name", "middle_initial", "last_name",
            "contact_number", "address", "voter_id_image", "email_verification_token",
        ]
        read_only_fields = ["id"]

    def validate_email(self, value):
        return check_email_available(value)

    def validate_contact_number(self, value):
        return check_phone_available(value)

    def validate(self, attrs):
        if not _verified_signup_code(attrs["email"], attrs["email_verification_token"]):
            raise serializers.ValidationError({"email_verification_token": [SIGNUP_EMAIL_UNVERIFIED]})
        return attrs

    def create(self, validated_data):
        token = validated_data.pop("email_verification_token")
        voter_id_image = validated_data.pop("voter_id_image")
        password = validated_data.pop("password")
        with transaction.atomic():
            # Locked so the same verification can't create two accounts at once.
            signup_code = _verified_signup_code(validated_data["email"], token, lock=True)
            if not signup_code:
                raise serializers.ValidationError({"email_verification_token": [SIGNUP_EMAIL_UNVERIFIED]})
            # Django requires a username; the email is used so it's always unique.
            user = User(**validated_data, username=validated_data["email"], role=User.Role.CITIZEN)
            user.set_password(password)
            user.save()
            VoterVerification.objects.create(user=user, voter_id_image=voter_id_image)
            signup_code.expire()
        return user


SIGNUP_EMAIL_UNVERIFIED = "Your email verification has expired. Please verify your email again."


def _verified_signup_code(email, token, lock=False):
    """The still-valid SignupEmailCode that `token` was issued for, or None."""
    if not token:
        return None
    codes = SignupEmailCode.objects.filter(
        email__iexact=email, token=token, verified_at__isnull=False, used_at__isnull=True
    )
    if lock:
        codes = codes.select_for_update()
    signup_code = codes.first()
    return signup_code if signup_code and signup_code.is_valid() else None


class SignupCodeRequestSerializer(serializers.Serializer):
    """Sign Up: email a 6-digit code to the address typed on step 1."""

    email = serializers.EmailField()

    def validate_email(self, value):
        # Sign Up step 1 already says when an email is taken, so this reveals nothing new.
        return check_email_available(value)

    def save(self):
        email = self.validated_data["email"]
        # Older unused codes stop working; only the newest one is valid.
        SignupEmailCode.objects.filter(email__iexact=email, used_at__isnull=True).update(used_at=timezone.now())
        code = generate_code()
        SignupEmailCode.objects.create(
            email=email,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=SignupEmailCode.CODE_TTL_MINUTES),
        )
        send_signup_email_code(email, code, SignupEmailCode.CODE_TTL_MINUTES)


class SignupCodeVerifySerializer(serializers.Serializer):
    """Sign Up: check the emailed code. Wrong guesses are counted (orms_backend/codes.py)."""

    email = serializers.EmailField()
    code = serializers.CharField()

    def validate(self, attrs):
        signup_code = (
            SignupEmailCode.objects.filter(email__iexact=attrs["email"], used_at__isnull=True, verified_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if not signup_code or not signup_code.is_valid():
            raise serializers.ValidationError("Invalid or expired code.")
        result = check_code(signup_code, attrs["code"])
        if result == CODE_EXHAUSTED:
            raise serializers.ValidationError("Too many incorrect attempts. Please request a new code.")
        if result != CODE_OK:
            raise serializers.ValidationError("Invalid or expired code.")
        attrs["signup_code"] = signup_code
        return attrs

    def save(self):
        """Marks the code verified and returns the token Sign Up step 2 must send."""
        signup_code = self.validated_data["signup_code"]
        signup_code.verified_at = timezone.now()
        signup_code.token = secrets.token_urlsafe(32)
        # The code itself expired; the verification now lasts long enough for the ID step.
        signup_code.expires_at = signup_code.verified_at + timedelta(minutes=SignupEmailCode.VERIFIED_TTL_MINUTES)
        signup_code.save(update_fields=["verified_at", "token", "expires_at"])
        return signup_code.token


# The four roles an Administrator can give a staff account, and the `role`
# each one maps to. Only one active Barangay Captain and one active Secretary
# are allowed at a time.
STAFF_ROLE_CHOICES = ["Barangay Captain", "Secretary", "Investigator", "Administrator"]
STAFF_ROLE_TO_ROLE_FIELD = {
    "Barangay Captain": User.Role.STAFF,
    "Secretary": User.Role.STAFF,
    "Investigator": User.Role.STAFF,
    "Administrator": User.Role.ADMIN,
}
UNIQUE_STAFF_ROLES = {"Barangay Captain", "Secretary"}


def validate_staff_role_uniqueness(staff_role, exclude_user=None):
    """Raises if `staff_role` is a one-person role that someone else already holds."""
    if staff_role not in UNIQUE_STAFF_ROLES:
        return
    clash = User.objects.filter(position__iexact=staff_role, is_active=True)
    if exclude_user is not None:
        clash = clash.exclude(pk=exclude_user.pk)
    if clash.exists():
        raise serializers.ValidationError(f"There's already an active {staff_role}. Only one is allowed at a time.")


def _new_account_without_password(**fields):
    """Accounts made by someone else start with no password (see accounts/setup_links.py)."""
    user = User(username=fields["email"], **fields)
    user.set_unusable_password()
    user.save()
    return user


class AdminCreateUserSerializer(serializers.ModelSerializer):
    """Administrator creates a staff/administrator account from just an email and a role."""

    staff_role = serializers.ChoiceField(choices=STAFF_ROLE_CHOICES, write_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "staff_role"]
        read_only_fields = ["id"]

    def validate_email(self, value):
        return check_email_available(value)

    def validate_staff_role(self, value):
        validate_staff_role_uniqueness(value)
        return value

    def create(self, validated_data):
        staff_role = validated_data.pop("staff_role")
        return _new_account_without_password(
            **validated_data, role=STAFF_ROLE_TO_ROLE_FIELD[staff_role], position=staff_role, is_verified=True
        )


class CitizenInviteSerializer(serializers.Serializer):
    """Administrator/Secretary creates a citizen account from just an email."""

    email = serializers.EmailField()

    def validate_email(self, value):
        return check_email_available(value)

    def create(self, validated_data):
        return _new_account_without_password(email=validated_data["email"], role=User.Role.CITIZEN, is_verified=True)


class StaffCreateCitizenSerializer(serializers.ModelSerializer):
    """Administrator creates a citizen account with all the details filled in."""

    first_name = serializers.CharField(required=True)
    middle_initial = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=True)
    contact_number = serializers.CharField(required=True)
    address = serializers.CharField(required=True)

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "middle_initial", "last_name", "contact_number", "address"]
        read_only_fields = ["id"]

    def validate_email(self, value):
        return check_email_available(value)

    def validate_contact_number(self, value):
        return check_phone_available(value)

    def create(self, validated_data):
        return _new_account_without_password(**validated_data, role=User.Role.CITIZEN, is_verified=True)


# ---------------------------------------------------------------------------
# 3. Account setup from an emailed link
# ---------------------------------------------------------------------------

class AccountSetupPasswordMixin(serializers.Serializer):
    """
    The password part of account setup. Checked in validate() (not on the field)
    so "too similar to your name" can use the name typed in the same form.
    """

    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        candidate = User(
            username=self.instance.username,
            email=self.instance.email,
            first_name=attrs.get("first_name", self.instance.first_name),
            last_name=attrs.get("last_name", self.instance.last_name),
        )
        try:
            validate_password(attrs["password"], user=candidate)
        except DjangoValidationError as e:
            raise serializers.ValidationError({"password": list(e.messages)})
        return attrs

    def update(self, instance, validated_data):
        password = validated_data.pop("password")
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.set_password(password)
        instance.save()
        return instance

    def validate_contact_number(self, value):
        return check_phone_available(value, exclude_user=self.instance)


class CitizenSetupSerializer(AccountSetupPasswordMixin, serializers.ModelSerializer):
    """A citizen finishing setup: the same details as sign up, minus the voter's ID."""

    first_name = serializers.CharField(required=True)
    middle_initial = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=True)
    contact_number = serializers.CharField(required=True)
    address = serializers.CharField(required=True)

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "contact_number", "address", "password"]


class StaffAccountSetupSerializer(AccountSetupPasswordMixin, serializers.ModelSerializer):
    """A staff member finishing setup: name, phone and password (role/email are already set)."""

    first_name = serializers.CharField(required=True)
    middle_initial = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=True)
    contact_number = serializers.CharField(required=True)

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "contact_number", "password"]


# ---------------------------------------------------------------------------
# 4. Profile
# ---------------------------------------------------------------------------

class UserSerializer(serializers.ModelSerializer):
    """The logged-in user's own profile (GET /api/auth/me/, and part of the login response)."""

    name = serializers.SerializerMethodField()
    profile_picture = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "email", "name", "first_name", "middle_initial", "last_name",
            "role", "position", "contact_number", "address", "is_verified",
            "profile_picture",
        ]

    def get_name(self, obj):
        return obj.display_name

    def get_profile_picture(self, obj):
        if not obj.profile_picture:
            return None
        request = self.context.get("request")
        url = obj.profile_picture.url
        return request.build_absolute_uri(url) if request else url


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """
    My Profile > Edit Information. role/position/is_verified are not editable
    here, so nobody can raise their own access level.
    """

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "email", "contact_number", "address", "profile_picture"]

    def validate_email(self, value):
        return check_email_available(value, exclude_user=self.instance)

    def validate_contact_number(self, value):
        return clean_ph_mobile(value)


class ChangePasswordSerializer(serializers.Serializer):
    """My Profile > Change Password. The current password is required."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        # Passing the user lets the "too similar to your name/email" rule work.
        validate_password(value, user=self.context["request"].user)
        return value

    def save(self):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class LinkPasswordSerializer(serializers.Serializer):
    """The new password chosen from an Administrator-sent reset link."""

    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        user = self.context["user"]
        validate_password(value, user=user)
        if user.check_password(value):
            raise serializers.ValidationError("Choose a password different from your current one.")
        return value


class DeleteAccountSerializer(serializers.Serializer):
    """Citizen deleting their own account. The current password is required."""

    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Incorrect password.")
        return value


# ---------------------------------------------------------------------------
# 5. Login and Forgot Password
# ---------------------------------------------------------------------------

def _locked_message(minutes):
    return (
        f"Too many failed login attempts. This account is locked for {minutes} more "
        f"minute{'' if minutes == 1 else 's'}. Check your email, or use Forgot Password to unlock it now."
    )


SETUP_PENDING_MESSAGE = (
    "This account hasn't been set up yet. Open the setup link we emailed you. "
    "If it has expired, open it anyway to request a new one."
)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    POST /api/auth/login/. Returns JWT tokens plus the user's profile.

    Checks, in order:
      1. the account is not locked (failed-login lockout)
      2. the account has been set up (has a password)
      3. the password is correct (a wrong one counts toward the lockout)
      4. the account belongs to the portal being logged into
      5. a citizen's voter's ID has been approved
    """

    # Which login page was used: "citizen" or "staff".
    portal = serializers.ChoiceField(choices=["citizen", "staff"], required=False, write_only=True)

    # Same message for a wrong password and an unknown email, so the form can't
    # be used to find out which emails are registered.
    default_error_messages = {"no_active_account": "Incorrect email or password."}

    # portal -> (roles refused there, message, error code). The citizen login
    # answers a staff email with the normal "incorrect" message, so it can't be
    # used to discover which emails have staff access.
    WRONG_PORTAL = {
        "citizen": ({User.Role.STAFF, User.Role.ADMIN}, "Incorrect email or password.", "no_active_account"),
        "staff": (
            {User.Role.CITIZEN},
            "Citizen accounts can't log in here. Please use the citizen portal.",
            "wrong_portal",
        ),
    }

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["name"] = user.display_name
        return token

    def validate(self, attrs):
        account = User.objects.filter(email__iexact=attrs.get(self.username_field, "")).first()
        if account and not account.is_active:
            account = None  # disabled accounts can't log in anyway; don't lock or email them

        if account:
            remaining = lockout_minutes_remaining(account)
            if remaining:
                raise AuthenticationFailed(_locked_message(remaining), code="account_locked")

        portal = attrs.get("portal")
        portal_refuses = portal in self.WRONG_PORTAL and account and account.role in self.WRONG_PORTAL[portal][0]
        if account and not account.has_usable_password() and not portal_refuses:
            raise AuthenticationFailed(SETUP_PENDING_MESSAGE, code="setup_pending")

        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            if account and record_failed_login(account):
                raise AuthenticationFailed(_locked_message(LOCKOUT_MINUTES), code="account_locked")
            raise
        if account:
            clear_failed_logins(account)

        if portal in self.WRONG_PORTAL and self.user.role in self.WRONG_PORTAL[portal][0]:
            _, message, code = self.WRONG_PORTAL[portal]
            raise AuthenticationFailed(message, code=code)

        if not self.user.is_verified:
            raise AuthenticationFailed(
                "Your account is still under verification. Please try again later.",
                code="account_unverified",
            )

        LoginSession.objects.create(user=self.user)
        log_action(self.user, "Logged in")

        data["user"] = UserSerializer(self.user, context=self.context).data
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    """Forgot Password step 1: email a new 6-digit code (if the account exists)."""

    email = serializers.EmailField()

    def validate_email(self, value):
        # No error when nothing matches, so this can't reveal who is registered.
        self._user = User.objects.filter(email__iexact=value).first()
        return value

    def save(self):
        if self._user is None:
            return
        # Older unused codes stop working; only the newest one is valid.
        PasswordResetCode.objects.filter(user=self._user, used_at__isnull=True).update(used_at=timezone.now())
        code = generate_code()
        PasswordResetCode.objects.create(
            user=self._user,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=PasswordResetCode.CODE_TTL_MINUTES),
        )
        send_password_reset_email(self._user, code, PasswordResetCode.CODE_TTL_MINUTES)


class PasswordResetVerifySerializer(serializers.Serializer):
    """Forgot Password step 2: check the code. Wrong guesses are counted (orms_backend/codes.py)."""

    email = serializers.EmailField()
    code = serializers.CharField()

    def validate(self, attrs):
        reset_code = (
            PasswordResetCode.objects.filter(user__email__iexact=attrs["email"], used_at__isnull=True)
            .order_by("-created_at")
            .first()
        )
        if not reset_code or not reset_code.is_valid():
            raise serializers.ValidationError("Invalid or expired code.")
        result = check_code(reset_code, attrs["code"])
        if result == CODE_EXHAUSTED:
            raise serializers.ValidationError("Too many incorrect attempts. Please request a new code.")
        if result != CODE_OK:
            raise serializers.ValidationError("Invalid or expired code.")
        attrs["reset_code"] = reset_code
        return attrs

    def save(self):
        reset_code = self.validated_data["reset_code"]
        reset_code.verified_at = timezone.now()
        reset_code.save(update_fields=["verified_at"])


class PasswordResetConfirmSerializer(serializers.Serializer):
    """Forgot Password step 3: set the new password (only with a code verified in step 2)."""

    email = serializers.EmailField()
    code = serializers.CharField()
    password = serializers.CharField(validators=[validate_password])

    def validate(self, attrs):
        reset_code = (
            PasswordResetCode.objects.filter(
                user__email__iexact=attrs["email"],
                code=attrs["code"],
                used_at__isnull=True,
                verified_at__isnull=False,
            )
            .order_by("-created_at")
            .first()
        )
        if not reset_code or not reset_code.is_valid():
            raise serializers.ValidationError("Invalid or expired code.")
        attrs["reset_code"] = reset_code
        return attrs

    def save(self):
        reset_code = self.validated_data["reset_code"]
        user = reset_code.user
        user.set_password(self.validated_data["password"])
        user.save(update_fields=["password"])
        reset_code.used_at = timezone.now()
        reset_code.save(update_fields=["used_at"])
        # Resetting proves the person owns the email, so it also lifts a lockout.
        clear_failed_logins(user)


# ---------------------------------------------------------------------------
# 6. Admin pages
# ---------------------------------------------------------------------------

def _ago(moment):
    return f"{timesince(moment)} ago"


class AdminAccountSerializer(serializers.ModelSerializer):
    """One row of Admin > Manage Accounts (field names match manage-accounts.js)."""

    owner = serializers.CharField(source="display_name", read_only=True)
    type = serializers.CharField(source="account_type", read_only=True)
    active = serializers.BooleanField(source="is_active", read_only=True)
    lastActiveLabel = serializers.SerializerMethodField()
    activityMinutes = serializers.SerializerMethodField()
    created = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="date_joined", read_only=True)
    updated = serializers.SerializerMethodField()
    setupPending = serializers.SerializerMethodField()
    position = serializers.CharField(read_only=True)
    # Citizens only: how many reports/suggestions they filed, per status.
    reportStats = serializers.SerializerMethodField()
    suggestionStats = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "owner", "email", "type", "active", "position",
            "lastActiveLabel", "activityMinutes", "created", "createdAt", "updated",
            "setupPending", "reportStats", "suggestionStats",
        ]

    @staticmethod
    def _status_breakdown(queryset):
        counts = {row["status"]: row["count"] for row in queryset.values("status").annotate(count=Count("id"))}
        return {"total": sum(counts.values()), "byStatus": counts}

    def get_reportStats(self, obj):
        return self._status_breakdown(obj.reports.all()) if obj.role == User.Role.CITIZEN else None

    def get_suggestionStats(self, obj):
        return self._status_breakdown(obj.concerns.all()) if obj.role == User.Role.CITIZEN else None

    def get_setupPending(self, obj):
        return not obj.has_usable_password()

    def get_activityMinutes(self, obj):
        # Never-logged-in accounts get a huge number so they sort last.
        if not obj.last_login:
            return 10**9
        return max(int((timezone.now() - obj.last_login).total_seconds() // 60), 0)

    def get_lastActiveLabel(self, obj):
        return _ago(obj.last_login) if obj.last_login else "Never logged in"

    def get_created(self, obj):
        return _ago(obj.date_joined)

    def get_updated(self, obj):
        return _ago(obj.updated_at)


class PendingVerificationSerializer(serializers.ModelSerializer):
    """One row of Admin > Approve Accounts."""

    owner = serializers.CharField(source="user.display_name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    type = serializers.CharField(source="user.account_type", read_only=True)
    photoUrl = serializers.SerializerMethodField()
    created = serializers.SerializerMethodField()

    class Meta:
        model = VoterVerification
        fields = ["id", "owner", "email", "type", "photoUrl", "created"]

    def get_photoUrl(self, obj):
        request = self.context.get("request")
        url = obj.voter_id_image.url
        return request.build_absolute_uri(url) if request else url

    def get_created(self, obj):
        return _ago(obj.created_at)


class AuditLogSerializer(serializers.ModelSerializer):
    """One row of Admin > View Audit Logs."""

    accountId = serializers.SerializerMethodField()
    owner = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    timeAt = serializers.DateTimeField(source="created_at", read_only=True)
    timeLabel = serializers.SerializerMethodField()
    ipAddress = serializers.CharField(source="ip_address", read_only=True)

    class Meta:
        model = AuditLog
        fields = ["id", "accountId", "owner", "type", "timeAt", "timeLabel", "action", "ipAddress"]

    def get_accountId(self, obj):
        return str(obj.user_id) if obj.user_id else "—"

    # The saved copy (owner_name/owner_type) is used first; very old entries
    # without one fall back to the account itself.
    def get_owner(self, obj):
        if obj.owner_name:
            return obj.owner_name
        return obj.user.display_name if obj.user else "Deleted account"

    def get_type(self, obj):
        if obj.owner_type:
            return obj.owner_type
        return obj.user.account_type if obj.user else "—"

    def get_timeLabel(self, obj):
        return timezone.localtime(obj.created_at).strftime("%H:%M:%S %m/%d/%Y")
