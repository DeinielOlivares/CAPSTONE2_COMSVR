from collections import defaultdict
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Count

from accounts.models import AuditLog
from reports.models import Concern, Report

# A submission's audit entry is written right after its uploads finish.
MAX_UPLOAD_TIME = timedelta(minutes=10)

TARGETS = [
    (Report, "Submitted a report"),
    (Concern, "Submitted a suggestion"),
]


def partial_submission_ids(model, action_prefix):
    """
    Records saved without their "submitted" audit entry, which is what a failed
    upload used to leave behind. Each entry is paired with that user's latest
    earlier record, so a failed attempt followed by a successful retry flags the
    failed one. Records older than the first such entry can't be judged.
    """
    logs = list(
        AuditLog.objects.filter(action__startswith=action_prefix, user__isnull=False)
        .order_by("created_at")
        .values_list("user_id", "created_at")
    )
    if not logs:
        return []

    pending = defaultdict(list)
    rows = (
        model.objects.filter(citizen__isnull=False, created_at__gte=logs[0][1] - MAX_UPLOAD_TIME)
        .order_by("created_at")
        .values_list("pk", "citizen_id", "created_at")
    )
    for pk, citizen_id, created_at in rows:
        pending[citizen_id].append((created_at, pk))

    for user_id, logged_at in logs:
        candidates = pending[user_id]
        for index in range(len(candidates) - 1, -1, -1):
            created_at = candidates[index][0]
            if created_at <= logged_at:
                if logged_at - created_at <= MAX_UPLOAD_TIME:
                    del candidates[index]
                break

    return [pk for records in pending.values() for _, pk in records]


class Command(BaseCommand):
    help = (
        "Lists reports and concerns that look like leftovers of a failed upload, for a person "
        "to review. Read-only: it changes and deletes nothing, and prints no personal details."
    )

    def handle(self, *args, **options):
        total = 0
        for model, action_prefix in TARGETS:
            ids = partial_submission_ids(model, action_prefix)
            total += len(ids)
            rows = (
                model.objects.filter(pk__in=ids)
                .annotate(files=Count("attachments"))
                .order_by("created_at")
                .values_list("pk", "created_at", "status", "files")
            )
            for pk, created_at, status, files in rows:
                self.stdout.write(f"{model.__name__}  {pk}  {created_at:%Y-%m-%d %H:%M} UTC  {status}  {files} file(s)")
        self.stdout.write(self.style.SUCCESS(f"{total} possible partial submission(s). Nothing was changed."))
