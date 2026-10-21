from datetime import timedelta

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, serializers
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from orms_backend.codes import CODE_EXHAUSTED, CODE_OK, check_code, generate_code
from orms_backend.emails import (
    send_account_approved_email,
    send_account_created_admin_emails,
    send_account_deactivated_email,
    send_account_deleted_email,
    send_account_rejected_email,
    send_account_self_deleted_email,
    send_profile_edit_code_email,
)

from .lockout import clear_failed_logins
from .models import (
    AuditLog,
    LoginSession,
    ProfileEditVerificationCode,
    User,
    VoterVerification,
    log_action,
)
from .serializers import (
    AccountAvailabilityCheckSerializer,
    AdminAccountSerializer,
    CitizenInviteSerializer,
    CitizenSetupSerializer,
    AdminCreateUserSerializer,
    AuditLogSerializer,
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    DeleteAccountSerializer,
    LinkPasswordSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PendingVerificationSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    SignupCodeRequestSerializer,
    SignupCodeVerifySerializer,
    STAFF_ROLE_CHOICES,
    STAFF_ROLE_TO_ROLE_FIELD,
    StaffAccountSetupSerializer,
    StaffCreateCitizenSerializer,
    UserSerializer,
    validate_staff_role_uniqueness,
)
from .setup_links import (
    can_receive_reset_link,
    is_pending_setup,
    pending_user_for_link,
    send_reset_link,
    send_setup_link,
    user_for_reset_link,
    user_from_uid,
)
from .throttles import ResetRequestEmailThrottle, SignupCodeEmailThrottle


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — public citizen signup."""
    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def perform_create(self, serializer):
        user = serializer.save()
        admins = User.objects.filter(role=User.Role.ADMIN, is_active=True)
        send_account_created_admin_emails(user, admins)


class SignupCodeRequestView(APIView):
    """POST /api/auth/signup/request-code/ — Sign Up: emails a 6-digit code before the ID step."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle, SignupCodeEmailThrottle]
    throttle_scope = "signup_code"

    def post(self, request):
        serializer = SignupCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "We've emailed a 6-digit code to that address."})


class SignupCodeVerifyView(APIView):
    """POST /api/auth/signup/verify-code/ — checks the code; returns the token /register/ needs."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "signup_verify"

    def post(self, request):
        serializer = SignupCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({"email_verification_token": serializer.save()})


class CheckAccountAvailabilityView(APIView):
    """POST /api/auth/check-availability/ — see AccountAvailabilityCheckSerializer."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def post(self, request):
        serializer = AccountAvailabilityCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({})


class PasswordResetRequestView(APIView):
    """POST /api/auth/password-reset/request/ — Forgot Password: emails a 6-digit code."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle, ResetRequestEmailThrottle]
    throttle_scope = "reset_request"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Same answer whether or not the email has an account, so this can't be
        # used to find out who is registered.
        return Response({"detail": "If an account exists for that email, we've sent a reset code to it."})


class PasswordResetVerifyView(APIView):
    """POST /api/auth/password-reset/verify/ — Input Code: checks the code is valid."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reset_verify"

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Code verified."})


class PasswordResetConfirmView(APIView):
    """POST /api/auth/password-reset/confirm/ — Reset Password: sets the new password."""
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "reset_confirm"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been reset."})


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ — returns access + refresh JWT tokens plus user info."""
    serializer_class = CustomTokenObtainPairSerializer
    # Per IP; the per-account failed-login lockout (accounts/lockout.py) covers
    # guessing at one account, this covers one source trying many.
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(APIView):
    """
    POST /api/auth/logout/ — closes out the caller's most recent open
    LoginSession (see CustomTokenObtainPairSerializer), so View Audit Logs
    shows when they actually logged out instead of leaving it blank.
    Doesn't invalidate the JWT itself (no token blacklist app installed) —
    the frontend still just discards the tokens client-side.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        session = (
            LoginSession.objects.filter(user=request.user, logged_out_at__isnull=True)
            .order_by("-logged_in_at")
            .first()
        )
        if session:
            from django.utils import timezone
            session.logged_out_at = timezone.now()
            session.save(update_fields=["logged_out_at"])
        log_action(request.user, "Logged out")
        return Response({"detail": "Logged out."})


def _setup_details(user):
    # What the setup page pre-fills: blank for a Staff/Administrator account or
    # an invited citizen, already filled in for a citizen an Administrator
    # created with their details (they can still correct anything).
    return {
        "email": user.email,
        "role": user.role,
        "first_name": user.first_name,
        "middle_initial": user.middle_initial,
        "last_name": user.last_name,
        "contact_number": user.contact_number,
        "address": user.address,
    }


SETUP_LINK_INVALID = "This setup link has expired or has already been used."


class AccountSetupCheckView(APIView):
    """
    POST /api/auth/account-setup/check/ — the setup page opens with this:
    given the uid+token from an emailed setup link (see
    accounts/setup_links.py), returns the account's details to pre-fill, or
    400 if the link is expired, already used, or replaced by a newer one.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_setup"

    def post(self, request):
        user = pending_user_for_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": SETUP_LINK_INVALID}, status=400)
        return Response(_setup_details(user))


class AccountSetupView(APIView):
    """
    POST /api/auth/account-setup/ — the first-login screen's submit: the
    owner of an account someone else created confirms their details and
    chooses their own password, using the uid+token from the emailed setup
    link. Logs them straight in afterward — same response shape as
    LoginView — so the frontend reuses its normal post-login redirect.
    Completing setup sets a usable password, which is also what kills the
    link (see accounts/setup_links.py), so it can't be replayed.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_setup"

    def post(self, request):
        user = pending_user_for_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": SETUP_LINK_INVALID}, status=400)

        setup_serializer = CitizenSetupSerializer if user.role == User.Role.CITIZEN else StaffAccountSetupSerializer
        serializer = setup_serializer(user, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        LoginSession.objects.create(user=user)
        log_action(user, "Completed account setup and logged in")

        refresh = CustomTokenObtainPairSerializer.get_token(user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user, context={"request": request}).data,
        })


class AccountSetupLinkRequestView(APIView):
    """
    POST /api/auth/account-setup/request-link/ — emails a fresh setup link
    (and kills every older one) to an account still waiting on setup. Takes
    either `email` (typed on the setup page) or `uid` (the "Email me a new
    link" button on an expired link, which still knows whose it was).

    Always answers identically whether or not anything was sent, so it can't
    be used to find out which emails have accounts. The link only ever goes
    to the account's own inbox, so asking for one gets a stranger nothing.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle, ResetRequestEmailThrottle]
    throttle_scope = "account_setup_link"

    def post(self, request):
        email = str(request.data.get("email") or "").strip()
        if email:
            user = User.objects.filter(email__iexact=email).first()
        else:
            user = user_from_uid(request.data.get("uid"))
        if is_pending_setup(user):
            send_setup_link(user)
        return Response({
            "detail": "If that account is waiting to be set up, we've emailed it a new setup link."
        })


class ProfileEditCodeRequestView(APIView):
    """
    POST /api/auth/profile-edit/request-code/ — emails a 6-digit code to the
    logged-in user's current email. MeView.patch requires it whenever
    email/contact_number/address is actually changing (a profile picture
    change alone doesn't need it).
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "profile_edit_code"

    def post(self, request):
        user = request.user
        ProfileEditVerificationCode.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
        code = generate_code()
        ProfileEditVerificationCode.objects.create(
            user=user,
            code=code,
            expires_at=timezone.now() + timedelta(minutes=ProfileEditVerificationCode.CODE_TTL_MINUTES),
        )
        send_profile_edit_code_email(user, code, ProfileEditVerificationCode.CODE_TTL_MINUTES)
        return Response({"detail": "We've emailed a verification code to your account's email address."})


class MeView(APIView):
    """
    GET /api/auth/me/ — the logged-in user's own profile (requires Bearer token).
    PATCH /api/auth/me/ — edits it (My Profile → Edit Information, all three
    portals) — name/email/contact/address/profile picture only, see
    ProfileUpdateSerializer for why role/position/is_verified aren't here.

    Changing email/contact_number/address requires a `verification_code`
    from ProfileEditCodeRequestView (a profile picture change alone doesn't)
    — proves whoever's doing this still controls the inbox on file before
    letting them change contact details, same reasoning as Forgot Password's
    code (see orms_backend/codes.py).
    """
    permission_classes = [permissions.IsAuthenticated]

    # Fields whose change needs a freshly verified code — not first/last
    # name (ProfileUpdateSerializer already blocks those outright) or
    # profile_picture (low-stakes, and blocking it on an inbox check would
    # just be friction for friction's sake).
    SENSITIVE_FIELDS = ("email", "contact_number", "address")

    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def _sensitive_fields_changing(self, user, data):
        return any(
            field in data and str(data[field]).strip() != (getattr(user, field) or "")
            for field in self.SENSITIVE_FIELDS
        )

    def patch(self, request):
        user = request.user

        if self._sensitive_fields_changing(user, request.data):
            submitted_code = str(request.data.get("verification_code") or "").strip()
            if not submitted_code:
                return Response(
                    {
                        "detail": "Enter the verification code sent to your email to save these changes.",
                        "code_required": True,
                    },
                    status=400,
                )
            code_obj = (
                ProfileEditVerificationCode.objects.filter(user=user, used_at__isnull=True)
                .order_by("-created_at")
                .first()
            )
            if not code_obj or not code_obj.is_valid():
                return Response(
                    {"detail": "That code has expired. Request a new one.", "code_required": True}, status=400
                )
            result = check_code(code_obj, submitted_code)
            if result == CODE_EXHAUSTED:
                return Response(
                    {"detail": "Too many incorrect attempts. Request a new code.", "code_required": True}, status=400
                )
            if result != CODE_OK:
                return Response({"detail": "That code is incorrect."}, status=400)
            code_obj.expire()

        serializer = ProfileUpdateSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(user, context={"request": request}).data)

    def delete(self, request):
        """
        DELETE /api/auth/me/ — My Profile → Delete Account, Citizen Portal
        only (AdminAccountDetailView.delete already covers Staff/Admin
        removal, with its own last-admin/claimed-reports handling that a
        generic self-delete here doesn't account for). Requires the current
        password (see DeleteAccountSerializer). The citizen's
        Reports/Concerns/Questions are kept — their link to User is SET_NULL
        and accounts/signals.py copies the name onto each one first.
        """
        if request.user.role != User.Role.CITIZEN:
            return Response({"detail": "Only a citizen account can be deleted this way."}, status=403)

        serializer = DeleteAccountSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        user = request.user
        name = user.get_full_name() or user.username
        email = user.email
        with transaction.atomic():
            log_action(user, "Deleted own account")
            user.delete()
        send_account_self_deleted_email(name, email)
        return Response(status=204)


class ChangePasswordView(APIView):
    """POST /api/auth/change-password/ — My Profile → Edit Account Information → Change Password, all three portals."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been changed."})


class IsAdmin(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == User.Role.ADMIN)


class IsStaffOrAdmin(permissions.BasePermission):
    """
    For endpoints Barangay Officials also need access to (e.g. reviewing
    reports, once that module exists) — Administrators pass this check too,
    since they can do everything Staff can plus account management.
    """

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.role in (User.Role.STAFF, User.Role.ADMIN)
        )


class IsInvestigatorOrAdmin(permissions.BasePermission):
    """
    Reports is the Investigator's section of the Staff Portal (claim/work a
    report, change its status) — Barangay Captain and Secretary only get a
    read-only Reports Dashboard, so their write attempts on a report are
    rejected here rather than just hidden client-side.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == User.Role.ADMIN or (user.role == User.Role.STAFF and user.position == "Investigator")


class IsSecretaryOrAdmin(permissions.BasePermission):
    """
    Concerns/Suggestions and Ordinances are the Secretary's sections of the
    Staff Portal — Barangay Captain only gets read-only dashboards/views of
    both, so their write attempts are rejected here too.
    """

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == User.Role.ADMIN or (user.role == User.Role.STAFF and user.position == "Secretary")


class IsAnnouncementManager(permissions.BasePermission):
    """Secretary or Administrator — who may post/edit/delete Announcements."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == User.Role.ADMIN or (user.role == User.Role.STAFF and user.position == "Secretary")


class IsDocumentManager(permissions.BasePermission):
    """Secretary or Administrator — who may create/edit/archive ordinances."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == User.Role.ADMIN or (user.role == User.Role.STAFF and user.position == "Secretary")


class AdminCreateUserView(generics.CreateAPIView):
    """
    POST /api/auth/admin/create-user/ — Administrator-only endpoint for
    creating a Barangay Staff (or Administrator) account with just an
    email + role. The staff member gets a one-time setup link by email and
    fills in their own name, phone and password from it (see
    accounts/setup_links.py and AccountSetupView).
    """
    queryset = User.objects.all()
    serializer_class = AdminCreateUserSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Created a {user.position} account for {user.email}")


class AdminInviteCitizenView(generics.CreateAPIView):
    """
    POST /api/auth/admin/create-citizen/ — Administrator or Barangay Secretary
    creates a Barangay Citizen account from just an email. The citizen gets a
    one-time setup link by email and finishes the account themselves.
    """
    queryset = User.objects.all()
    serializer_class = CitizenInviteSerializer
    permission_classes = [IsSecretaryOrAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Invited a Barangay Citizen account for {user.email}")


class StaffCreateCitizenView(generics.CreateAPIView):
    """
    POST /api/auth/admin/create-citizen-direct/ — Administrator creates a
    Barangay Citizen account with the full details entered directly (see
    StaffCreateCitizenSerializer), rather than just inviting by email
    (AdminInviteCitizenView above). The citizen still gets a one-time setup
    link, where they confirm those details and choose their own password —
    no password is generated or emailed. Admin-only — the
    Barangay Secretary used to have this too, but that's been removed.
    """
    queryset = User.objects.all()
    serializer_class = StaffCreateCitizenSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Created a Barangay Citizen account for {user.email}")


class AdminListUsersView(generics.ListAPIView):
    """
    GET /api/auth/admin/users/ — Administrator Module: Manage Accounts list.
    Shaped to match frontend/admin/js/manage-accounts.js's expected fields
    directly (see AdminAccountSerializer), so that page's existing render/
    sort/filter code works unchanged once wired to this endpoint.
    """
    queryset = User.objects.all().order_by("-date_joined")
    serializer_class = AdminAccountSerializer
    permission_classes = [IsAdmin]


def _active_claims(holder):
    """
    The reports `holder` has claimed that are still being worked — anything
    but Resolved/With Remarks (Report.CLOSED_STATUSES). A closed report keeps
    its Investigator's name as the record of who handled it, so only these
    ever need releasing.
    """
    from reports.models import Report

    return holder.claimed_reports.exclude(status__in=Report.CLOSED_STATUSES)


def _release_claims(actor, holder, reason):
    """
    Frees every active report `holder` has claimed (see _active_claims) so
    another Investigator can claim it, writing one audit log entry per
    report under the Administrator who did it. Required before an account
    holding active claims has its role changed, is disabled, or is deleted.
    Returns how many were freed.
    """
    holder_name = holder.get_full_name() or holder.username
    claimed = list(_active_claims(holder))
    for report in claimed:
        report.assigned_investigator = None
        report.previous_investigator = holder
        report.save(update_fields=["assigned_investigator", "previous_investigator"])
        log_action(actor, f"Released {holder_name}'s claim on a report — {report.ordinance} ({reason})")
    return len(claimed)


def _claims_note(count):
    if not count:
        return ""
    noun = "report" if count == 1 else "reports"
    return f" — {count} claimed {noun} released"


def _claims_block_response(user, action):
    """400 for a role change/disable sent without release_claims while `user` still holds active claims."""
    count = _active_claims(user).count()
    name = user.get_full_name() or user.username
    noun = "report" if count == 1 else "reports"
    return Response(
        {
            "detail": f"{name} still has {count} active claimed {noun}. Release them before {action}.",
            "active_claims": count,
        },
        status=400,
    )


class AdminAccountDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET/PATCH/DELETE /api/auth/admin/users/<id>/ — backs the Manage Accounts
    "Edit Account" modal: viewing details, toggling active/disabled,
    changing account type (role/position), and deleting the account all go
    through here.

    Claimed reports: an account still holding active claims (see
    _active_claims) can't be disabled or have its role changed until they're
    released — the request must send `release_claims: true`, which frees
    them first in the same transaction, or it's refused with a 400 naming
    how many are left. Deleting always frees them first. Either way the
    audit log records who did it and each released claim.
    """
    queryset = User.objects.all()
    serializer_class = AdminAccountSerializer
    permission_classes = [IsAdmin]

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        user = self.get_object()
        is_self = user.id == request.user.id
        was_active = user.is_active
        release_requested = bool(request.data.get("release_claims"))
        has_active_claims = _active_claims(user).exists()
        release_needed = False

        # Prevent an admin from disabling their own account — a simple
        # mis-click here would otherwise lock them out instantly (is_active
        # is checked on every request, not just at login) with no one else
        # necessarily around to undo it.
        if "active" in request.data:
            new_active = bool(request.data["active"])
            if is_self and not new_active:
                return Response(
                    {"detail": "You can't disable your own account."},
                    status=400,
                )
            if was_active and not new_active and has_active_claims:
                if not release_requested:
                    return _claims_block_response(user, "disabling this account")
                release_needed = True
            user.is_active = new_active

        # Update Role — only ever offered for existing Barangay Staff/
        # Administrator accounts (see manage-accounts.js), never Citizens,
        # and only ever one of the 4 staff roles (Barangay Captain/Secretary/
        # Investigator/Administrator — see STAFF_ROLE_CHOICES).
        if "staff_role" in request.data:
            staff_role = request.data["staff_role"]
            if staff_role not in STAFF_ROLE_CHOICES:
                return Response({"detail": "Invalid role."}, status=400)
            if user.role not in (User.Role.STAFF, User.Role.ADMIN):
                return Response(
                    {"detail": "Only Barangay Staff accounts can have their role changed."}, status=400
                )
            if is_self:
                return Response({"detail": "You can't change your own role."}, status=400)

            new_role = STAFF_ROLE_TO_ROLE_FIELD[staff_role]

            # Prevent removing Admin permissions from the last remaining
            # admin account — would leave the system with no one able to
            # manage accounts at all.
            if user.role == User.Role.ADMIN and new_role != User.Role.ADMIN:
                if User.objects.filter(role=User.Role.ADMIN).count() <= 1:
                    return Response(
                        {"detail": "Can't remove the last remaining Administrator."}, status=400
                    )

            try:
                validate_staff_role_uniqueness(staff_role, exclude_user=user)
            except serializers.ValidationError as exc:
                return Response({"detail": exc.detail[0]}, status=400)

            # Re-saving the role they already have changes nothing, so it
            # doesn't need their claims released.
            if staff_role != user.position and has_active_claims:
                if not release_requested:
                    return _claims_block_response(user, "changing this account's role")
                release_needed = True

            user.role = new_role
            user.position = staff_role

        # Every check above has passed, so the claims are released only when
        # the change itself is actually going through.
        released = 0
        if release_needed:
            reason = "account disabled" if "active" in request.data and not user.is_active else "role changed"
            released = _release_claims(request.user, user, reason)

        user.save()

        name = user.get_full_name() or user.username
        if "active" in request.data:
            if user.is_active:
                log_action(request.user, f"Enabled {name}'s account")
            else:
                log_action(request.user, f"Disabled {name}'s account{_claims_note(released)}")
                send_account_deactivated_email(user)
        if "staff_role" in request.data:
            role_note = "" if "active" in request.data else _claims_note(released)
            log_action(request.user, f"Changed {name}'s role to {user.position}{role_note}")

        return Response(AdminAccountSerializer(user).data)

    def delete(self, request, *args, **kwargs):
        user = self.get_object()

        if user.id == request.user.id:
            return Response({"detail": "You can't delete your own account."}, status=400)

        if user.role == User.Role.ADMIN and User.objects.filter(role=User.Role.ADMIN).count() <= 1:
            return Response({"detail": "Can't remove the last remaining Administrator."}, status=400)

        name = user.get_full_name() or user.username
        email = user.email
        # Active claims are released first, explicitly (rather than left to
        # SET_NULL), so each freed report gets its own audit entry naming who
        # deleted the account.
        with transaction.atomic():
            claim_count = _release_claims(request.user, user, "account deleted")
            log_action(request.user, f"Deleted {name}'s account{_claims_note(claim_count)}")
            user.delete()
        send_account_deleted_email(name, email)
        return Response(status=204)


class AdminListPendingVerificationsView(generics.ListAPIView):
    """
    GET /api/auth/admin/verifications/ — Administrator Module: Approve
    Accounts list. Only accounts still awaiting review show up here;
    approved/rejected ones drop off (rejection deletes the account, see
    AdminRejectVerificationView).
    """
    queryset = (
        VoterVerification.objects.filter(status=VoterVerification.Status.PENDING)
        .select_related("user")
        .order_by("created_at")
    )
    serializer_class = PendingVerificationSerializer
    permission_classes = [IsAdmin]

    def get_serializer_context(self):
        # photoUrl needs the request to build an absolute URL for local
        # (non-Cloudinary) dev, where FileField.url is just "/media/...".
        return {"request": self.request}


class AdminApproveVerificationView(APIView):
    """POST /api/auth/admin/verifications/<id>/approve/ — marks the account verified."""
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        verification = get_object_or_404(
            VoterVerification, pk=pk, status=VoterVerification.Status.PENDING
        )
        verification.status = VoterVerification.Status.APPROVED
        verification.reviewed_by = request.user
        verification.reviewed_at = timezone.now()
        verification.save()
        verification.user.is_verified = True
        verification.user.save(update_fields=["is_verified"])
        send_account_approved_email(verification.user)
        name = verification.user.get_full_name() or verification.user.username
        log_action(request.user, f"Approved {name}'s account")
        return Response({"detail": "Account approved."})


class AdminRejectVerificationView(APIView):
    """
    POST /api/auth/admin/verifications/<id>/reject/ — requires a `reason`
    (what was wrong, e.g. an unreadable ID photo), emails it to the
    applicant, then deletes the pending account outright. Deleting (rather
    than keeping a permanently-rejected row around) is what gives them
    "another chance" — it frees up their email/username so they can just
    sign up again once they've fixed whatever was wrong.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        verification = get_object_or_404(
            VoterVerification, pk=pk, status=VoterVerification.Status.PENDING
        )
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response(
                {"detail": "Please provide a reason for rejecting this account."}, status=400
            )
        user = verification.user
        name = user.get_full_name() or user.username
        send_account_rejected_email(name, user.email, reason)
        user.delete()
        log_action(request.user, f"Rejected {name}'s account (reason: {reason})")
        return Response({"detail": "Account rejected."})


class AdminListAuditLogsView(generics.ListAPIView):
    """GET /api/auth/admin/audit-logs/ — Administrator Module: View Audit Logs."""
    queryset = AuditLog.objects.select_related("user").order_by("-created_at")
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdmin]


class AdminResendSetupLinkView(APIView):
    """
    POST /api/auth/admin/users/<id>/resend-setup-link/ — Manage Accounts'
    "Resend Setup Link" (shown only while the account is Setup Pending, any
    account type). Emails a fresh one-time setup link and kills older ones.
    Refused once the account is set up, so it can't be used to knock a
    working account back to no password.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if not is_pending_setup(user):
            return Response({"detail": "This account has already been set up."}, status=400)
        send_setup_link(user)
        log_action(request.user, f"Resent the account setup link to {user.email}")
        return Response({"detail": f"A new setup link has been emailed to {user.email}."})


class AdminResetPasswordView(APIView):
    """
    POST /api/auth/admin/users/<id>/reset-password/ — Manage Accounts'
    "Reset Password", for Barangay Staff/Administrator accounts that are
    already set up: emails the owner a one-time link to choose a new
    password (see accounts/setup_links.py's send_reset_link). The
    Administrator never sees or sets the password, and the current one
    keeps working until the link is used. Citizens use Forgot Password.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        if user.role == User.Role.CITIZEN:
            return Response(
                {"detail": "Citizens reset their own password with Forgot Password on the login page."}, status=400
            )
        if is_pending_setup(user):
            return Response({"detail": "This account hasn't been set up yet. Use Resend Setup Link instead."}, status=400)
        if user == request.user:
            return Response({"detail": "Change your own password from My Profile instead."}, status=400)
        if not can_receive_reset_link(user):
            return Response({"detail": "Enable this account before resetting its password."}, status=400)
        send_reset_link(user)
        log_action(request.user, f"Sent a password reset link to {user.email}")
        return Response({"detail": f"A password reset link has been emailed to {user.email}."})


RESET_LINK_INVALID = "This password reset link has expired or has already been used. Ask an Administrator for a new one."


class PasswordLinkCheckView(APIView):
    """
    POST /api/auth/password-link/check/ — staff/new-password.html opens with
    this: is the emailed reset link (uid+token) still valid? Returns the
    account's email (for the "too similar to your email" check) or 400.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_setup"

    def post(self, request):
        user = user_for_reset_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": RESET_LINK_INVALID}, status=400)
        return Response({"email": user.email, "first_name": user.first_name, "last_name": user.last_name})


class PasswordLinkConfirmView(APIView):
    """
    POST /api/auth/password-link/ — sets the new password from a valid reset
    link. Doesn't log in: the person goes on to the normal login page, same
    as the end of Forgot Password. Also lifts any failed-login lock, since
    using the link proves control of the inbox (see accounts/lockout.py).
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "account_setup"

    def post(self, request):
        user = user_for_reset_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": RESET_LINK_INVALID}, status=400)
        serializer = LinkPasswordSerializer(data=request.data, context={"user": user})
        serializer.is_valid(raise_exception=True)
        user.set_password(serializer.validated_data["password"])
        user.save(update_fields=["password"])
        clear_failed_logins(user)
        log_action(user, "Reset password from an Administrator's reset link")
        return Response({"detail": "Your password has been reset."})
