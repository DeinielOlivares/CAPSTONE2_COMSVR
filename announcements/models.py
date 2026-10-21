import uuid

from django.conf import settings
from django.db import models

from orms_backend.encrypted_fields import EncryptedTextField


class Announcement(models.Model):
    """
    A barangay-wide announcement posted by the Secretary
    (Admin too) — shown at the top of the citizen home page, newest first,
    and emailed to every citizen when posted (see
    orms_backend.emails.send_announcement_posted_email).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField()
    image = models.ImageField(upload_to="announcements/%Y/%m/", blank=True)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="announcements"
    )
    # The poster's name, copied here if their account is deleted (see
    # accounts/signals.py) so the announcement keeps its byline.
    posted_by_name_snapshot = EncryptedTextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    # Set by AnnouncementSerializer.update() — lets the frontend show "(edited)".
    is_edited = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class AnnouncementView(models.Model):
    """
    One citizen having seen one Announcement — the home page shows an
    "unread" banner on an announcement until a row like this exists for
    (that citizen, that announcement), then it's gone for good.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="announcement_views")
    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name="views")
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("user", "announcement")]
