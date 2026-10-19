"""
Who may call which API endpoint. Each class answers one question: "is the
logged-in user allowed in?" Administrators pass every check.

    IsAdmin                Administrator only
    IsStaffOrAdmin         any Barangay Official, or an Administrator
    IsInvestigatorOrAdmin  works reports (claim, change status)
    IsSecretaryOrAdmin     works concerns/suggestions, invites citizens
    IsDocumentManager      uploads/edits/archives ordinances (the Secretary)
    IsAnnouncementManager  posts announcements (Secretary or Barangay Captain)
"""

from rest_framework.permissions import BasePermission

from .models import User


def _is_admin_or_staff_with_position(user, positions):
    if not (user and user.is_authenticated):
        return False
    return user.role == User.Role.ADMIN or (user.role == User.Role.STAFF and user.position in positions)


class IsAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role == User.Role.ADMIN)


class IsStaffOrAdmin(BasePermission):
    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in (User.Role.STAFF, User.Role.ADMIN))


class IsInvestigatorOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return _is_admin_or_staff_with_position(request.user, ["Investigator"])


class IsSecretaryOrAdmin(BasePermission):
    def has_permission(self, request, view):
        return _is_admin_or_staff_with_position(request.user, ["Secretary"])


class IsDocumentManager(IsSecretaryOrAdmin):
    """Ordinances are the Secretary's section (same rule as IsSecretaryOrAdmin)."""


class IsAnnouncementManager(BasePermission):
    def has_permission(self, request, view):
        return _is_admin_or_staff_with_position(request.user, ["Secretary", "Barangay Captain"])
