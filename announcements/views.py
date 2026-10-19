from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User, log_action
from accounts.views import IsAnnouncementManager, IsStaffOrAdmin
from orms_backend.emails import send_announcement_posted_email

from .models import Announcement, AnnouncementView as AnnouncementViewRecord
from .serializers import AnnouncementSerializer


def _citizen_recipients():
    return User.objects.filter(role=User.Role.CITIZEN, is_active=True)


class AnnouncementListView(generics.ListAPIView):
    """
    GET /api/announcements/ — every announcement, newest first, for the
    citizen home page's feed. Public (guests see announcements too — only
    is_read is specific to a logged-in viewer, and defaults False for them).
    """

    queryset = Announcement.objects.select_related("posted_by").all()
    serializer_class = AnnouncementSerializer
    permission_classes = [permissions.AllowAny]

    def get_serializer_context(self):
        context = {"request": self.request}
        user = self.request.user
        if user and user.is_authenticated:
            context["viewed_ids"] = set(
                AnnouncementViewRecord.objects.filter(user=user).values_list("announcement_id", flat=True)
            )
        return context


class AnnouncementMarkViewedView(APIView):
    """POST /api/announcements/<id>/view/ — removes that announcement's unread banner for this citizen."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        announcement = get_object_or_404(Announcement, pk=pk)
        AnnouncementViewRecord.objects.get_or_create(user=request.user, announcement=announcement)
        return Response({"detail": "Marked as viewed."})


class StaffAnnouncementListCreateView(generics.ListCreateAPIView):
    """
    GET /api/announcements/staff/ — every Barangay Staff role can view the
    list (same as Reports/Concerns dashboards being read-only for non-owners).
    POST — Secretary/Barangay Captain/Admin only; emails every citizen.
    """

    queryset = Announcement.objects.select_related("posted_by").all()
    serializer_class = AnnouncementSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAnnouncementManager()]
        return [IsStaffOrAdmin()]

    def get_serializer_context(self):
        return {"request": self.request}

    def perform_create(self, serializer):
        announcement = serializer.save(posted_by=self.request.user)
        log_action(self.request.user, f"Posted an announcement: {announcement.title[:60]}")
        send_announcement_posted_email(announcement, _citizen_recipients())


class StaffAnnouncementDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/announcements/staff/<id>/ — Secretary/Barangay Captain/Admin only."""

    queryset = Announcement.objects.select_related("posted_by").all()
    serializer_class = AnnouncementSerializer
    permission_classes = [IsAnnouncementManager]

    def get_serializer_context(self):
        return {"request": self.request}

    def perform_update(self, serializer):
        announcement = serializer.save()
        log_action(self.request.user, f"Updated an announcement: {announcement.title[:60]}")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Deleted an announcement: {instance.title[:60]}")
        if instance.image:
            instance.image.storage.delete(instance.image.name)
        instance.delete()
