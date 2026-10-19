"""
Accounts — API views. All URLs start with /api/auth/ (see accounts/urls.py).

Sections:
  1. Sign up, login, logout
  2. Forgot Password (6-digit code)
  3. Account setup link / Administrator reset link
  4. My Profile
  5. Administrator: create and manage accounts
  6. Administrator: approve accounts, audit logs
"""

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
from .models import AuditLog, LoginSession, ProfileEditVerificationCode, User, VoterVerification, log_action
from .permissions import IsAdmin, IsSecretaryOrAdmin
from .serializers import (
    STAFF_ROLE_CHOICES,
    STAFF_ROLE_TO_ROLE_FIELD,
    AccountAvailabilityCheckSerializer,
    AdminAccountSerializer,
    AdminCreateUserSerializer,
    AuditLogSerializer,
    ChangePasswordSerializer,
    CitizenInviteSerializer,
    CitizenSetupSerializer,
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


class PublicView(APIView):
    """Base for endpoints used before logging in: open to anyone, rate limited by `throttle_scope`."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]


# ---------------------------------------------------------------------------
# 1. Sign up, login, logout
# ---------------------------------------------------------------------------

class RegisterView(generics.CreateAPIView):
    """POST /register/ — citizen sign up. Every active Administrator is emailed about it."""

    queryset = User.objects.all()
    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "register"

    def perform_create(self, serializer):
        user = serializer.save()
        send_account_created_admin_emails(user, User.objects.filter(role=User.Role.ADMIN, is_active=True))


class SignupCodeRequestView(PublicView):
    """POST /signup/request-code/ — emails a 6-digit code to the Sign Up email (before the ID step)."""

    throttle_classes = [ScopedRateThrottle, SignupCodeEmailThrottle]
    throttle_scope = "signup_code"

    def post(self, request):
        serializer = SignupCodeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "We've emailed a 6-digit code to that address."})


class SignupCodeVerifyView(PublicView):
    """POST /signup/verify-code/ — checks the code; returns the token /register/ needs."""

    throttle_scope = "signup_verify"

    def post(self, request):
        serializer = SignupCodeVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response({"email_verification_token": serializer.save()})


class CheckAccountAvailabilityView(PublicView):
    """POST /check-availability/ — is this email / phone number still free? (Sign Up step 1)"""

    throttle_scope = "register"

    def post(self, request):
        AccountAvailabilityCheckSerializer(data=request.data).is_valid(raise_exception=True)
        return Response({})


class LoginView(TokenObtainPairView):
    """POST /login/ — returns access + refresh tokens and the user's profile."""

    serializer_class = CustomTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class LogoutView(APIView):
    """
    POST /logout/ — records the logout time on the latest LoginSession.
    The browser deletes its own tokens.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        session = (
            LoginSession.objects.filter(user=request.user, logged_out_at__isnull=True)
            .order_by("-logged_in_at")
            .first()
        )
        if session:
            session.logged_out_at = timezone.now()
            session.save(update_fields=["logged_out_at"])
        log_action(request.user, "Logged out")
        return Response({"detail": "Logged out."})


# ---------------------------------------------------------------------------
# 2. Forgot Password (forgot-password.html -> verify-code.html -> reset-password.html)
# ---------------------------------------------------------------------------

class PasswordResetRequestView(PublicView):
    """POST /password-reset/request/ — emails a 6-digit code."""

    throttle_classes = [ScopedRateThrottle, ResetRequestEmailThrottle]
    throttle_scope = "reset_request"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Same answer whether or not the email has an account.
        return Response({"detail": "If an account exists for that email, we've sent a reset code to it."})


class PasswordResetVerifyView(PublicView):
    """POST /password-reset/verify/ — checks the code."""

    throttle_scope = "reset_verify"

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Code verified."})


class PasswordResetConfirmView(PublicView):
    """POST /password-reset/confirm/ — saves the new password."""

    throttle_scope = "reset_confirm"

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been reset."})


# ---------------------------------------------------------------------------
# 3. Account setup link (accounts created by someone else) and
#    Administrator-sent password reset link
# ---------------------------------------------------------------------------

SETUP_LINK_INVALID = "This setup link has expired or has already been used."
RESET_LINK_INVALID = "This password reset link has expired or has already been used. Ask an Administrator for a new one."


class AccountSetupCheckView(PublicView):
    """POST /account-setup/check/ — is the link valid? Returns the details to pre-fill."""

    throttle_scope = "account_setup"

    def post(self, request):
        user = pending_user_for_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": SETUP_LINK_INVALID}, status=400)
        return Response({
            "email": user.email,
            "role": user.role,
            "first_name": user.first_name,
            "middle_initial": user.middle_initial,
            "last_name": user.last_name,
            "contact_number": user.contact_number,
            "address": user.address,
        })


class AccountSetupView(PublicView):
    """
    POST /account-setup/ — saves the owner's details and password, then logs
    them in (same response shape as /login/). Setting the password kills the link.
    """

    throttle_scope = "account_setup"

    def post(self, request):
        user = pending_user_for_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": SETUP_LINK_INVALID}, status=400)

        serializer_class = CitizenSetupSerializer if user.role == User.Role.CITIZEN else StaffAccountSetupSerializer
        serializer = serializer_class(user, data=request.data)
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


class AccountSetupLinkRequestView(PublicView):
    """
    POST /account-setup/request-link/ — emails a new setup link, found by
    `email` or by the `uid` of an expired link. Always gives the same answer,
    so it can't be used to find out which emails have accounts.
    """

    throttle_classes = [ScopedRateThrottle, ResetRequestEmailThrottle]
    throttle_scope = "account_setup_link"

    def post(self, request):
        email = str(request.data.get("email") or "").strip()
        user = User.objects.filter(email__iexact=email).first() if email else user_from_uid(request.data.get("uid"))
        if is_pending_setup(user):
            send_setup_link(user)
        return Response({"detail": "If that account is waiting to be set up, we've emailed it a new setup link."})


class PasswordLinkCheckView(PublicView):
    """POST /password-link/check/ — is the Administrator-sent reset link still valid?"""

    throttle_scope = "account_setup"

    def post(self, request):
        user = user_for_reset_link(request.data.get("uid"), request.data.get("token"))
        if not user:
            return Response({"detail": RESET_LINK_INVALID}, status=400)
        return Response({"email": user.email, "first_name": user.first_name, "last_name": user.last_name})


class PasswordLinkConfirmView(PublicView):
    """POST /password-link/ — saves the new password from a reset link (and lifts any lockout)."""

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


# ---------------------------------------------------------------------------
# 4. My Profile
# ---------------------------------------------------------------------------

class ProfileEditCodeRequestView(APIView):
    """POST /profile-edit/request-code/ — emails a code needed to change email/phone/address."""

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
    GET    /me/ — the logged-in user's profile.
    PATCH  /me/ — edit it. Changing email, mobile number or address also needs
                  `verification_code` (from /profile-edit/request-code/).
    DELETE /me/ — a citizen deletes their own account (password required).
    """

    permission_classes = [permissions.IsAuthenticated]
    SENSITIVE_FIELDS = ("email", "contact_number", "address")

    def get(self, request):
        return Response(UserSerializer(request.user, context={"request": request}).data)

    def _sensitive_fields_changing(self, user, data):
        return any(
            field in data and str(data[field]).strip() != (getattr(user, field) or "")
            for field in self.SENSITIVE_FIELDS
        )

    def _check_verification_code(self, user, data):
        """Returns an error Response, or None when the code is correct."""
        submitted = str(data.get("verification_code") or "").strip()
        if not submitted:
            return Response(
                {"detail": "Enter the verification code sent to your email to save these changes.", "code_required": True},
                status=400,
            )
        code = ProfileEditVerificationCode.objects.filter(user=user, used_at__isnull=True).order_by("-created_at").first()
        if not code or not code.is_valid():
            return Response({"detail": "That code has expired. Request a new one.", "code_required": True}, status=400)
        result = check_code(code, submitted)
        if result == CODE_EXHAUSTED:
            return Response({"detail": "Too many incorrect attempts. Request a new code.", "code_required": True}, status=400)
        if result != CODE_OK:
            return Response({"detail": "That code is incorrect."}, status=400)
        code.expire()
        return None

    def patch(self, request):
        user = request.user
        if self._sensitive_fields_changing(user, request.data):
            error = self._check_verification_code(user, request.data)
            if error:
                return error

        serializer = ProfileUpdateSerializer(user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(UserSerializer(user, context={"request": request}).data)

    def delete(self, request):
        # Staff/admin accounts are removed by an Administrator instead.
        if request.user.role != User.Role.CITIZEN:
            return Response({"detail": "Only a citizen account can be deleted this way."}, status=403)

        DeleteAccountSerializer(data=request.data, context={"request": request}).is_valid(raise_exception=True)

        user = request.user
        name, email = user.display_name, user.email
        with transaction.atomic():
            log_action(user, "Deleted own account")
            user.delete()  # their reports, concerns and questions are deleted with it
        send_account_self_deleted_email(name, email)
        return Response(status=204)


class ChangePasswordView(APIView):
    """POST /change-password/ — My Profile > Change Password."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Your password has been changed."})


# ---------------------------------------------------------------------------
# 5. Administrator: create and manage accounts
# ---------------------------------------------------------------------------

class AdminCreateUserView(generics.CreateAPIView):
    """POST /admin/create-user/ — new staff/administrator account; a setup link is emailed."""

    queryset = User.objects.all()
    serializer_class = AdminCreateUserSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Created a {user.position} account for {user.email}")


class AdminInviteCitizenView(generics.CreateAPIView):
    """POST /admin/create-citizen/ — new citizen account from an email (Administrator or Secretary)."""

    queryset = User.objects.all()
    serializer_class = CitizenInviteSerializer
    permission_classes = [IsSecretaryOrAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Invited a Barangay Citizen account for {user.email}")


class StaffCreateCitizenView(generics.CreateAPIView):
    """POST /admin/create-citizen-direct/ — new citizen account with all details (Administrator)."""

    queryset = User.objects.all()
    serializer_class = StaffCreateCitizenSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        user = serializer.save()
        send_setup_link(user)
        log_action(self.request.user, f"Created a Barangay Citizen account for {user.email}")


class AdminListUsersView(generics.ListAPIView):
    """GET /admin/users/ — Manage Accounts list, newest first."""

    queryset = User.objects.all().order_by("-date_joined")
    serializer_class = AdminAccountSerializer
    permission_classes = [IsAdmin]


# -- Claimed reports. An Investigator's unfinished claimed reports must be
# -- released before their account is disabled, changes role, or is deleted.

def _active_claims(holder):
    """Reports `holder` has claimed that aren't closed yet (Resolved/With Remarks)."""
    from reports.models import Report

    return holder.claimed_reports.exclude(status__in=Report.CLOSED_STATUSES)


def _release_claims(actor, holder, reason):
    """Unclaims every active report of `holder` (one audit entry each). Returns how many."""
    claimed = list(_active_claims(holder))
    for report in claimed:
        report.assigned_investigator = None
        report.previous_investigator = holder
        report.save(update_fields=["assigned_investigator", "previous_investigator"])
        log_action(actor, f"Released {holder.display_name}'s claim on a report — {report.ordinance} ({reason})")
    return len(claimed)


def _claims_note(count):
    if not count:
        return ""
    return f" — {count} claimed {'report' if count == 1 else 'reports'} released"


def _claims_block_response(user, action):
    count = _active_claims(user).count()
    noun = "report" if count == 1 else "reports"
    return Response(
        {
            "detail": f"{user.display_name} still has {count} active claimed {noun}. Release them before {action}.",
            "active_claims": count,
        },
        status=400,
    )


class AdminAccountDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    GET    /admin/users/<id>/ — one account.
    PATCH  /admin/users/<id>/ — {"active": true/false} and/or {"staff_role": "..."}.
           If the account still has active claimed reports, the request must
           include "release_claims": true, otherwise it is refused.
    DELETE /admin/users/<id>/ — deletes the account (its claims are released first).
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

        # --- Enable / disable ---
        if "active" in request.data:
            new_active = bool(request.data["active"])
            if is_self and not new_active:
                return Response({"detail": "You can't disable your own account."}, status=400)
            if was_active and not new_active and has_active_claims:
                if not release_requested:
                    return _claims_block_response(user, "disabling this account")
                release_needed = True
            user.is_active = new_active

        # --- Change role (staff/administrator accounts only) ---
        if "staff_role" in request.data:
            staff_role = request.data["staff_role"]
            if staff_role not in STAFF_ROLE_CHOICES:
                return Response({"detail": "Invalid role."}, status=400)
            if user.role not in (User.Role.STAFF, User.Role.ADMIN):
                return Response({"detail": "Only Barangay Staff accounts can have their role changed."}, status=400)
            if is_self:
                return Response({"detail": "You can't change your own role."}, status=400)

            new_role = STAFF_ROLE_TO_ROLE_FIELD[staff_role]
            # The system must always keep at least one Administrator.
            if user.role == User.Role.ADMIN and new_role != User.Role.ADMIN:
                if User.objects.filter(role=User.Role.ADMIN).count() <= 1:
                    return Response({"detail": "Can't remove the last remaining Administrator."}, status=400)

            try:
                validate_staff_role_uniqueness(staff_role, exclude_user=user)
            except serializers.ValidationError as exc:
                return Response({"detail": exc.detail[0]}, status=400)

            if staff_role != user.position and has_active_claims:
                if not release_requested:
                    return _claims_block_response(user, "changing this account's role")
                release_needed = True

            user.role = new_role
            user.position = staff_role

        # All checks passed — release claims (if needed) and save.
        released = 0
        if release_needed:
            reason = "account disabled" if "active" in request.data and not user.is_active else "role changed"
            released = _release_claims(request.user, user, reason)
        user.save()

        name = user.display_name
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

        name, email = user.display_name, user.email
        with transaction.atomic():
            claim_count = _release_claims(request.user, user, "account deleted")
            log_action(request.user, f"Deleted {name}'s account{_claims_note(claim_count)}")
            user.delete()
        send_account_deleted_email(name, email)
        return Response(status=204)


class AdminResendSetupLinkView(APIView):
    """POST /admin/users/<id>/resend-setup-link/ — only while the account is still waiting for setup."""

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
    POST /admin/users/<id>/reset-password/ — emails a staff/administrator a link
    to choose a new password. Citizens use Forgot Password instead.
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


# ---------------------------------------------------------------------------
# 6. Administrator: approve accounts, audit logs
# ---------------------------------------------------------------------------

class AdminListPendingVerificationsView(generics.ListAPIView):
    """GET /admin/verifications/ — citizens waiting for voter's ID approval, oldest first."""

    queryset = (
        VoterVerification.objects.filter(status=VoterVerification.Status.PENDING)
        .select_related("user")
        .order_by("created_at")
    )
    serializer_class = PendingVerificationSerializer
    permission_classes = [IsAdmin]


class AdminApproveVerificationView(APIView):
    """POST /admin/verifications/<id>/approve/ — the citizen can now log in."""

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        verification = get_object_or_404(VoterVerification, pk=pk, status=VoterVerification.Status.PENDING)
        verification.status = VoterVerification.Status.APPROVED
        verification.reviewed_by = request.user
        verification.reviewed_at = timezone.now()
        verification.save()
        verification.user.is_verified = True
        verification.user.save(update_fields=["is_verified"])
        send_account_approved_email(verification.user)
        log_action(request.user, f"Approved {verification.user.display_name}'s account")
        return Response({"detail": "Account approved."})


class AdminRejectVerificationView(APIView):
    """
    POST /admin/verifications/<id>/reject/ — needs a `reason`. The reason is
    emailed and the pending account is deleted, so the person can sign up
    again with the same email.
    """

    permission_classes = [IsAdmin]

    def post(self, request, pk):
        verification = get_object_or_404(VoterVerification, pk=pk, status=VoterVerification.Status.PENDING)
        reason = (request.data.get("reason") or "").strip()
        if not reason:
            return Response({"detail": "Please provide a reason for rejecting this account."}, status=400)
        user = verification.user
        name = user.display_name
        send_account_rejected_email(name, user.email, reason)
        user.delete()
        log_action(request.user, f"Rejected {name}'s account (reason: {reason})")
        return Response({"detail": "Account rejected."})


class AdminListAuditLogsView(generics.ListAPIView):
    """GET /admin/audit-logs/ — View Audit Logs, newest first."""

    queryset = AuditLog.objects.select_related("user").order_by("-created_at")
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdmin]
