"""Account endpoints. Every path here starts with /api/auth/ (see orms_backend/urls.py)."""

from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="register"),
    path("check-availability/", views.CheckAccountAvailabilityView.as_view(), name="check_availability"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.MeView.as_view(), name="me"),
    path("profile-edit/request-code/", views.ProfileEditCodeRequestView.as_view(), name="profile_edit_request_code"),
    path("change-password/", views.ChangePasswordView.as_view(), name="change_password"),
    path("account-setup/check/", views.AccountSetupCheckView.as_view(), name="account_setup_check"),
    path("account-setup/request-link/", views.AccountSetupLinkRequestView.as_view(), name="account_setup_request_link"),
    path("account-setup/", views.AccountSetupView.as_view(), name="account_setup"),
    path("password-link/check/", views.PasswordLinkCheckView.as_view(), name="password_link_check"),
    path("password-link/", views.PasswordLinkConfirmView.as_view(), name="password_link_confirm"),
    path("password-reset/request/", views.PasswordResetRequestView.as_view(), name="password_reset_request"),
    path("password-reset/verify/", views.PasswordResetVerifyView.as_view(), name="password_reset_verify"),
    path("password-reset/confirm/", views.PasswordResetConfirmView.as_view(), name="password_reset_confirm"),
    path("admin/create-user/", views.AdminCreateUserView.as_view(), name="admin_create_user"),
    path("admin/create-citizen/", views.AdminInviteCitizenView.as_view(), name="admin_create_citizen"),
    path(
        "admin/create-citizen-direct/",
        views.StaffCreateCitizenView.as_view(),
        name="admin_create_citizen_direct",
    ),
    path("admin/users/", views.AdminListUsersView.as_view(), name="admin_list_users"),
    path("admin/users/<uuid:pk>/", views.AdminAccountDetailView.as_view(), name="admin_account_detail"),
    path("admin/users/<uuid:pk>/reset-password/", views.AdminResetPasswordView.as_view(), name="admin_reset_password"),
    path(
        "admin/users/<uuid:pk>/resend-setup-link/",
        views.AdminResendSetupLinkView.as_view(),
        name="admin_resend_setup_link",
    ),
    path("admin/verifications/", views.AdminListPendingVerificationsView.as_view(), name="admin_list_verifications"),
    path("admin/verifications/<uuid:pk>/approve/", views.AdminApproveVerificationView.as_view(), name="admin_approve_verification"),
    path("admin/verifications/<uuid:pk>/reject/", views.AdminRejectVerificationView.as_view(), name="admin_reject_verification"),
    path("admin/audit-logs/", views.AdminListAuditLogsView.as_view(), name="admin_list_audit_logs"),
]
