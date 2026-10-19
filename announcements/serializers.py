from rest_framework import serializers

from orms_backend.validators import validate_image_upload

from .models import Announcement


class AnnouncementSerializer(serializers.ModelSerializer):
    """
    Used by the citizen home page feed (`is_read` is per viewer) and by the
    staff create/edit form (`image` is uploaded, `image_url` is read back).
    """

    image = serializers.ImageField(write_only=True, required=False)
    # Edit form only: remove the current picture without uploading a new one.
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
        return obj.posted_by.display_name if obj.posted_by else None

    def get_is_read(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return False
        # AnnouncementListView loads the viewed ids once (not one query per row).
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
        # A replaced or removed picture is deleted from storage.
        old_image = instance.image if instance.image else None
        replacing = "image" in validated_data
        if remove_image and not replacing:
            validated_data["image"] = ""
        instance = super().update(instance, validated_data)
        if old_image and (replacing or remove_image):
            old_image.storage.delete(old_image.name)
        return instance
