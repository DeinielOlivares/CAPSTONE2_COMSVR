import uuid

from django.conf import settings
from django.db import models


class Announcement(models.Model):
    """
    An announcement posted by the Secretary, Barangay Captain or Administrator.
    Shown on the citizen home page and emailed to every citizen when posted.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField()
    image = models.ImageField(upload_to="announcements/%Y/%m/", blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="announcements"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # Set when the announcement is edited, so the page can show "(edited)".
    is_edited = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class AnnouncementView(models.Model):
    """A user has seen this announcement, so its "unread" mark is no longer shown."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="announcement_views")
    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name="views")
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "announcement")]
