from PIL import Image
from rest_framework import serializers

from .models import Announcement

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


def validate_image_upload(file):
    """ImageField already rejects non-images; this also caps size and format."""
    if file.size > MAX_IMAGE_BYTES:
        raise serializers.ValidationError("Image must be 5 MB or smaller.")
    try:
        file.seek(0)
        fmt = Image.open(file).format
    except Exception:
        raise serializers.ValidationError("Upload a valid JPG, PNG or WebP image.")
    finally:
        file.seek(0)
    if fmt not in ALLOWED_IMAGE_FORMATS:
        raise serializers.ValidationError("Upload a JPG, PNG or WebP image.")
    return file


class AnnouncementSerializer(serializers.ModelSerializer):
    """
    Backs both the citizen home page's feed (is_read is per-viewer) and the
    Secretary/Barangay Captain create/edit form (image is write-only;
    image_url is what's read back).
    """

    image = serializers.ImageField(write_only=True, required=False)
    # Edit form only: takes the current picture off without uploading another.
    remove_image = serializers.BooleanField(write_only=True, required=False, default=False)
    image_url = serializers.SerializerMethodField()
    posted_by_name = serializers.SerializerMethodField()
    is_read = serializers.SerializerMethodField()

    class Meta:
        model = Announcement
        fields = [
            "id", "title", "description", "image", "remove_image", "image_url",
            "posted_by_name", "created_at", "is_read", "is_edited",
        ]
        read_only_fields = ["id", "created_at", "is_edited"]
        extra_kwargs = {
            "title": {"allow_blank": False},
            "description": {"allow_blank": False},
        }

    def get_image_url(self, obj):
        return obj.image.url if obj.image else ""

    def get_posted_by_name(self, obj):
        if not obj.posted_by:
            return None
        return obj.posted_by.get_full_name() or obj.posted_by.username

    def get_is_read(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        # Prefetched by AnnouncementListView as a set of ids, so this list
        # doesn't run one extra query per announcement.
        viewed_ids = self.context.get("viewed_ids")
        if viewed_ids is not None:
            return obj.id in viewed_ids
        return obj.views.filter(user=user).exists()

    def validate_image(self, file):
        return validate_image_upload(file)

    def create(self, validated_data):
        validated_data.pop("remove_image", None)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data["is_edited"] = True
        remove_image = validated_data.pop("remove_image", False)
        # The old file isn't referenced by anything once it's replaced or
        # removed, so it's deleted from storage rather than left orphaned
        # (same as StaffAnnouncementDetailView.perform_destroy).
        old_image = instance.image if instance.image else None
        replacing = "image" in validated_data
        if remove_image and not replacing:
            validated_data["image"] = ""
        instance = super().update(instance, validated_data)
        if old_image and (replacing or remove_image):
            old_image.storage.delete(old_image.name)
        return instance
