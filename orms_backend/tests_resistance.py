"""Resistance checks: malformed, oversized, tampered or unauthorized requests
must be refused cleanly (a 4xx answer), never crash the server (5xx) or slip
through."""

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient, APITestCase

from accounts.models import User
from reports.models import Concern, Report

PASSWORD = "Str0ng!Pass#2026x"


class ResistanceTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.citizen = User.objects.create_user(username="cit", email="cit@test.com", password=PASSWORD, is_verified=True)
        self.other_citizen = User.objects.create_user(username="cit2", email="cit2@test.com", password=PASSWORD, is_verified=True)
        self.secretary = User.objects.create_user(
            username="sec", email="sec@test.com", password=PASSWORD, role=User.Role.STAFF,
            position="Secretary", is_verified=True,
        )
        self.report = Report.objects.create(
            citizen=self.other_citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
            nature_of_violation="Dumping garbage",
        )

    def test_malformed_json_is_rejected(self):
        response = self.client.post("/api/auth/login/", data="{not json", content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_missing_fields_are_rejected(self):
        self.assertEqual(self.client.post("/api/auth/login/", {}, format="json").status_code, 400)
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.post("/api/concerns/", {}, format="multipart").status_code, 400)

    def test_tampered_or_fake_tokens_are_refused(self):
        token = self.client.post(
            "/api/auth/login/", {"email": "cit@test.com", "password": PASSWORD}, format="json"
        ).data["access"]
        header, payload, signature = token.split(".")
        for bad in (f"{header}.{payload}.{signature[:-4]}AAAA", "not.a.token", "Bearer"):
            with self.subTest(token=bad):
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=f"Bearer {bad}")
                self.assertEqual(client.get("/api/reports/").status_code, 401)

    def test_anonymous_requests_need_login(self):
        for url in ("/api/reports/", "/api/concerns/", "/api/reports/staff/", "/api/concerns/staff/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 401)

    def test_citizen_cannot_reach_staff_or_admin_endpoints(self):
        self.client.force_authenticate(self.citizen)
        for url in ("/api/reports/staff/", "/api/concerns/staff/", "/api/auth/admin/users/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 403)

    def test_citizen_cannot_open_someone_elses_report(self):
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/").status_code, 404)

    def test_staff_cannot_change_a_report_outside_their_role(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.patch(f"/api/reports/staff/{self.report.id}/", {"status": "resolved"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, Report.Status.SUBMITTED)

    def test_too_many_attachments_are_rejected(self):
        self.client.force_authenticate(self.citizen)
        files = [SimpleUploadedFile(f"p{i}.jpg", b"\xff\xd8\xff" + b"0" * 10, "image/jpeg") for i in range(6)]
        response = self.client.post("/api/concerns/", {"description": "x", "files": files}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Concern.objects.count(), 0)

    def test_very_long_text_does_not_crash(self):
        self.client.force_authenticate(self.citizen)
        response = self.client.post("/api/concerns/", {"description": "A" * 100_000}, format="multipart")
        self.assertLess(response.status_code, 500)

    def test_bad_ids_in_the_address_are_404_not_500(self):
        self.client.force_authenticate(self.secretary)
        for url in ("/api/reports/staff/not-a-uuid/", "/api/concerns/staff/123/", "/api/ordinances/00000000-0000-0000-0000-000000000000/"):
            with self.subTest(url=url):
                self.assertEqual(self.client.get(url).status_code, 404)
