from django.utils import timezone
from rest_framework import serializers

from orms_backend.codes import CODE_EXHAUSTED, CODE_OK, check_code

from .models import FAQ, Concern, ConcernAttachment, ConcernFolder, Question, Report, ReportAttachment, ReportVerificationCode

MAX_ATTACHMENTS = 5
MAX_TOTAL_ATTACHMENT_BYTES = 50 * 1024 * 1024

# Rough box around Barangay Platero (the street centroids in
# frontend/staff/js/street-coordinates.js span 14.303-14.331 N,
# 121.069-121.098 E) plus ~1km of slack. A device position outside it means
# the citizen isn't filing from the scene (or the reading is bad), so it's
# dropped and the report falls back to its street on the heatmap.
BARANGAY_LAT_RANGE = (14.29, 14.34)
BARANGAY_LNG_RANGE = (121.06, 121.11)


def validate_attachment_files(files):
    if len(files) > MAX_ATTACHMENTS:
        raise serializers.ValidationError(f"You can attach at most {MAX_ATTACHMENTS} files.")
    if sum(f.size for f in files) > MAX_TOTAL_ATTACHMENT_BYTES:
        raise serializers.ValidationError("Attachments can't total more than 50MB.")
    return files


class ReportSerializer(serializers.ModelSerializer):
    """
    Backs both filing a report (POST, from file-report.html) and viewing it
    (GET, from My Reports/My Report Detail) — write-only `files` accepts the
    upload dropzone's selection, `attachments` is what's read back.
    """

    files = serializers.ListField(
        child=serializers.FileField(), write_only=True, required=False, allow_empty=True
    )
    attachments = serializers.SerializerMethodField(read_only=True)
    claimed_by = serializers.SerializerMethodField(read_only=True)
    # The citizen's own name/contact, for the downloadable report form (see
    # frontend/citizen/js/report-form-download.js) — it's their own report.
    reporter = serializers.SerializerMethodField(read_only=True)
    contact_number = serializers.CharField(source="citizen.contact_number", read_only=True)

    class Meta:
        model = Report
        fields = [
            "id", "location", "latitude", "longitude", "ordinance", "incident_date", "incident_time",
            "nature_of_violation", "status", "remarks", "created_at", "updated_at",
            "files", "attachments", "claimed_by", "investigator_last_viewed_at",
            "reporter", "contact_number",
        ]
        read_only_fields = [
            "id", "status", "remarks", "created_at", "updated_at", "investigator_last_viewed_at",
        ]

    def validate_files(self, files):
        return validate_attachment_files(files)

    def get_reporter(self, obj):
        return obj.citizen.get_full_name() or obj.citizen.username

    def get_claimed_by(self, obj):
        if not obj.assigned_investigator:
            return None
        return obj.assigned_investigator.get_full_name() or obj.assigned_investigator.username

    def validate(self, attrs):
        lat, lng = attrs.get("latitude"), attrs.get("longitude")
        in_barangay = (
            lat is not None and lng is not None
            and BARANGAY_LAT_RANGE[0] <= lat <= BARANGAY_LAT_RANGE[1]
            and BARANGAY_LNG_RANGE[0] <= lng <= BARANGAY_LNG_RANGE[1]
        )
        # Silently dropped rather than rejected — the coordinates are a bonus
        # on top of the required street, never a reason to refuse a report.
        if not in_barangay:
            attrs.pop("latitude", None)
            attrs.pop("longitude", None)
        return attrs

    def get_attachments(self, obj):
        request = self.context.get("request")
        urls = [a.file.url for a in obj.attachments.all()]
        return [request.build_absolute_uri(u) for u in urls] if request else urls

    def create(self, validated_data):
        files = validated_data.pop("files", [])
        validated_data["citizen"] = self.context["request"].user
        report = Report.objects.create(**validated_data)
        for f in files:
            ReportAttachment.objects.create(report=report, file=f)
        return report


class ConcernSerializer(serializers.ModelSerializer):
    """Backs both submitting a concern/suggestion and viewing it — same shape as ReportSerializer."""

    files = serializers.ListField(
        child=serializers.FileField(), write_only=True, required=False, allow_empty=True
    )
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

    def get_attachments(self, obj):
        request = self.context.get("request")
        urls = [a.file.url for a in obj.attachments.all()]
        return [request.build_absolute_uri(u) for u in urls] if request else urls

    def create(self, validated_data):
        files = validated_data.pop("files", [])
        validated_data["citizen"] = self.context["request"].user
        concern = Concern.objects.create(**validated_data)
        for f in files:
            ConcernAttachment.objects.create(concern=concern, file=f)
        return concern


class StaffReportSerializer(serializers.ModelSerializer):
    """
    Read side for Staff/Admin (View Reports / Reports Dashboard) — adds who
    filed it, since the citizen-facing ReportSerializer has no reason to
    expose that about its own owner. assignedInvestigator/Id show who's
    claimed this report (see StaffReportClaimView/StaffReportForfeitView) —
    visible to every Staff role, not just Investigators, so Barangay
    Captain/Secretary can see who's working a report too.
    """

    reporter = serializers.SerializerMethodField()
    # Lets the dashboard's geospatial analysis count distinct reporters —
    # two citizens can share a name, so `reporter` alone can't.
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
            "assignedInvestigator", "assignedInvestigatorId",
        ]

    def get_reporter(self, obj):
        return obj.citizen.get_full_name() or obj.citizen.username

    def get_assignedInvestigator(self, obj):
        if not obj.assigned_investigator:
            return None
        return obj.assigned_investigator.get_full_name() or obj.assigned_investigator.username

    def get_attachments(self, obj):
        request = self.context.get("request")
        urls = [a.file.url for a in obj.attachments.all()]
        return [request.build_absolute_uri(u) for u in urls] if request else urls


class StaffReportUpdateSerializer(serializers.ModelSerializer):
    """PATCH-only — status/remarks are the only things Staff/Admin get to change on someone else's report."""

    class Meta:
        model = Report
        fields = ["status", "remarks"]


class ConcernFolderSerializer(serializers.ModelSerializer):
    """Folder CRUD for the Concerns/Suggestions sidebar — `count` is how many concerns currently sit in it."""

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
        qs = ConcernFolder.objects.filter(name__iexact=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A folder with this name already exists.")
        return value


class ConcernFolderMiniSerializer(serializers.ModelSerializer):
    """Nested representation used on a concern — just enough to show/label the assigned folder."""

    class Meta:
        model = ConcernFolder
        fields = ["id", "name"]


class StaffConcernSerializer(serializers.ModelSerializer):
    """Read side for Staff/Admin (View Concerns/Suggestions Dashboard) — same idea as StaffReportSerializer."""

    reporter = serializers.SerializerMethodField()
    contact_number = serializers.CharField(source="citizen.contact_number", read_only=True)
    attachments = serializers.SerializerMethodField()
    folder = ConcernFolderMiniSerializer(read_only=True)

    class Meta:
        model = Concern
        fields = [
            "id", "reporter", "contact_number", "location", "description",
            "status", "remarks", "folder", "created_at", "updated_at", "reviewed_at", "attachments",
        ]

    def get_reporter(self, obj):
        return obj.citizen.get_full_name() or obj.citizen.username

    def get_attachments(self, obj):
        request = self.context.get("request")
        urls = [a.file.url for a in obj.attachments.all()]
        return [request.build_absolute_uri(u) for u in urls] if request else urls


class StaffConcernUpdateSerializer(serializers.ModelSerializer):
    """PATCH-only — status/remarks/folder are the only things Staff/Admin get to change on someone else's concern."""

    folder = serializers.PrimaryKeyRelatedField(
        queryset=ConcernFolder.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = Concern
        fields = ["status", "remarks", "folder"]


def _staff_role_label(user):
    """Human label for who answered a question — same idea as AdminAccountSerializer.get_type."""
    if not user:
        return None
    if user.role == user.Role.ADMIN:
        return "Administrator"
    return user.position or "Barangay Staff"


class QuestionSerializer(serializers.ModelSerializer):
    """Backs the citizen FAQs page: POST a new question, GET the citizen's own (with any answer)."""

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

    def get_answered_by_name(self, obj):
        return obj.answered_by.get_full_name() or obj.answered_by.username if obj.answered_by else None

    def get_answered_by_role(self, obj):
        return _staff_role_label(obj.answered_by)

    def create(self, validated_data):
        validated_data["citizen"] = self.context["request"].user
        return Question.objects.create(**validated_data)


class StaffQuestionSerializer(serializers.ModelSerializer):
    """
    Read side for every Barangay Staff role's Questions page — adds who
    asked it, same idea as StaffReportSerializer, plus who answered it
    (name + role) so any staff member can see that, not just whoever
    answered.
    """

    asker = serializers.SerializerMethodField()
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

    def get_asker(self, obj):
        return obj.citizen.get_full_name() or obj.citizen.username

    def get_answered_by_name(self, obj):
        return obj.answered_by.get_full_name() or obj.answered_by.username if obj.answered_by else None

    def get_answered_by_role(self, obj):
        return _staff_role_label(obj.answered_by)


class StaffQuestionAnswerSerializer(serializers.ModelSerializer):
    """PATCH-only — answering a question is the only thing Staff/Admin do to one."""

    class Meta:
        model = Question
        fields = ["answer"]

    def validate_answer(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Answer can't be empty.")
        return value


class FAQSerializer(serializers.ModelSerializer):
    """Public FAQ list (citizen FAQs page, read-only there) — full CRUD for Admin."""

    class Meta:
        model = FAQ
        fields = ["id", "question", "answer", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_question(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Question can't be empty.")
        return value

    def validate_answer(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Answer can't be empty.")
        return value


class ReportVerifyCodeSerializer(serializers.Serializer):
    """
    POST /api/reports/verify-code/ — checks the code emailed by
    ReportSendVerificationView. Scoped to the logged-in citizen (not email —
    they're already authenticated), unlike PasswordResetVerifySerializer
    which runs before login.
    """

    code = serializers.CharField()

    def validate(self, attrs):
        user = self.context["request"].user
        # Newest unverified code only, with wrong guesses counted against it —
        # see orms_backend/codes.py.
        verification_code = (
            ReportVerificationCode.objects.filter(user=user, verified_at__isnull=True)
            .order_by("-created_at")
            .first()
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
