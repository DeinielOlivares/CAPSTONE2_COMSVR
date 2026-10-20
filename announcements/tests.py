import io
import shutil
import tempfile

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User

from .models import Announcement, AnnouncementView


def _auth(client, user):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")


class AnnouncementTests(TestCase):
    def setUp(self):
        self.secretary = User.objects.create_user(
            username="sec", email="sec@test.com", password="x", role=User.Role.STAFF,
            position="Secretary", is_verified=True,
        )
        self.investigator = User.objects.create_user(
            username="inv", email="inv@test.com", password="x", role=User.Role.STAFF,
            position="Investigator", is_verified=True,
        )
        self.citizen = User.objects.create_user(
            username="cit", email="cit@test.com", password="x", is_verified=True,
        )
        self.client = APIClient()

    def test_secretary_can_post_and_every_citizen_is_emailed(self):
        _auth(self.client, self.secretary)
        response = self.client.post(
            "/api/announcements/staff/", {"title": "Clean-up drive", "description": "Saturday 7AM."}, format="multipart"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Announcement.objects.count(), 1)
        self.assertEqual(Announcement.objects.get().posted_by, self.secretary)
        recipients = [addr for m in mail.outbox for addr in m.to]
        self.assertIn("cit@test.com", recipients)
        self.assertNotIn("inv@test.com", recipients)
        self.assertTrue(any("/citizen/home.html" in m.body or "/citizen/home.html" in m.alternatives[0][0] for m in mail.outbox))

    def test_investigator_cannot_post(self):
        _auth(self.client, self.investigator)
        response = self.client.post(
            "/api/announcements/staff/", {"title": "x", "description": "y"}, format="multipart"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Announcement.objects.count(), 0)

    def test_unread_banner_clears_after_marking_viewed(self):
        announcement = Announcement.objects.create(title="Hi", description="There")
        _auth(self.client, self.citizen)
        self.assertFalse(self.client.get("/api/announcements/").json()[0]["is_read"])

        self.assertEqual(self.client.post(f"/api/announcements/{announcement.id}/view/").status_code, 200)
        self.assertTrue(self.client.get("/api/announcements/").json()[0]["is_read"])
        self.assertEqual(AnnouncementView.objects.filter(user=self.citizen).count(), 1)

    def test_guest_sees_announcements_without_read_state(self):
        Announcement.objects.create(title="Hi", description="There")
        guest = APIClient()
        data = guest.get("/api/announcements/").json()
        self.assertEqual(len(data), 1)
        self.assertFalse(data[0]["is_read"])


def _png(color):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color).save(buffer, format="PNG")
    return SimpleUploadedFile("picture.png", buffer.getvalue(), content_type="image/png")


class AnnouncementEditTests(TestCase):
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
        self.secretary = User.objects.create_user(
            username="sec", email="sec@test.com", password="x", role=User.Role.STAFF,
            position="Secretary", is_verified=True,
        )
        User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        self.announcement = Announcement.objects.create(title="Hi", description="There")
        self.url = f"/api/announcements/staff/{self.announcement.id}/"
        self.client = APIClient()
        _auth(self.client, self.secretary)

    def test_editing_adds_replaces_and_removes_the_picture_without_emailing(self):
        response = self.client.patch(self.url, {"title": "Hello", "image": _png("red")}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.title, "Hello")
        first = self.announcement.image.name
        storage = self.announcement.image.storage
        self.assertTrue(storage.exists(first))

        self.assertEqual(self.client.patch(self.url, {"image": _png("blue")}, format="multipart").status_code, 200)
        self.announcement.refresh_from_db()
        second = self.announcement.image.name
        self.assertNotEqual(first, second)
        self.assertFalse(storage.exists(first))

        response = self.client.patch(self.url, {"remove_image": "true"}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["image_url"], "")
        self.announcement.refresh_from_db()
        self.assertFalse(self.announcement.image)
        self.assertFalse(storage.exists(second))
        self.assertEqual(mail.outbox, [])

    def test_editing_text_alone_keeps_the_picture(self):
        self.client.patch(self.url, {"image": _png("red")}, format="multipart")
        self.assertEqual(self.client.patch(self.url, {"description": "Updated"}, format="multipart").status_code, 200)
        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.description, "Updated")
        self.assertTrue(self.announcement.image)
