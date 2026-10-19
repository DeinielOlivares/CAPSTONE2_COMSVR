"""
Ordinances — database tables.

    Ordinance           an ordinance uploaded as a PDF by the Secretary/Administrator
    OrdinanceAuthor     the list of officials suggested in the Author field
    OrdinanceCategory   the list of categories an ordinance can be filed under
    OrdinanceView       a citizen has opened an ordinance (for "Latest Ordinances")
    OrdinanceDownload   a citizen has downloaded an ordinance (once per citizen)
"""

import uuid

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from django.db import models


def pdf_storage():
    """
    Where ordinance PDFs are saved. On Cloudinary PDFs must be uploaded as
    "raw" files (Cloudinary blocks public PDF downloads of the normal "image"
    type); locally they go to the media/ folder.
    """
    if settings.STORAGES["default"]["BACKEND"] == "cloudinary_storage.storage.MediaCloudinaryStorage":
        from cloudinary_storage.storage import RawMediaCloudinaryStorage

        return RawMediaCloudinaryStorage()
    return FileSystemStorage()


class OrdinanceQuerySet(models.QuerySet):
    def published(self):
        """Not archived — what citizens and guests may see."""
        return self.filter(is_archived=False)


class Ordinance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    number = models.CharField(max_length=100)
    title = models.TextField()  # real titles can be longer than 255 characters
    # `author` and `category` are saved as text at upload time. The author may
    # be someone outside the roster (e.g. a city councilor). The category must
    # be an active OrdinanceCategory when saved (checked in the serializer), and
    # renaming that category later does not change ordinances already uploaded.
    author = models.CharField(max_length=255)
    category = models.CharField(max_length=100)
    date_approved = models.DateField()
    description = models.TextField()
    pdf_file = models.FileField(upload_to="ordinances/%Y/%m/", storage=pdf_storage)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="uploaded_ordinances"
    )
    is_archived = models.BooleanField(default=False)  # archived = hidden from citizens
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = OrdinanceQuerySet.as_manager()

    class Meta:
        ordering = ["-date_approved"]

    def __str__(self):
        return f"{self.number} — {self.title}"


class OrdinanceAuthor(models.Model):
    """
    Officials of the Sangguniang Barangay who can author an ordinance. Only
    used for suggestions in the Author field. Kept (set inactive) when a term
    ends. Only one active Barangay Captain and one active SK Chairperson are
    allowed (checked in OrdinanceAuthorSerializer).
    """

    class Position(models.TextChoices):
        BARANGAY_CAPTAIN = "barangay_captain", "Punong Barangay (Barangay Captain)"
        BARANGAY_KAGAWAD = "barangay_kagawad", "Barangay Kagawad"
        SK_CHAIRPERSON = "sk_chairperson", "SK Chairperson"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    position = models.CharField(max_length=30, choices=Position.choices)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["position", "name"]

    def __str__(self):
        return f"{self.name} ({self.get_position_display()})"


class OrdinanceCategory(models.Model):
    """The category list, managed by an Administrator. Retired categories are kept but inactive."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "ordinance categories"

    def __str__(self):
        return self.name


class OrdinanceView(models.Model):
    """A citizen opened this ordinance, so it leaves their "Latest Ordinances" list."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ordinance = models.ForeignKey(Ordinance, on_delete=models.CASCADE, related_name="views")
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ordinance_views")
    viewed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["ordinance", "citizen"]
        ordering = ["-viewed_at"]


class OrdinanceDownload(models.Model):
    """A citizen downloaded this ordinance's PDF. Each citizen may download each ordinance once."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ordinance = models.ForeignKey(Ordinance, on_delete=models.CASCADE, related_name="downloads")
    citizen = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ordinance_downloads"
    )
    downloaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ["ordinance", "citizen"]
        ordering = ["-downloaded_at"]
