from datetime import timedelta

from django.contrib.auth.tokens import default_token_generator
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
    send_staff_setup_code_email,
)

from .models import (
    AuditLog,
    LoginSession,
    PasswordResetCode,
    ProfileEditVerificationCode,
    User,
    VoterVerification,
    log_action,
)
from .serializers import (
    AdminAccountSerializer,
    CitizenInviteSerializer,
    CitizenSetupSerializer,
    AdminCreateUserSerializer,
    AuditLogSerializer,
    ChangePasswordSerializer,
    CustomTokenObtainPairSerializer,
    DeleteAccountSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PasswordResetVerifySerializer,
    PendingVerificationSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    STAFF_ROLE_CHOICES,
    STAFF_ROLE_TO_ROLE_FIELD,
    StaffAccountSetupSerializer,
    UserSerializer,
    validate_staff_role_uniqueness,
)
from .throttles import ResetRequestEmailThrottle


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


def _pending_setup_account(email):
    """The Staff, Administrator, or Barangay Citizen account an admin or secretary created that's still waiting on setup, or None."""
    user = User.objects.filter(
        email__iexact=(email or "").strip(), role__in=[User.Role.STAFF, User.Role.ADMIN, User.Role.CITIZEN]
    ).first()
    return user if user and not user.has_usable_password() else None


def _send_setup_code(user, with_setup_link=False):
    # Same as Forgot Password: only the newest code works.
    PasswordResetCode.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
    code = generate_code()
    PasswordResetCode.objects.create(
        user=user,
        code=code,
        expires_at=timezone.now() + timedelta(minutes=PasswordResetCode.CODE_TTL_MINUTES),
    )
    send_staff_setup_code_email(user, code, PasswordResetCode.CODE_TTL_MINUTES, with_setup_link=with_setup_link)


class StaffAccountSetupCodeRequestView(APIView):
    """
    POST /api/auth/staff-setup/request-code/ — step 1 of first-login setup:
    emails a 6-digit code to a Staff/Administrator account an admin created and
    that's still waiting on setup. The code then goes through the ordinary
    password-reset/verify/ step, and StaffAccountSetupView refuses to set a
    password without a verified one.

    Why the code exists: an admin-created account has no password, so before this
    anyone who knew or guessed the email could type it in, choose a password,
    and be logged in as that account — an Administrator's, if that's the role
    it was created with. Now the person has to be able to read that inbox.

    Always answers identically whether or not the email matches a pending
    account, so this can't be used to find out which staff emails exist.
    """

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle, ResetRequestEmailThrottle]
    throttle_scope = "staff_setup_code"

    def post(self, request):
        user = _pending_setup_account(request.data.get("email"))
        if user:
            _send_setup_code(user)
        return Response({
            "detail": "If that email belongs to an account waiting on setup, we've sent a code to it."
        })


class StaffAccountSetupView(APIView):
    """
    POST /api/auth/staff-setup/ — completes a Barangay Staff/Administrator
    account an admin created with just an email + role (see
    AdminCreateUserSerializer): the staff member supplies their own name,
    phone, and password on first login. Logs them straight in afterward —
    same response shape as LoginView — so the frontend can reuse its
    normal post-login redirect (main.js's ROLE_HOME).

    Requires the emailed code from StaffAccountSetupCodeRequestView, already
    accepted by password-reset/verify/ — see that view for why. Every way of
    failing (no such account, already set up, missing/wrong/expired code)
    gets the same answer, again so it can't be used to probe for accounts.
    """
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "staff_setup"

    NOT_ALLOWED = "This setup session has expired or is invalid. Please start again from the login page."

    def post(self, request):
        user = _pending_setup_account(request.data.get("email"))
        code = str(request.data.get("code") or "").strip()
        reset_code = None
        if user and code:
            reset_code = (
                PasswordResetCode.objects.filter(
                    user=user, code=code, used_at__isnull=True, verified_at__isnull=False
                )
                .order_by("-created_at")
                .first()
            )
        if not reset_code or not reset_code.is_valid():
            return Response({"detail": self.NOT_ALLOWED}, status=400)

        setup_serializer = CitizenSetupSerializer if user.role == User.Role.CITIZEN else StaffAccountSetupSerializer
        serializer = setup_serializer(user, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        reset_code.expire()

        LoginSession.objects.create(user=user)
        log_action(user, "Completed account setup and logged in")

        refresh = CustomTokenObtainPairSerializer.get_token(user)
        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user, context={"request": request}).data,
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
        password (see DeleteAccountSerializer). Report/Concern/Question all
        CASCADE off User, so this also wipes everything the citizen ever
        submitted — the confirmation UI says so up front.
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
    """Secretary, Barangay Captain, or Administrator — who may post/edit/delete Announcements."""

    def has_permission(self, request, view):
        user = request.user
        if not (user and user.is_authenticated):
            return False
        return user.role == User.Role.ADMIN or (
            user.role == User.Role.STAFF and user.position in ("Secretary", "Barangay Captain")
        )


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
    email + role, pending the staff member's own first-login setup (see
    StaffAccountSetupView).
    """
    queryset = User.objects.all()
    serializer_class = AdminCreateUserSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        _send_setup_code(user, with_setup_link=True)
        log_action(self.request.user, f"Created a {user.position} account for {user.email}")


class AdminInviteCitizenView(generics.CreateAPIView):
    """
    POST /api/auth/admin/create-citizen/ — Administrator or Barangay Secretary
    creates a Barangay Citizen account from just an email. The citizen gets a
    setup code and link by email and finishes the account themselves.
    """
    queryset = User.objects.all()
    serializer_class = CitizenInviteSerializer
    permission_classes = [IsSecretaryOrAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        _send_setup_code(user, with_setup_link=True)
        log_action(self.request.user, f"Invited a Barangay Citizen account for {user.email}")


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


def _release_claims(actor, holder, reason):
    """
    Frees every report `holder` has claimed (see Report.assigned_investigator)
    so another Investigator can claim it, writing one audit log entry per
    report under the Administrator who did it. Used when an account is
    disabled with "release claims" or deleted. Returns how many were freed.
    """
    holder_name = holder.get_full_name() or holder.username
    claimed = list(holder.claimed_reports.all())
    for report in claimed:
        report.assigned_investigator = None
        report.previous_investigator = holder
        report.save(update_fields=["assigned_investigator", "previous_investigator"])
        log_action(actor, f"Released {holder_name}'s claim on a report — {report.ordinance} ({reason})")
    return len(claimed)


def _claims_note(count, released):
    if not count:
        return ""
    noun = "report" if count == 1 else "reports"
    return f" — {count} claimed {noun} {'released' if released else 'still assigned to them'}"


class AdminAccountDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET/PATCH/DELETE /api/auth/admin/users/<id>/ — backs the Manage Accounts
    "Edit Account" modal: viewing details, toggling active/disabled,
    changing account type (role/position), and deleting the account all go
    through here.

    Claimed reports: disabling accepts `release_claims: true` to free every
    report the account has claimed in the same request (otherwise they stay
    assigned until released from Manage Accounts' Claimed Reports); deleting
    always frees them (Report.assigned_investigator is SET_NULL). Either way
    the audit log records who did it and what happened to the claims.
    """
    queryset = User.objects.all()
    serializer_class = AdminAccountSerializer
    permission_classes = [IsAdmin]

    @transaction.atomic
    def patch(self, request, *args, **kwargs):
        user = self.get_object()
        is_self = user.id == request.user.id
        was_active = user.is_active

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

            user.role = new_role
            user.position = staff_role

        user.save()

        name = user.get_full_name() or user.username
        if "active" in request.data:
            if user.is_active:
                log_action(request.user, f"Enabled {name}'s account")
            else:
                claim_count = user.claimed_reports.count()
                release = bool(request.data.get("release_claims")) and was_active
                if release and claim_count:
                    _release_claims(request.user, user, "account disabled")
                log_action(request.user, f"Disabled {name}'s account{_claims_note(claim_count, release)}")
                send_account_deactivated_email(user)
        if "staff_role" in request.data:
            log_action(request.user, f"Changed {name}'s role to {user.position}")

        return Response(AdminAccountSerializer(user).data)

    def delete(self, request, *args, **kwargs):
        user = self.get_object()

        if user.id == request.user.id:
            return Response({"detail": "You can't delete your own account."}, status=400)

        if user.role == User.Role.ADMIN and User.objects.filter(role=User.Role.ADMIN).count() <= 1:
            return Response({"detail": "Can't remove the last remaining Administrator."}, status=400)

        name = user.get_full_name() or user.username
        email = user.email
        # Released explicitly (rather than left to SET_NULL) so each freed
        # report gets its own audit entry naming who deleted the account.
        with transaction.atomic():
            claim_count = _release_claims(request.user, user, "account deleted")
            log_action(request.user, f"Deleted {name}'s account{_claims_note(claim_count, True)}")
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


class AdminResetPasswordView(APIView):
    """
    POST /api/auth/admin/users/<id>/reset-password/ — backs the "Reset
    Password" button. Generates a one-time reset token; actually emailing it
    is a follow-up (no email service wired up yet), so this currently
    returns the token directly for testing.
    """
    permission_classes = [IsAdmin]

    def post(self, request, pk):
        user = get_object_or_404(User, pk=pk)
        token = default_token_generator.make_token(user)
        log_action(request.user, f"Reset password for {user.get_full_name() or user.username}")
        return Response({
            "detail": f"Password reset token generated for {user.email}.",
            "token": token,
        })
