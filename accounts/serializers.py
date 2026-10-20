import re
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from orms_backend.codes import CODE_EXHAUSTED, CODE_OK, check_code, generate_code
from orms_backend.emails import send_password_reset_email, send_signup_email_code

from .lockout import LOCKOUT_MINUTES, clear_failed_logins, lockout_minutes_remaining, record_failed_login
from .models import (
    AuditLog,
    LoginSession,
    PasswordResetCode,
    SignupEmailCode,
    VoterVerification,
    account_type_label,
    log_action,
)

User = get_user_model()


PH_MOBILE_RE = re.compile(r"^(?:\+?63|0)9\d{9}$")


def clean_ph_mobile(value):
    """A Philippine mobile number — 09XXXXXXXXX or +639XXXXXXXXX (spaces/dashes ignored)."""
    cleaned = re.sub(r"[\s\-()]", "", value or "")
    if not PH_MOBILE_RE.match(cleaned):
        raise serializers.ValidationError("Enter a valid mobile number, like 09XXXXXXXXX.")
    return cleaned


def phone_already_used(value, exclude_user=None):
    """
    contact_number is encrypted at rest (see EncryptedTextField) with a random
    salt/IV per value, so the database can't filter or compare it directly —
    duplicates have to be found by decrypting every stored number in Python.
    """
    candidates = User.objects.exclude(contact_number="")
    if exclude_user is not None:
        candidates = candidates.exclude(pk=exclude_user.pk)
    return any(u.contact_number == value for u in candidates.only("pk", "contact_number"))


class AccountAvailabilityCheckSerializer(serializers.Serializer):
    """
    Sign Up step 1 (frontend/citizen/signup.html) calls this before moving to
    step 2's ID photo upload, so a duplicate email/phone is caught on the
    same page it was typed into instead of after uploading the photo.
    RegisterSerializer re-checks the same thing at actual account creation
    regardless — this is just an earlier, friendlier heads-up.
    """

    email = serializers.EmailField(required=False, allow_blank=True)
    contact_number = serializers.CharField(required=False, allow_blank=True)

    def validate_email(self, value):
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_contact_number(self, value):
        if not value:
            return value
        cleaned = clean_ph_mobile(value)
        if phone_already_used(cleaned):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return cleaned


class RegisterSerializer(serializers.ModelSerializer):
    """
    Public self-registration. Always creates a `citizen` role account —
    Staff and Admin accounts are created separately by an Administrator
    (see AdminCreateUserSerializer), never through open signup. Also
    requires a voter's ID photo, which creates a pending VoterVerification
    row for an Administrator to review (see AdminApproveVerificationView) —
    the account can't log in until then, see CustomTokenObtainPairSerializer.
    The email must have been confirmed first with a 6-digit code (see
    SignupCodeVerifySerializer), which hands out `email_verification_token`.
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
        # The column's own uniqueness is case-sensitive, so "Juan@x.com" would
        # get past it while "juan@x.com" exists — and login matches email
        # ignoring case, so the two accounts would then collide there.
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_contact_number(self, value):
        value = clean_ph_mobile(value)
        if phone_already_used(value):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value

    def validate(self, attrs):
        if not _verified_signup_code(attrs["email"], attrs["email_verification_token"]):
            raise serializers.ValidationError({"email_verification_token": [SIGNUP_EMAIL_UNVERIFIED]})
        return attrs

    def create(self, validated_data):
        token = validated_data.pop("email_verification_token")
        voter_id_image = validated_data.pop("voter_id_image")
        password = validated_data.pop("password")
        # username isn't used for login, but Django's User model requires one;
        # derive it from email so it stays unique without asking the resident for it.
        validated_data["username"] = validated_data["email"]
        validated_data["role"] = User.Role.CITIZEN
        with transaction.atomic():
            # Locked so the same verification can't create two accounts at once.
            signup_code = _verified_signup_code(validated_data["email"], token, lock=True)
            if not signup_code:
                raise serializers.ValidationError({"email_verification_token": [SIGNUP_EMAIL_UNVERIFIED]})
            user = User(**validated_data)
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
    """Sign Up: emails a 6-digit code to the address typed on step 1."""

    email = serializers.EmailField()

    def validate_email(self, value):
        # Sign Up step 1 already says when an email is taken, so this reveals nothing new.
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

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
    """Sign Up: checks the emailed code. Wrong guesses are counted (orms_backend/codes.py)."""

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
        """Marks the code verified and returns the token Sign Up's ID step must send."""
        signup_code = self.validated_data["signup_code"]
        signup_code.verified_at = timezone.now()
        signup_code.token = secrets.token_urlsafe(32)
        # The code itself is spent; the verification now lasts long enough for the ID step.
        signup_code.expires_at = signup_code.verified_at + timedelta(minutes=SignupEmailCode.VERIFIED_TTL_MINUTES)
        signup_code.save(update_fields=["verified_at", "token", "expires_at"])
        return signup_code.token



# Barangay Staff no longer has a free-text job title — every staff (and,
# now, Administrator) account picks exactly one of these at creation time
# (AdminCreateUserSerializer) or later (AdminAccountDetailView.patch's
# "Update Role"). Administrator isn't a separate account type anymore —
# picking it here just sets role=ADMIN alongside the rest of the position
# labels, which is what actually grants access to the Admin portal (see
# frontend/staff/js/main.js's ROLE_HOME + admin/js/admin.js's
# enforceAdminPortalAccess). Barangay Captain and Secretary are limited to
# one active holder at a time — see the uniqueness checks below and in
# AdminAccountDetailView.patch. Each role also determines which sections of
# the Staff Portal that account can see — see
# frontend/staff/js/admin.js's STAFF_NAV_ACCESS.
STAFF_ROLE_CHOICES = ["Barangay Captain", "Secretary", "Investigator", "Administrator"]
STAFF_ROLE_TO_ROLE_FIELD = {
    "Barangay Captain": User.Role.STAFF,
    "Secretary": User.Role.STAFF,
    "Investigator": User.Role.STAFF,
    "Administrator": User.Role.ADMIN,
}
UNIQUE_STAFF_ROLES = {"Barangay Captain", "Secretary"}


def validate_staff_role_uniqueness(staff_role, exclude_user=None):
    """Shared by account creation and Update Role — one active Barangay Captain/Secretary at a time."""
    if staff_role not in UNIQUE_STAFF_ROLES:
        return
    clash = User.objects.filter(position__iexact=staff_role, is_active=True)
    if exclude_user is not None:
        clash = clash.exclude(pk=exclude_user.pk)
    if clash.exists():
        raise serializers.ValidationError(
            f"There's already an active {staff_role}. Only one is allowed at a time."
        )


class AdminCreateUserSerializer(serializers.ModelSerializer):
    """
    Used by Administrators to create a Barangay Staff (or Administrator)
    account — just an email and a role. Created with no usable password:
    the staff member gets a one-time setup link by email and supplies their
    own name, phone and password from it (see accounts/setup_links.py and
    StaffAccountSetupSerializer). Pre-verified immediately — no voter's ID
    review needed, since an admin is vetting it directly rather than the
    person self-registering.
    """

    staff_role = serializers.ChoiceField(choices=STAFF_ROLE_CHOICES, write_only=True)

    class Meta:
        model = User
        fields = ["id", "email", "staff_role"]
        read_only_fields = ["id"]

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_staff_role(self, value):
        validate_staff_role_uniqueness(value)
        return value

    def create(self, validated_data):
        staff_role = validated_data.pop("staff_role")
        validated_data["username"] = validated_data["email"]
        validated_data["role"] = STAFF_ROLE_TO_ROLE_FIELD[staff_role]
        validated_data["position"] = staff_role
        validated_data["is_verified"] = True
        user = User(**validated_data)
        user.set_unusable_password()
        user.save()
        return user


class CitizenInviteSerializer(serializers.Serializer):
    """
    Administrator or Barangay Secretary creates a Barangay Citizen account from
    just an email. The citizen then finishes setup themselves (see
    CitizenSetupSerializer) using the code emailed to them — the same way a
    staff account is set up.
    """

    email = serializers.EmailField()

    def validate_email(self, value):
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def create(self, validated_data):
        email = validated_data["email"]
        user = User(email=email, username=email, role=User.Role.CITIZEN, is_verified=True)
        user.set_unusable_password()
        user.save()
        return user


class StaffCreateCitizenSerializer(serializers.ModelSerializer):
    """
    Administrator creates a Barangay Citizen account with the full details
    entered directly (name, email, phone, address) — unlike
    CitizenInviteSerializer, where the citizen fills those in themselves
    later. Pre-verified immediately, same as an invited citizen (staff is
    vouching for them in person). Created with no usable password, like
    every account someone else creates: the citizen gets a one-time setup
    link where they confirm these details and choose their own password
    (see accounts/setup_links.py and CitizenSetupSerializer).
    """

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
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_contact_number(self, value):
        value = clean_ph_mobile(value)
        if phone_already_used(value):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value

    def create(self, validated_data):
        validated_data["username"] = validated_data["email"]
        validated_data["role"] = User.Role.CITIZEN
        validated_data["is_verified"] = True
        user = User(**validated_data)
        user.set_unusable_password()
        user.save()
        return user


class AccountSetupPasswordMixin(serializers.Serializer):
    """
    The password half of first-login setup, shared by CitizenSetupSerializer
    and StaffAccountSetupSerializer. The password is checked in validate()
    rather than as a field validator so UserAttributeSimilarityValidator can
    compare it against the name being submitted in the same form — the
    account has no name on file yet for a Staff or invited citizen account.
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


class CitizenSetupSerializer(AccountSetupPasswordMixin, serializers.ModelSerializer):
    """The citizen's own setup step — the same details as sign-up, minus the voter's ID."""

    first_name = serializers.CharField(required=True)
    middle_initial = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=True)
    contact_number = serializers.CharField(required=True)
    address = serializers.CharField(required=True)

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "contact_number", "address", "password"]

    def validate_contact_number(self, value):
        value = clean_ph_mobile(value)
        if phone_already_used(value, exclude_user=self.instance):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value



class StaffAccountSetupSerializer(AccountSetupPasswordMixin, serializers.ModelSerializer):
    """
    Completes a Barangay Staff/Administrator account an admin created with
    just an email+role (see AdminCreateUserSerializer above) — the staff
    member supplies their own name, phone, and password on first login.
    Only ever called on an account that still has no usable password, via a
    valid setup link (see AccountSetupView) — role/position/email are set
    already and stay untouched here.
    """

    # first_name/last_name/contact_number are blank=True at the model level
    # (Django's AbstractUser default), which DRF would otherwise read as
    # "optional" — declared explicitly here since this step is exactly what
    # collects them, unlike ProfileUpdateSerializer where they're already set.
    first_name = serializers.CharField(required=True)
    middle_initial = serializers.CharField(required=False, allow_blank=True)
    last_name = serializers.CharField(required=True)
    contact_number = serializers.CharField(required=True)

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "contact_number", "password"]

    def validate_contact_number(self, value):
        value = clean_ph_mobile(value)
        if phone_already_used(value, exclude_user=self.instance):
            raise serializers.ValidationError("An account with this phone number already exists.")
        return value



class UserSerializer(serializers.ModelSerializer):
    """
    Read-only profile info — used by GET /api/auth/me/, and embedded in the
    login response so the navbar/topbar avatar has it immediately without a
    second request.
    """

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
        return obj.get_full_name() or obj.username

    def get_profile_picture(self, obj):
        if not obj.profile_picture:
            return None
        request = self.context.get("request")
        url = obj.profile_picture.url
        return request.build_absolute_uri(url) if request else url


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """
    Self-service editing for PATCH /api/auth/me/ (My Profile → Edit
    Information, all three portals). Deliberately excludes role/is_verified/
    position — those are admin-controlled elsewhere (Manage Accounts) — so a
    user can't escalate their own privileges through their own profile form.
    """

    class Meta:
        model = User
        fields = ["first_name", "middle_initial", "last_name", "email", "contact_number", "address", "profile_picture"]

    def validate_email(self, value):
        # Same case-insensitive check as sign-up, ignoring the account's own row.
        others = User.objects.filter(email__iexact=value)
        if self.instance is not None:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError("An account with this email already exists.")
        return value

    def validate_contact_number(self, value):
        return clean_ph_mobile(value)


class ChangePasswordSerializer(serializers.Serializer):
    """
    Self-service password change from My Profile → Edit Account Information →
    Change Password (all three portals) — POST /api/auth/change-password/.
    Requires the current password so a logged-in-but-unattended session
    can't be used to lock the real owner out.
    """

    current_password = serializers.CharField(write_only=True)
    # Not run via `validators=[validate_password]` on the field — that calls
    # validate_password(value) with no user, so UserAttributeSimilarityValidator
    # would have nothing to compare against. validate_new_password below
    # passes the real user instance instead, so "too similar to your name or
    # email" is actually enforced here (RegisterSerializer's password field
    # can't do this the same way since the user doesn't exist yet at that point).
    new_password = serializers.CharField(write_only=True)

    def validate_current_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Current password is incorrect.")
        return value

    def validate_new_password(self, value):
        validate_password(value, user=self.context["request"].user)
        return value

    def save(self):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save(update_fields=["password"])
        return user


class LinkPasswordSerializer(serializers.Serializer):
    """
    The new password chosen from an Administrator-sent reset link (see
    PasswordLinkConfirmView). context["user"] is the link's account, so the
    "too similar to your name or email" rule is checked against it.
    """

    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        user = self.context["user"]
        validate_password(value, user=user)
        if user.check_password(value):
            raise serializers.ValidationError("Choose a password different from your current one.")
        return value


class DeleteAccountSerializer(serializers.Serializer):
    """
    Self-service account deletion from My Profile (Citizen Portal only —
    see MeView.delete). Requires the current password, same reasoning as
    ChangePasswordSerializer — a logged-in-but-unattended session shouldn't
    be enough on its own to permanently delete the account.
    """

    password = serializers.CharField(write_only=True)

    def validate_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Incorrect password.")
        return value


class AdminAccountSerializer(serializers.ModelSerializer):
    """
    Shapes a User into exactly the fields the admin Manage Accounts page
    (frontend/admin/js/manage-accounts.js) already expects — owner/type/
    active/lastActiveLabel/etc — so that page's existing render/sort/filter
    logic works unchanged once it fetches from the API instead of the
    hardcoded ACCOUNTS array.
    """

    owner = serializers.SerializerMethodField()
    type = serializers.SerializerMethodField()
    # Whether the account can log in at all — what the Manage Accounts
    # Disable/Enable button actually controls. (Previously this field was
    # computed from last_login recency instead, which meant Disable never
    # visibly did anything: it flipped is_active correctly on the backend,
    # but the UI kept showing "Active" as long as the account had logged in
    # recently, regardless of is_active.)
    active = serializers.BooleanField(source="is_active", read_only=True)
    lastActiveLabel = serializers.SerializerMethodField()
    activityMinutes = serializers.SerializerMethodField()
    created = serializers.SerializerMethodField()
    createdAt = serializers.DateTimeField(source="date_joined", read_only=True)
    updated = serializers.SerializerMethodField()
    # True for a Staff/Administrator account an admin created (see
    # AdminCreateUserSerializer) that hasn't gone through first-login setup
    # (see StaffAccountSetupView) yet — Manage Accounts shows this instead
    # of Online/Offline so a still-pending account doesn't misleadingly
    # read as "Online" just because is_active defaults to True.
    setupPending = serializers.SerializerMethodField()
    position = serializers.CharField(read_only=True)
    # Citizen accounts only — how many reports/suggestions they've filed and
    # what state each is in, so the admin can gauge an account's activity
    # without leaving Manage Accounts. None for Staff/Admin accounts, which
    # don't file either.
    reportStats = serializers.SerializerMethodField()
    suggestionStats = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            "id", "owner", "email", "type", "active", "position",
            "lastActiveLabel", "activityMinutes", "created", "createdAt", "updated",
            "setupPending", "reportStats", "suggestionStats",
        ]

    def _status_breakdown(self, queryset):
        from django.db.models import Count
        counts = {row["status"]: row["count"] for row in queryset.values("status").annotate(count=Count("id"))}
        return {"total": sum(counts.values()), "byStatus": counts}

    def get_reportStats(self, obj):
        if obj.role != User.Role.CITIZEN:
            return None
        return self._status_breakdown(obj.reports.all())

    def get_suggestionStats(self, obj):
        if obj.role != User.Role.CITIZEN:
            return None
        return self._status_breakdown(obj.concerns.all())

    def get_setupPending(self, obj):
        return not obj.has_usable_password()

    def get_owner(self, obj):
        return obj.get_full_name() or obj.username

    def get_type(self, obj):
        if obj.role == User.Role.ADMIN:
            return "Administrator"
        if obj.role == User.Role.CITIZEN:
            return "Barangay Citizen"
        return obj.position or "Barangay Staff"

    def _minutes_since(self, moment):
        from django.utils import timezone
        if not moment:
            return None
        delta = timezone.now() - moment
        return max(int(delta.total_seconds() // 60), 0)

    def get_activityMinutes(self, obj):
        minutes = self._minutes_since(obj.last_login)
        # Never-logged-in accounts sort to the end of "Most Recently Active"
        # rather than floating to the top as if they were just active.
        return minutes if minutes is not None else 10**9

    def get_lastActiveLabel(self, obj):
        from django.utils.timesince import timesince
        if not obj.last_login:
            return "Never logged in"
        return f"{timesince(obj.last_login)} ago"

    def get_created(self, obj):
        from django.utils.timesince import timesince
        return f"{timesince(obj.date_joined)} ago"

    def get_updated(self, obj):
        from django.utils.timesince import timesince
        return f"{timesince(obj.updated_at)} ago"


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
    # Which portal the login came from. Citizens and Barangay Officials each
    # have their own login page; the other kind is refused there, after the
    # password is checked (so a wrong guess still counts toward the lockout).
    portal = serializers.ChoiceField(choices=["citizen", "staff"], required=False, write_only=True)

    # A wrong password and an email with no account get the same message, so
    # the login form can't be used to check whether an email is registered.
    default_error_messages = {"no_active_account": "Incorrect email or password."}

    WRONG_PORTAL = {
        # Citizen-portal side is deliberately indistinguishable from a wrong
        # password — a descriptive "that's a staff/admin account" message
        # would let anyone probe which emails have elevated access just by
        # trying them on the citizen login form. Staff Portal doesn't have
        # that exposure the other way (a citizen email isn't sensitive the
        # same way), so it keeps the more helpful message.
        "citizen": (
            {User.Role.STAFF, User.Role.ADMIN},
            "Incorrect email or password.",
            "no_active_account",
        ),
        "staff": (
            {User.Role.CITIZEN},
            "Citizen accounts can't log in here. Please use the citizen portal.",
            "wrong_portal",
        ),
    }

    """
    Extends SimpleJWT's login serializer so the token payload — and the
    login response body — includes role/name. This lets the frontend route
    the user to the right portal page and greet them by name without a
    second request right after login.
    """

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["role"] = user.role
        token["name"] = user.get_full_name() or user.username
        return token

    def validate(self, attrs):
        # Lockout (see accounts/lockout.py). A locked account is refused before
        # the password is even checked, so a correct guess mid-lock doesn't get in.
        # Inactive accounts are skipped — they can't log in anyway, and an admin
        # disable shouldn't also send "you've been locked" emails.
        account = User.objects.filter(email__iexact=attrs.get(self.username_field, "")).first()
        if account and not account.is_active:
            account = None
        if account:
            remaining = lockout_minutes_remaining(account)
            if remaining:
                raise AuthenticationFailed(_locked_message(remaining), code="account_locked")

        # An account someone else created that hasn't been set up yet has no
        # password to check — point the person at their setup link instead of
        # reporting a wrong password. Skipped where the portal would refuse
        # that role anyway, so the citizen login can't reveal staff emails.
        portal_refuses = attrs.get("portal") in self.WRONG_PORTAL and account and (
            account.role in self.WRONG_PORTAL[attrs["portal"]][0]
        )
        if account and not account.has_usable_password() and not portal_refuses:
            raise AuthenticationFailed(SETUP_PENDING_MESSAGE, code="setup_pending")

        try:
            data = super().validate(attrs)
        except AuthenticationFailed:
            if account and record_failed_login(account):
                raise AuthenticationFailed(_locked_message(LOCKOUT_MINUTES), code="account_locked")
            # A wrong password on a real account and an email with no account
            # both end here with the same "Incorrect email or password."
            # (default_error_messages above), so the message never tells
            # which of the two was wrong.
            raise
        if account:
            clear_failed_logins(account)

        portal = attrs.get("portal")
        if portal in self.WRONG_PORTAL and self.user.role in self.WRONG_PORTAL[portal][0]:
            _, message, code = self.WRONG_PORTAL[portal]
            raise AuthenticationFailed(message, code=code)

        # Citizens start unverified until an Administrator approves their
        # voter's ID (see AdminApproveVerificationView). Staff/Admin accounts
        # are created pre-verified, so this only ever blocks citizens.
        if not self.user.is_verified:
            raise AuthenticationFailed(
                "Your account is still under verification. Please try again later.",
                code="account_unverified",
            )

        # LoginSession tracks the open/closed session itself (see LogoutView);
        # log_action is the separate "Logged in" row shown on View Audit Logs.
        LoginSession.objects.create(user=self.user)
        log_action(self.user, "Logged in")

        data["user"] = UserSerializer(self.user, context=self.context).data
        return data


class PasswordResetRequestSerializer(serializers.Serializer):
    """Forgot Password step 1 — emails a fresh 6-digit code to the account, if there is one."""

    email = serializers.EmailField()

    def validate_email(self, value):
        # Deliberately not an error when nothing matches: "No account found with
        # that email" let anyone check whether a given person is registered.
        # The caller answers the same either way (see PasswordResetRequestView).
        self._user = User.objects.filter(email__iexact=value).first()
        return value

    def save(self):
        if self._user is None:
            return
        # Invalidate any earlier unused codes so only the one just emailed works.
        PasswordResetCode.objects.filter(user=self._user, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        code = generate_code()
        PasswordResetCode.objects.create(
            user=self._user,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=PasswordResetCode.CODE_TTL_MINUTES),
        )
        send_password_reset_email(self._user, code, PasswordResetCode.CODE_TTL_MINUTES)


class PasswordResetVerifySerializer(serializers.Serializer):
    """Forgot Password step 2 — Input Code checks the code before step 3."""

    email = serializers.EmailField()
    code = serializers.CharField()

    def validate(self, attrs):
        # Only the newest unused code can be guessed at, and every wrong guess
        # counts against it (see orms_backend/codes.py) — matching on the
        # submitted code in the query instead would let unlimited guesses through.
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
    """Forgot Password step 3 — Reset Password actually sets the new password."""

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
        # Completing a reset proves control of the email, so it also lifts a
        # failed-login lock (see accounts/lockout.py).
        clear_failed_logins(user)


class PendingVerificationSerializer(serializers.ModelSerializer):
    """
    Shapes a VoterVerification into what the admin Approve Accounts page
    (frontend/admin/js/approve-accounts.js) expects — owner/email/type/
    photoUrl/created — mirroring how AdminAccountSerializer shapes accounts
    for the Manage Accounts page.
    """

    owner = serializers.SerializerMethodField()
    email = serializers.EmailField(source="user.email", read_only=True)
    type = serializers.SerializerMethodField()
    photoUrl = serializers.SerializerMethodField()
    created = serializers.SerializerMethodField()

    class Meta:
        model = VoterVerification
        fields = ["id", "owner", "email", "type", "photoUrl", "created"]

    def get_owner(self, obj):
        return obj.user.get_full_name() or obj.user.username

    def get_type(self, obj):
        if obj.user.role == User.Role.ADMIN:
            return "Administrator"
        if obj.user.role == User.Role.CITIZEN:
            return "Barangay Citizen"
        return obj.user.position or "Barangay Staff"

    def get_photoUrl(self, obj):
        request = self.context.get("request")
        url = obj.voter_id_image.url
        return request.build_absolute_uri(url) if request else url

    def get_created(self, obj):
        from django.utils.timesince import timesince
        return f"{timesince(obj.created_at)} ago"


class AuditLogSerializer(serializers.ModelSerializer):
    """Shapes an AuditLog row for the admin View Audit Logs page."""

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

    def get_owner(self, obj):
        # Snapshotted at write time (see AuditLog.owner_name/log_action), so
        # this stays correct even after the account is deleted. Entries from
        # before that field existed fall back to a live lookup, same as before.
        if obj.owner_name:
            return obj.owner_name
        if not obj.user:
            return "Deleted account"
        return obj.user.get_full_name() or obj.user.username

    def get_type(self, obj):
        if obj.owner_type:
            return obj.owner_type
        if not obj.user:
            return "—"
        return account_type_label(obj.user)

    def get_timeLabel(self, obj):
        from django.utils import timezone
        return timezone.localtime(obj.created_at).strftime("%H:%M:%S %m/%d/%Y")
