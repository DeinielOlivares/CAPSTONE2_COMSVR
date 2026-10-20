import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from accounts.models import AuditLog, User

from .models import AboutLogo, BarangayProfile, CouncilMember

TEMP_MEDIA = tempfile.mkdtemp()
LOCAL_STORAGE = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def png(name="photo.png", size=(40, 40)):
    buf = io.BytesIO()
    Image.new("RGB", size, (0, 153, 51)).save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


@override_settings(MEDIA_ROOT=TEMP_MEDIA, STORAGES=LOCAL_STORAGE)
class AboutUsTests(APITestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(TEMP_MEDIA, ignore_errors=True)

    def setUp(self):
        self.admin = User.objects.create_user(username="adm", email="adm@test.com", password="x", role=User.Role.ADMIN)
        self.staff = User.objects.create_user(
            username="sec", email="sec@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )

    def _logs(self):
        return list(AuditLog.objects.filter(user=self.admin).values_list("action", flat=True))

    # ---- public page ----

    def test_guests_can_read_the_seeded_about_page(self):
        data = self.client.get("/api/site/about/").json()
        self.assertEqual(data["profile"]["phone"], "0995 167 1070")
        self.assertEqual(len(data["council"]), 11)
        self.assertEqual(len(data["logos"]), 3)
        self.assertTrue(data["council"][0]["photoUrl"].startswith("/citizen/drawables/"))

    def test_hidden_members_and_logos_are_left_off_the_public_page(self):
        CouncilMember.objects.filter(name__contains="Belan").update(is_visible=False)
        AboutLogo.objects.filter(order=0).update(is_visible=False)
        data = self.client.get("/api/site/about/").json()
        self.assertEqual(len(data["council"]), 10)
        self.assertEqual(len(data["logos"]), 2)

    # ---- permissions ----

    def test_only_admins_can_edit(self):
        for user in (None, self.staff):
            self.client.force_authenticate(user)
            self.assertIn(self.client.patch("/api/site/profile/", {"phone": "1"}, format="json").status_code, (401, 403))
            self.assertIn(self.client.post("/api/site/council/", {"name": "X", "position": "Y"}).status_code, (401, 403))
        self.assertEqual(BarangayProfile.load().phone, "0995 167 1070")

    # ---- profile ----

    def test_admin_updates_details_and_the_log_names_what_changed(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            "/api/site/profile/", {"phone": "0917 000 0000", "office_hours": "Mon–Fri, 8 AM – 5 PM"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(BarangayProfile.load().phone, "0917 000 0000")
        self.assertIn("Updated About Us details: phone, office hours", self._logs())

    def test_invalid_email_is_rejected(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch("/api/site/profile/", {"email": "nope"}, format="json").status_code, 400)

    # ---- council ----

    def test_add_member_with_photo_goes_to_the_end_of_its_row(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/site/council/",
            {"name": "Hon. New Kagawad", "position": "Committee Chairman on Health", "group": "member", "photo": png()},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        member = CouncilMember.objects.get(name="Hon. New Kagawad")
        self.assertEqual(member.order, 8)  # 8 seeded members in that row, 0-7
        self.assertTrue(response.data["photoUrl"])
        self.assertIn("Added Hon. New Kagawad (Committee Chairman on Health) to About Us", self._logs())

    def test_non_image_and_oversized_uploads_are_rejected(self):
        self.client.force_authenticate(self.admin)
        fake = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        response = self.client.post("/api/site/council/", {"name": "A", "position": "B", "photo": fake}, format="multipart")
        self.assertEqual(response.status_code, 400)
        with self.settings(DATA_UPLOAD_MAX_MEMORY_SIZE=None):
            from siteinfo import serializers as s
            original = s.MAX_IMAGE_BYTES
            s.MAX_IMAGE_BYTES = 10
            try:
                response = self.client.post("/api/site/council/", {"name": "A", "position": "B", "photo": png()}, format="multipart")
            finally:
                s.MAX_IMAGE_BYTES = original
        self.assertEqual(response.status_code, 400)

    def test_edit_hide_and_delete_member_are_logged(self):
        self.client.force_authenticate(self.admin)
        member = CouncilMember.objects.get(name__contains="Belan")
        url = f"/api/site/council/{member.id}/"
        self.assertEqual(self.client.patch(url, {"is_visible": False}, format="json").status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 204)
        logs = self._logs()
        self.assertIn("Updated Hon. Melvin L. Belan (Committee Chairman on Peace and Order) on About Us", logs)
        self.assertIn("Removed Hon. Melvin L. Belan (Committee Chairman on Peace and Order) from About Us", logs)

    def test_reorder_sets_order_from_list_position(self):
        self.client.force_authenticate(self.admin)
        officers = list(CouncilMember.objects.filter(group="officer").order_by("order"))
        ids = [str(officers[1].id), str(officers[0].id)]
        self.assertEqual(self.client.post("/api/site/council/reorder/", {"ids": ids}, format="json").status_code, 200)
        officers[1].refresh_from_db()
        self.assertEqual(officers[1].order, 0)
        self.assertIn("Reordered council members on About Us", self._logs())

    def test_reorder_with_unknown_id_changes_nothing(self):
        self.client.force_authenticate(self.admin)
        member = CouncilMember.objects.first()
        bogus = "00000000-0000-0000-0000-000000000000"
        response = self.client.post("/api/site/council/reorder/", {"ids": [bogus, str(member.id)]}, format="json")
        self.assertEqual(response.status_code, 400)

    # ---- logos ----

    def test_new_logo_needs_an_image(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post("/api/site/logos/", {"alt_text": "Seal"}, format="multipart").status_code, 400)
        response = self.client.post("/api/site/logos/", {"alt_text": "New seal", "image": png()}, format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertIn('Added logo "New seal" to About Us', self._logs())

    def test_multipart_upload_without_visibility_defaults_to_shown(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/site/logos/", {"alt_text": "Seal", "image": png()}, format="multipart")
        self.assertTrue(response.data["is_visible"])
        response = self.client.post(
            "/api/site/council/", {"name": "A", "position": "B", "photo": png()}, format="multipart"
        )
        self.assertTrue(response.data["is_visible"])

    def test_partial_multipart_edit_keeps_visibility(self):
        self.client.force_authenticate(self.admin)
        member = CouncilMember.objects.get(name__contains="Belan")
        member.is_visible = False
        member.save()
        self.client.patch(f"/api/site/council/{member.id}/", {"photo": png()}, format="multipart")
        member.refresh_from_db()
        self.assertFalse(member.is_visible)

    def test_has_custom_photo_is_false_for_seeded_and_true_after_upload(self):
        data = self.client.get("/api/site/about/").json()
        self.assertFalse(any(m["hasCustomPhoto"] for m in data["council"]))
        self.client.force_authenticate(self.admin)
        member = CouncilMember.objects.get(name__contains="Belan")
        response = self.client.patch(f"/api/site/council/{member.id}/", {"photo": png()}, format="multipart")
        self.assertTrue(response.data["hasCustomPhoto"])


class BoundaryTests(APITestCase):
    SQUARE = [[14.31, 121.08], [14.31, 121.09], [14.32, 121.09], [14.32, 121.08]]

    def setUp(self):
        self.admin = User.objects.create_user(username="adm", email="adm@test.com", password="x", role=User.Role.ADMIN)
        self.staff = User.objects.create_user(
            username="cap", email="cap@test.com", password="x", role=User.Role.STAFF, position="Barangay Captain"
        )

    def test_anyone_can_read_the_seeded_outline(self):
        boundary = self.client.get("/api/site/boundary/").json()["boundary"]
        self.assertGreater(len(boundary), 100)
        self.assertTrue(all(14.30 < lat < 14.34 and 121.08 < lng < 121.10 for lat, lng in boundary))

    def test_only_admins_can_replace_it(self):
        for user in (None, self.staff):
            self.client.force_authenticate(user)
            response = self.client.put("/api/site/boundary/", {"boundary": self.SQUARE}, format="json")
            self.assertIn(response.status_code, (401, 403))
        self.assertNotEqual(BarangayProfile.load().boundary, self.SQUARE)

    def test_admin_saves_it_drops_a_repeated_closing_point_and_logs_it(self):
        self.client.force_authenticate(self.admin)
        response = self.client.put("/api/site/boundary/", {"boundary": self.SQUARE + [self.SQUARE[0]]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(BarangayProfile.load().boundary, self.SQUARE)
        self.assertIn(
            "Updated the barangay map boundary (4 points)",
            AuditLog.objects.filter(user=self.admin).values_list("action", flat=True),
        )

    def test_empty_list_removes_it(self):
        self.client.force_authenticate(self.admin)
        self.client.put("/api/site/boundary/", {"boundary": self.SQUARE}, format="json")
        self.client.put("/api/site/boundary/", {"boundary": []}, format="json")
        self.assertEqual(BarangayProfile.load().boundary, [])

    def test_rejects_too_few_points_and_swapped_coordinates(self):
        self.client.force_authenticate(self.admin)
        too_few = self.client.put("/api/site/boundary/", {"boundary": self.SQUARE[:2]}, format="json")
        swapped = self.client.put(
            "/api/site/boundary/", {"boundary": [[lng, lat] for lat, lng in self.SQUARE]}, format="json"
        )
        self.assertEqual(too_few.status_code, 400)
        self.assertEqual(swapped.status_code, 400)
        self.assertGreater(len(BarangayProfile.load().boundary), 20)
