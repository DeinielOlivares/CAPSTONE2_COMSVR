from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from accounts.models import User

from .models import Ordinance, OrdinanceAuthor, OrdinanceCategory

# An ordinance counts as "New" for this many days after upload or edit.
LATEST_NEW_DAYS = 15

# Same limit as the Upload Ordinance page (MAX_ORDINANCE_PDF_MB in staff/js/ordinances-data.js).
MAX_ORDINANCE_PDF_BYTES = 20 * 1024 * 1024
ORDINANCE_FILE_ERROR = "Could not upload file, check the file type and file size."


def _citizen(context):
    """The logged-in citizen making the request, or None (guest, staff, admin)."""
    request = context.get("request")
    user = getattr(request, "user", None)
    if user and user.is_authenticated and user.role == User.Role.CITIZEN:
        return user
    return None


class OrdinanceSerializer(serializers.ModelSerializer):
    """
    An ordinance as shown on the citizen and staff pages. `pdf_url` is the full
    download link. The is_* / in_latest flags drive the "New"/"Updated" tags
    and the home page's Latest Ordinances list.
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
        return obj.uploaded_by.display_name if obj.uploaded_by else None

    def get_is_new(self, obj):
        """Uploaded or edited in the last LATEST_NEW_DAYS days."""
        return obj.updated_at >= timezone.now() - timedelta(days=LATEST_NEW_DAYS)

    def get_is_updated(self, obj):
        """New because it was *edited* (not just uploaded) recently."""
        edited_after_upload = obj.updated_at - obj.created_at > timedelta(minutes=1)
        return edited_after_upload and self.get_is_new(obj)

    def get_is_unread(self, obj):
        """Citizens only: they haven't opened this ordinance yet."""
        if not _citizen(self.context):
            return False
        viewed_ids = self.context.get("viewed_ordinance_ids")
        if viewed_ids is not None:
            return obj.id not in viewed_ids
        return not obj.views.filter(citizen=self.context["request"].user).exists()

    def get_in_latest(self, obj):
        """
        Shown in the home page's "Latest Ordinances"? Guests see recent ones.
        A citizen sees every unopened one that is recent or older than their account.
        """
        citizen = _citizen(self.context)
        if not citizen:
            return self.get_is_new(obj)
        if not self.get_is_unread(obj):
            return False
        return self.get_is_new(obj) or obj.created_at < citizen.date_joined


# Only one active holder of these seats at a time (Kagawad has 7 seats).
SINGLE_SEAT_POSITIONS = {OrdinanceAuthor.Position.BARANGAY_CAPTAIN, OrdinanceAuthor.Position.SK_CHAIRPERSON}


class OrdinanceAuthorSerializer(serializers.ModelSerializer):
    position_display = serializers.CharField(source="get_position_display", read_only=True)

    class Meta:
        model = OrdinanceAuthor
        fields = ["id", "name", "position", "position_display", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate(self, attrs):
        # On an edit, missing fields fall back to the saved values.
        position = attrs.get("position", getattr(self.instance, "position", None))
        is_active = attrs.get("is_active", getattr(self.instance, "is_active", True))

        if position in SINGLE_SEAT_POSITIONS and is_active:
            clash = OrdinanceAuthor.objects.filter(position=position, is_active=True)
            if self.instance is not None:
                clash = clash.exclude(pk=self.instance.pk)
            if clash.exists():
                label = OrdinanceAuthor.Position(position).label
                raise serializers.ValidationError(f"There's already an active {label}. Only one is allowed at a time.")
        return attrs


class OrdinanceCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = OrdinanceCategory
        fields = ["id", "name", "is_active", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class OrdinanceWriteSerializer(serializers.ModelSerializer):
    """Upload (POST) and edit (PATCH) an ordinance."""

    class Meta:
        model = Ordinance
        fields = ["number", "title", "author", "category", "date_approved", "description", "pdf_file"]

    def validate_category(self, value):
        if not OrdinanceCategory.objects.filter(name=value, is_active=True).exists():
            raise serializers.ValidationError("Select a category from the list.")
        return value

    def validate_pdf_file(self, value):
        # Must be a non-empty .pdf file under the size limit that really starts like a PDF.
        if not value.name.lower().endswith(".pdf") or not 0 < value.size <= MAX_ORDINANCE_PDF_BYTES:
            raise serializers.ValidationError(ORDINANCE_FILE_ERROR)
        header = value.read(5)
        value.seek(0)
        if header != b"%PDF-":
            raise serializers.ValidationError(ORDINANCE_FILE_ERROR)
        return value


class OrdinanceCreateSerializer(OrdinanceWriteSerializer):
    """POST — the PDF is required."""

    class Meta(OrdinanceWriteSerializer.Meta):
        extra_kwargs = {"pdf_file": {"required": True}}


class OrdinanceUpdateSerializer(OrdinanceWriteSerializer):
    """PATCH — replacing the PDF is optional."""

    class Meta(OrdinanceWriteSerializer.Meta):
        extra_kwargs = {"pdf_file": {"required": False}}
