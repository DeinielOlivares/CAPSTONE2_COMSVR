from django.core.files.base import ContentFile
from django.core.files.storage import storages
from django.core.management.base import BaseCommand

from accounts.models import VoterVerification
from orms_backend.encrypted_storage import _is_video, is_encrypted_name
from reports.models import ConcernAttachment, ReportAttachment

TARGETS = [
    (VoterVerification, "voter_id_image"),
    (ReportAttachment, "file"),
    (ConcernAttachment, "file"),
]


class Command(BaseCommand):
    help = (
        "Encrypts voter's ID images and report/concern attachments that were uploaded before "
        "those files were stored encrypted (see orms_backend/encrypted_storage.py). Videos are "
        "left as they are. Safe to run more than once; use --dry-run first to see what it would do."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="List the files without changing anything.")
        parser.add_argument(
            "--keep-originals", action="store_true",
            help="Leave the unencrypted original in storage instead of deleting it after converting.",
        )

    def handle(self, *args, dry_run, keep_originals, **options):
        plain = storages["default"]
        converted = skipped = failed = 0
        for model, field_name in TARGETS:
            for row in model.objects.exclude(**{field_name: ""}).iterator():
                field_file = getattr(row, field_name)
                old_name = field_file.name
                if is_encrypted_name(old_name) or _is_video(old_name):
                    skipped += 1
                    continue
                label = f"{model.__name__} {row.pk}: {old_name}"
                if dry_run:
                    self.stdout.write(f"would encrypt  {label}")
                    converted += 1
                    continue
                try:
                    with plain.open(old_name, "rb") as original:
                        data = original.read()
                    # Saved under the original name so the content type is taken
                    # from it; the storage replaces it with a random one.
                    field_file.save(old_name.rsplit("/", 1)[-1], ContentFile(data), save=False)
                    model.objects.filter(pk=row.pk).update(**{field_name: field_file.name})
                except Exception as exc:  # one unreadable file shouldn't stop the rest
                    failed += 1
                    self.stderr.write(f"FAILED         {label} ({exc})")
                    continue
                if not keep_originals:
                    try:
                        plain.delete(old_name)
                    except Exception as exc:
                        self.stderr.write(f"encrypted, but could not delete the original of {label} ({exc})")
                converted += 1
                self.stdout.write(f"encrypted      {label}")
        verb = "would be encrypted" if dry_run else "encrypted"
        self.stdout.write(
            self.style.SUCCESS(f"{converted} file(s) {verb}, {skipped} already encrypted or video, {failed} failed.")
        )
