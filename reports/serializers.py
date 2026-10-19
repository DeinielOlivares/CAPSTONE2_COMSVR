"""
Reports — serializers.

Citizen side:  ReportSerializer, ConcernSerializer, QuestionSerializer, ReportVerifyCodeSerializer
Staff side:    StaffReport*, StaffConcern*, StaffQuestion*, ConcernFolderSerializer
Public/Admin:  FAQSerializer
"""

from django.utils import timezone
from rest_framework import serializers

from orms_backend.codes import CODE_EXHAUSTED, CODE_OK, check_code

from .models import FAQ, Concern, ConcernAttachment, ConcernFolder, Question, Report, ReportAttachment, ReportVerificationCode

MAX_ATTACHMENTS = 5
MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024

# A rough box around Barangay Platero (plus ~1 km). A device position outside
# it is dropped and the report falls back to its street on the heatmap.
BARANGAY_LAT_RANGE = (14.29, 14.34)
BARANGAY_LNG_RANGE = (121.06, 121.11)


def validate_attachment_files(files):
    if len(files) > MAX_ATTACHMENTS:
        raise serializers.ValidationError(f"You can attach at most {MAX_ATTACHMENTS} files.")
    if sum(f.size for f in files) > MAX_TOTAL_ATTACHMENT_BYTES:
        raise serializers.ValidationError("Attachments can't total more than 50MB.")
    return files


def name_or_none(user):
    return user.display_name if user else None


class AttachmentsMixin:
    """Adds `attachments`: the full URL of every file attached to the object."""

    def get_attachments(self, obj):
        request = self.context.get("request")
        urls = [a.file.url for a in obj.attachments.all()]
        return [request.build_absolute_uri(u) for u in urls] if request else urls


# ---------------------------------------------------------------------------
# Citizen side
# ---------------------------------------------------------------------------

class ReportSerializer(AttachmentsMixin, serializers.ModelSerializer):
    """File a Report (POST) and My Reports / My Report Detail (GET)."""

    files = serializers.ListField(child=serializers.FileField(), write_only=True, required=False, allow_empty=True)
    attachments = serializers.SerializerMethodField(read_only=True)
    claimed_by = serializers.SerializerMethodField(read_only=True)
    # The citizen's own name/contact, printed on the downloadable report form.
    reporter = serializers.CharField(source="citizen.display_name", read_only=True)
    contact_number = serializers.CharField(source="citizen.contact_number", read_only=True)

    class Meta:
        model = Report
        fields = [
            "id", "location", "latitude", "longitude", "ordinance", "incident_date", "incident_time",
            "nature_of_violation", "status", "remarks", "created_at", "updated_at",
            "files", "attachments", "claimed_by", "investigator_last_viewed_at",
            "reporter", "contact_number", "report_number",
        ]
        read_only_fields = ["id", "status", "remarks", "created_at", "updated_at", "investigator_last_viewed_at"]

    def validate_files(self, files):
        return validate_attachment_files(files)

    def get_claimed_by(self, obj):
        return name_or_none(obj.assigned_investigator)

    def validate(self, attrs):
        # Coordinates are optional extras: outside the barangay they are
        # silently dropped instead of rejecting the report.
        lat, lng = attrs.get("latitude"), attrs.get("longitude")
        in_barangay = (
            lat is not None and lng is not None
            and BARANGAY_LAT_RANGE[0] <= lat <= BARANGAY_LAT_RANGE[1]
            and BARANGAY_LNG_RANGE[0] <= lng <= BARANGAY_LNG_RANGE[1]
        )
        if not in_barangay:
            attrs.pop("latitude", None)
            attrs.pop("longitude", None)
        return attrs

    def create(self, validated_data):
        files = validated_data.pop("files", [])
        report = Report.objects.create(**validated_data, citizen=self.context["request"].user)
        for f in files:
            ReportAttachment.objects.create(report=report, file=f)
        return report


class ConcernSerializer(AttachmentsMixin, serializers.ModelSerializer):
    """Submit Suggestion (POST) and My Concerns/Suggestions (GET)."""

    files = serializers.ListField(child=serializers.FileField(), write_only=True, required=False, allow_empty=True)
    attachments = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Concern
        fields = [
            "id", "location", "description", "status", "remarks", "created_at", "updated_at", "reviewed_at",
            "files", "attachments",
        ]
        read_only_fields = ["id", "status", "remarks", "created_at", "updated_at", "reviewed_at"]

    def validate_files(self, files):
        return validate_attachment_files(files)

    def create(self, validated_data):
        files = validated_data.pop("files", [])
        concern = Concern.objects.create(**validated_data, citizen=self.context["request"].user)
        for f in files:
            ConcernAttachment.objects.create(concern=concern, file=f)
        return concern


class AnsweredByMixin:
    """Adds who answered a question: their name and their account type."""

    def get_answered_by_name(self, obj):
        return name_or_none(obj.answered_by)

    def get_answered_by_role(self, obj):
        return obj.answered_by.account_type if obj.answered_by else None


class QuestionSerializer(AnsweredByMixin, serializers.ModelSerializer):
    """FAQs page: ask a question (POST) and see your own questions and answers (GET)."""

    is_answered = serializers.BooleanField(read_only=True)
    answered_by_name = serializers.SerializerMethodField()
    answered_by_role = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            "id", "question", "answer", "is_answered", "created_at", "answered_at",
            "answered_by_name", "answered_by_role",
        ]
        read_only_fields = ["id", "answer", "created_at", "answered_at"]

    def create(self, validated_data):
        return Question.objects.create(**validated_data, citizen=self.context["request"].user)


class ReportVerifyCodeSerializer(serializers.Serializer):
    """Checks the 6-digit code sent before filing a report (wrong guesses are counted)."""

    code = serializers.CharField()

    def validate(self, attrs):
        user = self.context["request"].user
        verification_code = (
            ReportVerificationCode.objects.filter(user=user, verified_at__isnull=True).order_by("-created_at").first()
        )
        if not verification_code or not verification_code.is_valid():
            raise serializers.ValidationError("Invalid or expired code.")
        result = check_code(verification_code, attrs["code"])
        if result == CODE_EXHAUSTED:
            raise serializers.ValidationError("Too many incorrect attempts. Please request a new code.")
        if result != CODE_OK:
            raise serializers.ValidationError("Invalid or expired code.")
        attrs["verification_code"] = verification_code
        return attrs

    def save(self):
        verification_code = self.validated_data["verification_code"]
        verification_code.verified_at = timezone.now()
        verification_code.save(update_fields=["verified_at"])


# ---------------------------------------------------------------------------
# Staff side
# ---------------------------------------------------------------------------

class StaffReportSerializer(AttachmentsMixin, serializers.ModelSerializer):
    """A report as staff see it: adds who filed it and who claimed it."""

    reporter = serializers.CharField(source="citizen.display_name", read_only=True)
    # Used to count distinct reporters (two people can share a name).
    reporterId = serializers.UUIDField(source="citizen_id", read_only=True)
    contact_number = serializers.CharField(source="citizen.contact_number", read_only=True)
    attachments = serializers.SerializerMethodField()
    assignedInvestigator = serializers.SerializerMethodField()
    assignedInvestigatorId = serializers.UUIDField(source="assigned_investigator_id", read_only=True)

    class Meta:
        model = Report
        fields = [
            "id", "reporter", "reporterId", "contact_number", "location", "latitude", "longitude", "ordinance",
            "incident_date", "incident_time", "nature_of_violation",
            "status", "remarks", "created_at", "updated_at", "attachments",
            "assignedInvestigator", "assignedInvestigatorId", "report_number",
        ]

    def get_assignedInvestigator(self, obj):
        return name_or_none(obj.assigned_investigator)


class StaffReportUpdateSerializer(serializers.ModelSerializer):
    """Staff may only change a report's status and remarks."""

    class Meta:
        model = Report
        fields = ["status", "remarks"]


class ConcernFolderSerializer(serializers.ModelSerializer):
    """A folder in the Concerns/Suggestions sidebar; `count` = concerns inside it."""

    count = serializers.SerializerMethodField()

    class Meta:
        model = ConcernFolder
        fields = ["id", "name", "count", "created_at"]
        read_only_fields = ["id", "created_at"]

    def get_count(self, obj):
        return obj.concerns.count()

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Folder name can't be empty.")
        others = ConcernFolder.objects.filter(name__iexact=value)
        if self.instance:
            others = others.exclude(pk=self.instance.pk)
        if others.exists():
            raise serializers.ValidationError("A folder with this name already exists.")
        return value


class ConcernFolderMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConcernFolder
        fields = ["id", "name"]


class StaffConcernSerializer(AttachmentsMixin, serializers.ModelSerializer):
    """A concern/suggestion as staff see it: adds who submitted it and its folder."""

    reporter = serializers.CharField(source="citizen.display_name", read_only=True)
    contact_number = serializers.CharField(source="citizen.contact_number", read_only=True)
    attachments = serializers.SerializerMethodField()
    folder = ConcernFolderMiniSerializer(read_only=True)

    class Meta:
        model = Concern
        fields = [
            "id", "reporter", "contact_number", "location", "description",
            "status", "remarks", "folder", "created_at", "updated_at", "reviewed_at", "attachments",
        ]


class StaffConcernUpdateSerializer(serializers.ModelSerializer):
    """Staff may change remarks and folder. Status is set automatically (see StaffConcernDetailView)."""

    folder = serializers.PrimaryKeyRelatedField(queryset=ConcernFolder.objects.all(), required=False, allow_null=True)

    class Meta:
        model = Concern
        fields = ["status", "remarks", "folder"]
        read_only_fields = ["status"]


class StaffQuestionSerializer(AnsweredByMixin, serializers.ModelSerializer):
    """A question as staff see it: adds who asked it."""

    asker = serializers.CharField(source="citizen.display_name", read_only=True)
    asker_email = serializers.CharField(source="citizen.email", read_only=True)
    is_answered = serializers.BooleanField(read_only=True)
    answered_by_name = serializers.SerializerMethodField()
    answered_by_role = serializers.SerializerMethodField()

    class Meta:
        model = Question
        fields = [
            "id", "asker", "asker_email", "question", "answer",
            "is_answered", "created_at", "answered_at",
            "answered_by_name", "answered_by_role",
        ]


def _not_blank(value, message):
    value = value.strip()
    if not value:
        raise serializers.ValidationError(message)
    return value


class StaffQuestionAnswerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = ["answer"]

    def validate_answer(self, value):
        return _not_blank(value, "Answer can't be empty.")


class FAQSerializer(serializers.ModelSerializer):
    """Public FAQ list; Administrators can add, edit and delete entries."""

    class Meta:
        model = FAQ
        fields = ["id", "question", "answer", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_question(self, value):
        return _not_blank(value, "Question can't be empty.")

    def validate_answer(self, value):
        return _not_blank(value, "Answer can't be empty.")
