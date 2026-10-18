from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from accounts.models import User

from .models import Ordinance, OrdinanceAuthor, OrdinanceCategory

LATEST_NEW_DAYS = 15

# Same limit the Upload/Edit Ordinance page checks before sending (see
# MAX_ORDINANCE_PDF_MB in frontend/staff/js/ordinances-data.js).
MAX_ORDINANCE_PDF_BYTES = 20 * 1024 * 1024
ORDINANCE_FILE_ERROR = "Could not upload file, check the file type and file size."


class OrdinanceSerializer(serializers.ModelSerializer):
    """
    Read side — used for both the public citizen list/detail (guests can
    browse ordinances without an account) and the staff list/detail. Never
    exposes pdf_file directly (a storage path); pdf_url is the absolute,
    downloadable link.
    """

    pdf_url = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()
    is_unread = serializers.SerializerMethodField()
    is_new = serializers.SerializerMethodField()
    is_updated = serializers.SerializerMethodField()
    in_latest = serializers.SerializerMethodField()

    class Meta:
        model = Ordinance
        fields = [
            "id", "number", "title", "author", "category", "date_approved",
            "description", "pdf_url", "uploaded_by_name", "is_archived",
            "created_at", "updated_at", "is_unread", "is_new", "is_updated", "in_latest",
        ]

    def get_pdf_url(self, obj):
        if not obj.pdf_file:
            return None
        request = self.context.get("request")
        url = obj.pdf_file.url
        return request.build_absolute_uri(url) if request else url

    def get_uploaded_by_name(self, obj):
        if not obj.uploaded_by:
            return None
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.username

    # Uploaded or last edited within LATEST_NEW_DAYS — gets the "New" tag, and
    # the Latest Ordinances window for guests.
    def get_is_new(self, obj):
        return obj.updated_at >= timezone.now() - timedelta(days=LATEST_NEW_DAYS)

    # Edited after upload (rather than freshly uploaded) within the same window —
    # the home page tags these "Updated" instead of "New".
    def get_is_updated(self, obj):
        edited_after_upload = obj.updated_at - obj.created_at > timedelta(minutes=1)
        return edited_after_upload and self.get_is_new(obj)

    # What the home page's "Latest Ordinances" lists for this viewer. A logged-in
    # citizen gets every ordinance they haven't opened that was either uploaded
    # within LATEST_NEW_DAYS or predates their account (so a brand-new account sees
    # the backlog). Guests get recent uploads only.
    def get_in_latest(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or user.role != User.Role.CITIZEN:
            return self.get_is_new(obj)
        if not self.get_is_unread(obj):
            return False
        return self.get_is_new(obj) or obj.created_at < user.date_joined

    # Citizen-only — "Latest Ordinances" on the home page (see
    # OrdinanceView/OrdinanceViewMarkView). Always False for a guest, or for
    # Staff/Admin, who have no notion of "unread" here.
    def get_is_unread(self, obj):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated or user.role != User.Role.CITIZEN:
            return False
        viewed_ids = self.context.get("viewed_ordinance_ids")
        if viewed_ids is not None:
            return obj.id not in viewed_ids
        return not obj.views.filter(citizen=user).exists()


# There's exactly one Punong Barangay and one SK Chairperson at a time, unlike
# Barangay Kagawad (7 seats) — same "one active holder" idea as
# accounts.serializers.UNIQUE_STAFF_ROLES/validate_staff_role_uniqueness for
# Secretary/Barangay Captain, applied here to the author roster instead.
SINGLE_SEAT_POSITIONS = {OrdinanceAuthor.Position.BARANGAY_CAPTAIN, OrdinanceAuthor.Position.SK_CHAIRPERSON}


class OrdinanceAuthorSerializer(serializers.ModelSerializer):
    """
    The author roster — read by Upload/Edit Ordinance to build the Author
    field's autocomplete suggestions, and managed (create/edit/deactivate) by
    an Administrator on the Admin Portal's Ordinance Setup page.
    """

    position_display = serializers.CharField(source="get_position_display", read_only=True)

    class Meta:
        model = OrdinanceAuthor
        fields = ["id", "name", "position", "position_display", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        # A PATCH that touches neither field falls back to the existing
        # instance's values, so e.g. renaming the sitting Captain doesn't trip
        # this against themselves (excluded below by pk).
        position = attrs.get("position", getattr(self.instance, "position", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))

        if position in SINGLE_SEAT_POSITIONS and is_active:
            clash = OrdinanceAuthor.objects.filter(position=position, is_active=True)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                label = OrdinanceAuthor.Position(position).label
                raise serializers.ValidationError(
                    f"There's already an active {label}. Only one is allowed at a time."
                )
        return attrs


class OrdinanceCategorySerializer(serializers.ModelSerializer):
    """
    The category list — read by Upload/Edit Ordinance to build the Category
    dropdown, and managed (add/rename/retire) by an Administrator on the same
    Ordinance Setup page as the author roster. Unlike authors, this list *is*
    enforced (see OrdinanceCreateSerializer/OrdinanceUpdateSerializer's
    validate_category) — see OrdinanceCategory's docstring for why.
    """

    class Meta:
        model = OrdinanceCategory
        fields = ["id", "name", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class _ValidateCategoryMixin:
    """Shared by create/update below — category must name a currently-active OrdinanceCategory."""

    def validate_category(self, value):
        if not OrdinanceCategory.objects.filter(name=value, is_active=True).exists():
            raise serializers.ValidationError("Select a category from the list.")
        return value

    # The page's file picker only hints at PDFs, so the type and size are
    # checked here too: a non-empty .pdf whose contents really are a PDF.
    def validate_pdf_file(self, value):
        if not value.name.lower().endswith(".pdf") or not 0 < value.size <= MAX_ORDINANCE_PDF_BYTES:
            raise serializers.ValidationError(ORDINANCE_FILE_ERROR)
        header = value.read(5)
        value.seek(0)
        if header != b"%PDF-":
            raise serializers.ValidationError(ORDINANCE_FILE_ERROR)
        return value


class OrdinanceCreateSerializer(_ValidateCategoryMixin, serializers.ModelSerializer):
    """POST — Secretary/Admin uploading a new ordinance. The PDF is required on creation."""

    class Meta:
        model = Ordinance
        fields = ["number", "title", "author", "category", "date_approved", "description", "pdf_file"]
        extra_kwargs = {"pdf_file": {"required": True}}


class OrdinanceUpdateSerializer(_ValidateCategoryMixin, serializers.ModelSerializer):
    """PATCH — Secretary/Admin editing an existing ordinance. Replacing the PDF is optional."""

    class Meta:
        model = Ordinance
        fields = ["number", "title", "author", "category", "date_approved", "description", "pdf_file"]
        extra_kwargs = {"pdf_file": {"required": False}}
