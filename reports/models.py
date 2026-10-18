import uuid

from django.conf import settings
from django.db import IntegrityError, models, transaction

from orms_backend.encrypted_fields import EncryptedTextField
from orms_backend.encrypted_storage import encrypted_storage
from django.utils import timezone


class Report(models.Model):
    """An ordinance-violation report filed by a citizen (File Report)."""

    class Status(models.TextChoices):
        # Mirrors the 4 stages shown in the status timeline on the detail
        # pages (Submitted -> Under Review -> In Action -> Resolved/With
        # Remarks). The last stage has two possible outcomes: Resolved, or
        # With Remarks (closed, with the Investigator's remarks explaining
        # the outcome) — either one completes the timeline. The remarks
        # text itself is still a plain always-editable field (see
        # StaffReportUpdateSerializer/report-detail.js).
        SUBMITTED = "submitted", "Submitted"
        UNDER_REVIEW = "under_review", "Under Review"
        IN_ACTION = "in_action", "In Action"
        RESOLVED = "resolved", "Resolved"
        WITH_REMARKS = "with_remarks", "With Remarks"

    # The two statuses that close a report (the timeline's last stage).
    CLOSED_STATUSES = (Status.RESOLVED, Status.WITH_REMARKS)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reports")
    # Encrypted at rest. The heatmap groups by it in the browser, after the API
    # has decrypted it, so nothing needs the database to read it.
    location = EncryptedTextField(max_length=255)
    # The citizen's device position when they filed, if they allowed the
    # browser's location prompt (see file-report.js). Null when they denied
    # it, it timed out, or it fell outside the barangay — the staff heatmap
    # then falls back to the street centroid parsed from `location`.
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    # Free text rather than a FK — Ordinances aren't backed by a real model
    # yet (frontend/citizen/js/ordinances-data.js is still a hardcoded
    # array), so this just stores whichever option label the citizen picked.
    # TextField: that label is "number — title", and Ordinance.title is
    # unbounded (real titles exceed 255 characters).
    ordinance = models.TextField()
    incident_date = models.DateField()
    # Nullable — the exact time of an incident is often unknown (ongoing or
    # long-standing violations), so a citizen can leave it blank.
    incident_time = models.TimeField(null=True, blank=True)
    # The report's narrative and the staff remarks on it are encrypted at rest
    # (Modified Blowfish — see orms_backend/encrypted_fields.py).
    nature_of_violation = EncryptedTextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    remarks = EncryptedTextField(blank=True)
    # The Investigator working this report — Reports is a shared claimable
    # queue (see StaffReportClaimView/StaffReportForfeitView) rather than
    # pre-assigned, so this starts blank and any Investigator can claim an
    # unclaimed report. Visible to every Barangay Staff role (Barangay
    # Captain's Reports Dashboard shows a per-investigator breakdown from
    # this field too — see reports-dashboard.js's investigator chart).
    assigned_investigator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="claimed_reports"
    )
    # Set each time the assigned Investigator opens this report's detail page
    # (see StaffReportDetailView.get) — shown to the citizen alongside who's
    # claimed it, so they can see it's actually being looked at.
    investigator_last_viewed_at = models.DateTimeField(null=True, blank=True)
    # Whoever last held this report's claim before it was forfeited (cleared
    # back to None once claimed again) — lets StaffReportClaimView tell
    # whether a new claimant is actually a *different* Investigator than
    # before, so the citizen is only emailed about an investigator swap, not
    # every claim.
    previous_investigator = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    # "YYYYMMDD-N" — the Nth report filed that day (Philippine time), e.g.
    # "20260101-5" for the fifth report on January 1, 2026. Given once when
    # the report is filed and never renumbered (even if an earlier report is
    # later deleted), so it can name the Download Report PDF.
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
        # Two reports filed at the same moment can both work out the same
        # next number — the unique constraint stops the second one, which
        # then just takes the number after it.
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
    """The next unused "YYYYMMDD-N" for `day` (see Report.report_number)."""
    prefix = day.strftime("%Y%m%d") + "-"
    taken = Report.objects.filter(report_number__startswith=prefix).values_list("report_number", flat=True)
    highest = max((int(n[len(prefix):]) for n in taken if n[len(prefix):].isdigit()), default=0)
    return f"{prefix}{highest + 1}"


class ReportAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="attachments")
    # Photos are stored encrypted (Modified Blowfish); videos are not — see
    # orms_backend/encrypted_storage.py.
    file = models.FileField(upload_to="reports/%Y/%m/", storage=encrypted_storage)
    uploaded_at = models.DateTimeField(auto_now_add=True)


class ConcernFolder(models.Model):
    """
    A staff-defined category concerns/suggestions can be filed under (e.g.
    "No Vaping in Public"). Exists to group similar concerns for the staff
    Concerns/Suggestions dashboard's category breakdown, the same role
    Report.ordinance plays for Reports.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Concern(models.Model):
    """A concern/suggestion filed by a citizen (Submit Suggestion)."""

    class Status(models.TextChoices):
        # "Reviewed" rather than "Resolved": this covers suggestions as well
        # as concerns, and a suggestion gets read and answered (see remarks),
        # not resolved — unlike a Report, which is a case that gets closed.
        SUBMITTED = "submitted", "Submitted"
        REVIEWED = "reviewed", "Reviewed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="concerns")
    location = EncryptedTextField(max_length=255, blank=True)
    # Encrypted at rest, same as Report's narrative and remarks.
    description = EncryptedTextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    remarks = EncryptedTextField(blank=True)
    # When the Secretary marked this Reviewed (cleared if it's moved back to
    # Submitted). updated_at can't stand in for it — assigning a folder or
    # editing remarks later moves that — and the Captain's dashboard needs
    # the real figure for "typical time to review".
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # Optional — staff assign a concern to a folder after reviewing it; a
    # deleted folder just leaves its concerns unfoldered rather than deleting them.
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
    A question a citizen asks from the FAQs page — answered by Staff/Admin
    (see StaffQuestionAnswerView). Deliberately has no "status" field like
    Report/Concern do: whether it's answered is just whether `answer` is
    non-empty, since there's nothing in between "asked" and "answered" here.
    Stays visible (never deleted) after being answered — see the FAQ model
    below for why: an admin scanning answered questions for a pattern worth
    promoting into a public FAQ needs the history to still be there.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    citizen = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="questions")
    # Encrypted at rest: free text a resident may put personal details in.
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
    """
    One entry on the public citizen FAQs page. Curated by Admin directly —
    separate from Question above (a citizen's one-off question) rather than
    the same model, since a FAQ is meant to read as a general, polished
    answer rather than a reply to one specific person's wording.
    """

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


class ReportVerificationCode(models.Model):
    """
    A short-lived 6-digit code emailed to confirm the real account owner is
    the one filing a report — required on a citizen's first-ever report, and
    again any time it's been more than REVERIFY_AFTER_DAYS since their last
    one (see reports/verification.py). Same shape as
    accounts.PasswordResetCode, but kept separate since it gates report
    filing specifically, not the account itself.
    """

    CODE_TTL_MINUTES = 15
    # Once verified, the code stays good for this long — enough time to
    # finish filling out the report form and hit Submit — after which
    # verifying again would be required.
    VERIFIED_GRACE_MINUTES = 60

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="report_verification_codes"
    )
    code = models.CharField(max_length=6)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    verified_at = models.DateTimeField(null=True, blank=True)
    # Wrong guesses so far; see orms_backend/codes.py for the cap.
    failed_attempts = models.PositiveSmallIntegerField(default=0)

    def is_valid(self):
        return self.verified_at is None and timezone.now() < self.expires_at

    def expire(self):
        self.expires_at = timezone.now()
        self.save(update_fields=["expires_at"])

    def __str__(self):
        return f"Report verification code for {self.user}"
