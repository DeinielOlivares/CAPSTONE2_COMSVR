import base64
import io
import json
import os
import shutil
import tempfile
import time
from unittest import mock

from django.core.exceptions import FieldError, ImproperlyConfigured
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.db import connection
from django.test import TestCase, override_settings
from PIL import Image

from accounts.models import AuditLog, User, VoterVerification, log_action
from reports.models import Concern, ConcernAttachment, Question, Report, ReportAttachment

from . import encrypted_storage, modified_blowfish
from .encrypted_fields import decrypt_value, encrypt_value
from .encrypted_storage import EncryptedStorage, decrypt_bytes, encrypt_bytes, is_encrypted_name

TEST_KEY = base64.b64encode(b"k" * 32).decode()


def _raw(table, column, pk):
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT "{column}" FROM "{table}" WHERE id = %s', [pk])
        return cursor.fetchone()[0]


@override_settings(DATA_ENCRYPTION_KEY=TEST_KEY, MODIFIED_BLOWFISH_ITERATIONS=10)
class EncryptedFieldTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="juan", email="juan@test.com", password="x",
            first_name="Juan", last_name="Dela Cruz", contact_number="09171234567",
            address="Block 1, Lot 2, Main Street",
        )

    def test_stored_value_is_ciphertext_and_reads_back_as_text(self):
        raw = _raw("accounts_user", "address", self.user.pk)
        self.assertNotIn("Main Street", raw)
        self.assertEqual(set(json.loads(raw)), {"salt", "iv", "ciphertext", "iterations"})
        fresh = User.objects.get(pk=self.user.pk)
        self.assertEqual(fresh.address, "Block 1, Lot 2, Main Street")
        self.assertEqual(fresh.get_full_name(), "Juan Dela Cruz")
        self.assertEqual(fresh.contact_number, "09171234567")

    def test_same_text_never_encrypts_the_same_way_twice(self):
        other = User.objects.create_user(
            username="ana", email="ana@test.com", password="x", address="Block 1, Lot 2, Main Street"
        )
        first = json.loads(_raw("accounts_user", "address", self.user.pk))
        second = json.loads(_raw("accounts_user", "address", other.pk))
        for part in ("salt", "iv", "ciphertext"):
            self.assertNotEqual(first[part], second[part])

    def test_blank_stays_blank_and_can_still_be_filtered(self):
        blank = User.objects.create_user(username="b", email="b@test.com", password="x")
        self.assertEqual(_raw("accounts_user", "address", blank.pk), "")
        self.assertEqual(list(User.objects.filter(address="")), [blank])

    def test_database_lookups_on_encrypted_text_are_refused(self):
        with self.assertRaises(FieldError):
            list(User.objects.filter(first_name="Juan"))
        with self.assertRaises(FieldError):
            list(User.objects.filter(address__icontains="Main"))

    def test_updates_and_long_unicode_text_round_trip(self):
        text = "Maingay na videoke hanggang 2:00 AM — Biñan, ₱500 multa. " * 40
        report = Report.objects.create(
            citizen=self.user, location="Main Street", ordinance="Ord 1 — Noise",
            incident_date="2026-10-01", nature_of_violation=text,
        )
        Report.objects.filter(pk=report.pk).update(remarks="Na-resolba na.")
        report.refresh_from_db()
        self.assertEqual(report.nature_of_violation, text)
        self.assertEqual(report.remarks, "Na-resolba na.")
        self.assertNotIn("videoke", _raw("reports_report", "nature_of_violation", report.pk))

    def test_iteration_count_travels_with_the_value(self):
        stored = encrypt_value("hello")
        self.assertEqual(json.loads(stored)["iterations"], 10)
        with override_settings(MODIFIED_BLOWFISH_ITERATIONS=25):
            self.assertEqual(decrypt_value(stored), "hello")

    def test_wrong_or_missing_key_fails_loudly(self):
        stored = encrypt_value("Confidential barangay case report")
        with override_settings(DATA_ENCRYPTION_KEY=base64.b64encode(b"z" * 32).decode()):
            try:
                self.assertNotEqual(decrypt_value(stored), "Confidential barangay case report")
            except ValueError:
                pass
        with override_settings(DATA_ENCRYPTION_KEY=""):
            with self.assertRaises(ImproperlyConfigured):
                encrypt_value("x")

    def test_value_written_before_encryption_is_read_as_is(self):
        with connection.cursor() as cursor:
            cursor.execute("UPDATE accounts_user SET address = %s WHERE id = %s", ["Old plain address", self.user.pk])
        self.assertEqual(User.objects.get(pk=self.user.pk).address, "Old plain address")

    def test_matches_the_algorithm_module(self):
        # What the field stores is exactly what the study's module produces.
        payload = json.loads(encrypt_value("Biñan"))
        iterations = payload.pop("iterations")
        self.assertEqual(modified_blowfish.decrypt_text(payload, base64.b64decode(TEST_KEY), iterations), "Biñan")
        self.assertEqual(len(base64.b64decode(payload["salt"])), modified_blowfish.SALT_LENGTH_BYTES)
        self.assertEqual(len(base64.b64decode(payload["iv"])), modified_blowfish.IV_LENGTH_BYTES)


def _png_bytes(color="red"):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    return buffer.getvalue()


@override_settings(DATA_ENCRYPTION_KEY=TEST_KEY, MODIFIED_BLOWFISH_ITERATIONS=10)
class EncryptedStorageTests(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        override = override_settings(
            MEDIA_ROOT=self.media_root,
            STORAGES={
                "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
                "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
            },
        )
        override.enable()
        self.addCleanup(override.disable)
        self.user = User.objects.create_user(username="juan", email="juan@test.com", password="x")
        self.png = _png_bytes()

    def _on_disk(self, name):
        with open(os.path.join(self.media_root, name), "rb") as stored:
            return stored.read()

    def test_voter_id_is_stored_as_ciphertext_under_a_random_name(self):
        verification = VoterVerification.objects.create(
            user=self.user, voter_id_image=SimpleUploadedFile("juan-dela-cruz-id.png", self.png, "image/png")
        )
        name = verification.voter_id_image.name
        self.assertTrue(is_encrypted_name(name))
        self.assertNotIn("juan", name)
        stored = self._on_disk(name)
        self.assertTrue(stored.startswith(b"MBF1"))
        self.assertNotIn(b"PNG", stored)
        self.assertNotIn(self.png[:16], stored)
        # Reading it back through the field gives the original image.
        self.assertEqual(VoterVerification.objects.get().voter_id_image.read(), self.png)

    def test_signed_link_serves_the_decrypted_image(self):
        verification = VoterVerification.objects.create(
            user=self.user, voter_id_image=SimpleUploadedFile("id.png", self.png, "image/png")
        )
        url = verification.voter_id_image.url
        self.assertTrue(url.startswith("/api/media/protected/"))
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/png")
        self.assertEqual(response.content, self.png)
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")

    def test_tampered_or_expired_links_are_refused(self):
        verification = VoterVerification.objects.create(
            user=self.user, voter_id_image=SimpleUploadedFile("id.png", self.png, "image/png")
        )
        url = verification.voter_id_image.url
        self.assertEqual(self.client.get(url[:-6] + "AAAAA/").status_code, 404)
        self.assertEqual(self.client.get("/api/media/protected/not-a-token/").status_code, 404)
        with mock.patch.object(encrypted_storage.time, "time", return_value=time.time() + 13 * 60 * 60):
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_non_image_attachments_are_encrypted_but_only_sent_as_downloads(self):
        concern = Concern.objects.create(citizen=self.user, description="x")
        attachment = ConcernAttachment.objects.create(
            concern=concern, file=SimpleUploadedFile("page.html", b"<script>alert(1)</script>", "text/html")
        )
        self.assertNotIn(b"script", self._on_disk(attachment.file.name))
        response = self.client.get(attachment.file.url)
        self.assertEqual(response["Content-Type"], "application/octet-stream")
        self.assertEqual(response["Content-Disposition"], "attachment")

    def test_videos_are_left_unencrypted_in_normal_storage(self):
        report = Report.objects.create(
            citizen=self.user, location="Main Street", ordinance="Ord 1", incident_date="2026-10-01",
            nature_of_violation="x",
        )
        attachment = ReportAttachment.objects.create(
            report=report, file=SimpleUploadedFile("clip.mp4", b"not-really-a-video", "video/mp4")
        )
        self.assertFalse(is_encrypted_name(attachment.file.name))
        self.assertEqual(self._on_disk(attachment.file.name), b"not-really-a-video")
        self.assertTrue(attachment.file.url.endswith(".mp4"))

    def test_deleting_removes_the_encrypted_file(self):
        storage = EncryptedStorage()
        name = storage.save("reports/2026/10/evidence.jpg", ContentFile(self.png))
        self.assertTrue(storage.exists(name))
        storage.delete(name)
        self.assertFalse(storage.exists(name))

    def test_blob_format_round_trips_and_differs_every_time(self):
        first, second = encrypt_bytes(self.png, "image/png"), encrypt_bytes(self.png, "image/png")
        self.assertNotEqual(first, second)
        self.assertEqual(decrypt_bytes(first), ("image/png", self.png))
        with self.assertRaises(ValueError):
            decrypt_bytes(self.png)

    def test_command_converts_files_uploaded_before_encryption(self):
        # A row pointing at a plain file in the normal storage, as older uploads do.
        os.makedirs(os.path.join(self.media_root, "verification/2026/09"))
        with open(os.path.join(self.media_root, "verification/2026/09/old-id.png"), "wb") as plain:
            plain.write(self.png)
        verification = VoterVerification.objects.create(user=self.user, voter_id_image="verification/2026/09/old-id.png")
        # Still readable before conversion, straight from normal storage.
        self.assertEqual(verification.voter_id_image.read(), self.png)
        self.assertEqual(verification.voter_id_image.url, "/media/verification/2026/09/old-id.png")

        call_command("encrypt_existing_files", "--dry-run", stdout=io.StringIO())
        verification.refresh_from_db()
        self.assertFalse(is_encrypted_name(verification.voter_id_image.name))

        call_command("encrypt_existing_files", stdout=io.StringIO())
        verification.refresh_from_db()
        self.assertTrue(is_encrypted_name(verification.voter_id_image.name))
        self.assertEqual(verification.voter_id_image.read(), self.png)
        self.assertFalse(os.path.exists(os.path.join(self.media_root, "verification/2026/09/old-id.png")))
        # Running it again changes nothing.
        name = verification.voter_id_image.name
        call_command("encrypt_existing_files", stdout=io.StringIO())
        verification.refresh_from_db()
        self.assertEqual(verification.voter_id_image.name, name)


@override_settings(DATA_ENCRYPTION_KEY=TEST_KEY, MODIFIED_BLOWFISH_ITERATIONS=10)
class MoreEncryptedTextTests(TestCase):
    def test_location_question_and_audit_name_are_ciphertext_in_the_database(self):
        user = User.objects.create_user(
            username="juan", email="juan@test.com", password="x", first_name="Juan", last_name="Dela Cruz"
        )
        report = Report.objects.create(
            citizen=user, location="Block 1, Lot 2, Main Street", ordinance="Ord 1",
            incident_date="2026-10-01", nature_of_violation="x",
        )
        question = Question.objects.create(citizen=user, question="Bakit bawal mag-videoke?")
        log_action(user, "Filed a report")
        log = AuditLog.objects.get()

        self.assertNotIn("Main Street", _raw("reports_report", "location", report.pk))
        self.assertNotIn("videoke", _raw("reports_question", "question", question.pk))
        self.assertNotIn("Juan", _raw("accounts_auditlog", "owner_name", log.pk))
        self.assertEqual(Report.objects.get().location, "Block 1, Lot 2, Main Street")
        self.assertEqual(Question.objects.get().question, "Bakit bawal mag-videoke?")
        self.assertEqual(log.owner_name, "Juan Dela Cruz")
