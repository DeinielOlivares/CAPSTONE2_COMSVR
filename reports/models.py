"""
Reports — database tables for what citizens submit.

    Report                  an ordinance-violation report (File a Report)
    ReportAttachment        a photo/video attached to a report
    ReportVerificationCode  6-digit code confirming it's really the citizen filing
    ConcernFolder           a category the Secretary files concerns under
    Concern                 a concern/suggestion (Submit Suggestion)
    ConcernAttachment       a photo/video attached to a concern
    Question                a question asked from the FAQs page
    FAQ                     a public FAQ entry written by an Administrator
"""

import uuid

from django.conf import settings
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from orms_backend.encrypted_fields import EncryptedTextField
from orms_backend.encrypted_storage import encrypted_storage


class Report(models.Model):
    """An ordinance-violation report filed by a citizen."""

    class Status(models.TextChoices):
        # The 4 stages of the status timeline. The last stage has two
        # outcomes: Resolved, or With Remarks.
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        IN_ACTION = "in_action", "In Action"
        RESOLVED = "resolved", "Resolved"
        WITH_REMARKS = "with_remarks", "With Remarks"

    # The two statuses that close a report.
    CLOSED_STATUSES = (Status.RESOLVED, Status.WITH_REMARKS)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports")
    # The street where it happened (encrypted).
    location = EncryptedTextField(max_length=255)
    # The citizen's device position, if they allowed it and it was inside the
    # barangay. Otherwise empty, and the heatmap uses the street's point.
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    # The ordinance as the citizen cited it ("number — title"), kept as text so
    # the report still shows what was cited even if the ordinance is later
    # edited or archived.
    ordinance = models.TextField()
    incident_date = models.DateField()
    incident_time = models.TimeField(null=True, blank=True)  # optional: often unknown
    nature_of_violation = EncryptedTextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    remarks = EncryptedTextField(blank=True)
    # The Investigator who claimed this report (empty = unclaimed).
    assigned_investigator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="claimed_reports"
    )
    # When the assigned Investigator last opened the report (shown to the citizen).
    investigator_last_viewed_at = models.DateTimeField(null=True, blank=True)
    # Who held the claim before it was released, so the citizen is emailed
    # only when a *different* Investigator takes over.
    previous_investigator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # "YYYYMMDD-N": the Nth report filed that day (e.g. "20260101-5"). Never renumbered.
    report_number = models.CharField(max_length=20, unique=True, null=True, blank=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.ordinance} — {self.citizen} ({self.status})"

    def save(self, *args, **kwargs):
        if self.report_number or not self._state.adding:
            return super().save(*args, **kwargs)
        # Give a new report its number. If two reports are filed at the same
        # moment and get the same number, the unique constraint stops the
        # second one, which then retries with the next number.
        for attempt in range(5):
            self.report_number = next_report_number(timezone.localdate())
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                clash = Report.objects.filter(report_number=self.report_number).exists()
                self.report_number = None
                if not clash or attempt == 4:
                    raise


def next_report_number(day):
    """The next unused "YYYYMMDD-N" for `day`."""
    prefix = day.strftime("%Y%m%d") + "-"
    taken = Report.objects.filter(report_number__startswith=prefix).values_list("report_number", flat=True)
    highest = max((int(n[len(prefix):]) for n in taken if n[len(prefix):].isdigit()), default=0)
    return f"{prefix}{highest + 1}"


class ReportAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="attachments")
    # Photos are stored encrypted; videos are not (see orms_backend/encrypted_storage.py).
    file = models.FileField(upload_to="reports/%Y/%m/", storage=encrypted_storage)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ReportVerificationCode(models.Model):
    """
    6-digit code that confirms the account owner is the one filing a report.
    Needed for a citizen's first report, and again after 30 days without one
    (see reports/verification.py).
    """

    CODE_TTL_MINUTES = 15
    # After verifying, the citizen has this long to finish and submit the form.
    VERIFIED_GRACE_MINUTES = 60

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="report_verification_codes"
    )
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)  # see orms_backend/codes.py

    def is_valid(self):
        return self.verified_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.expires_at = timezone.now()
        self.save(update_fields=["expires_at"])

    def __str__(self):
        return f"Report verification code for {self.user}"


class ConcernFolder(models.Model):
    """A category (e.g. "Noise") the Secretary files concerns/suggestions under."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Concern(models.Model):
    """A concern or suggestion submitted by a citizen."""

    class Status(models.TextChoices):
        SUBMITTED = "submitted", "Submitted"
        REVIEWED = "reviewed", "Reviewed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concerns")
    location = EncryptedTextField(max_length=255, blank=True)
    description = EncryptedTextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    remarks = EncryptedTextField(blank=True)
    # When it became Reviewed (used for "typical time to review" on the dashboard).
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Deleting a folder leaves its concerns without a folder.
    folder = models.ForeignKey(ConcernFolder, on_delete=models.SET_NULL, null=True, blank=True, related_name="concerns")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Concern from {self.citizen} ({self.status})"


class ConcernAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    concern = models.ForeignKey(Concern, on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField(upload_to="concerns/%Y/%m/", storage=encrypted_storage)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class Question(models.Model):
    """
    A question a citizen asks from the FAQs page, answered by staff.
    It counts as answered when `answer` is filled in. Answered questions are
    kept so an Administrator can turn common ones into FAQs.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="questions")
    question = EncryptedTextField()
    answer = models.TextField(blank=True)
    answered_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="answered_questions"
    )
    answered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Question from {self.citizen}: {self.question[:50]}"

    @property
    def is_answered(self):
        return bool(self.answer)


class FAQ(models.Model):
    """One entry on the public FAQs page, written by an Administrator."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    question = models.CharField(max_length=255)
    answer = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        verbose_name = "FAQ"
        verbose_name_plural = "FAQs"

    def __str__(self):
        return self.question
