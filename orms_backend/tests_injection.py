"""SQL injection checks: classic injection strings sent through every kind of
input the API takes (login fields, URL query parameters, path IDs, saved free
text) must be treated as plain data — no login bypass, no server error, no
change to the database."""

from django.core.cache import cache
from rest_framework.test import APITestCase

from accounts.models import User
from reports.models import Concern, Report

PAYLOADS = [
    "' OR '1'='1",
    "' OR '1'='1' --",
    "admin@test.com' --",
    "\" OR \"\"=\"",
    "1; DROP TABLE accounts_user; --",
    "' UNION SELECT id, password FROM accounts_user --",
    "'; UPDATE accounts_user SET role='admin' WHERE '1'='1",
]
PASSWORD = "Str0ng!Pass#2026x"


class SqlInjectionTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.admin = User.objects.create_user(
            username="adm", email="admin@test.com", password=PASSWORD, role=User.Role.ADMIN, is_verified=True
        )
        self.citizen = User.objects.create_user(
            username="cit", email="cit@test.com", password=PASSWORD, is_verified=True
        )
        self.investigator = User.objects.create_user(
            username="inv", email="inv@test.com", password=PASSWORD, role=User.Role.STAFF,
            position="Investigator", is_verified=True,
        )
        Report.objects.create(
            citizen=self.citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
            nature_of_violation="Dumping garbage",
        )

    def _login(self, email, password):
        cache.clear()  # keep the login rate limit out of the way of these checks
        return self.client.post("/api/auth/login/", {"email": email, "password": password}, format="json")

    def test_login_fields_cannot_bypass_authentication(self):
        for payload in PAYLOADS:
            with self.subTest(field="email", payload=payload):
                response = self._login(payload, "anything")
                self.assertIn(response.status_code, (400, 401))
                self.assertNotIn("access", response.data)
            with self.subTest(field="password", payload=payload):
                response = self._login("admin@test.com", payload)
                self.assertIn(response.status_code, (400, 401))
                self.assertNotIn("access", response.data)
        # The real password still works afterwards — nothing was altered.
        self.assertEqual(self._login("admin@test.com", PASSWORD).status_code, 200)

    def test_query_parameters_are_not_executed(self):
        self.client.force_authenticate(self.investigator)
        for payload in PAYLOADS:
            with self.subTest(param="assigned_to", payload=payload):
                response = self.client.get("/api/reports/staff/", {"assigned_to": payload})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, [])
            with self.subTest(param="q", payload=payload):
                response = self.client.get("/api/ordinances/suggest/", {"q": payload})
                self.assertEqual(response.status_code, 200)

    def test_path_ids_are_not_executed(self):
        self.client.force_authenticate(self.investigator)
        for payload in PAYLOADS:
            with self.subTest(payload=payload):
                response = self.client.get(f"/api/reports/staff/{payload}/")
                self.assertEqual(response.status_code, 404)

    def test_free_text_is_stored_literally(self):
        self.client.force_authenticate(self.citizen)
        for payload in PAYLOADS:
            with self.subTest(payload=payload):
                cache.clear()
                response = self.client.post("/api/concerns/", {"description": payload}, format="multipart")
                self.assertEqual(response.status_code, 201)
                saved = Concern.objects.get(pk=response.data["id"])
                self.assertEqual(saved.description, payload)

    def test_database_is_unchanged_after_all_payloads(self):
        self.test_login_fields_cannot_bypass_authentication()
        self.test_query_parameters_are_not_executed()
        self.assertEqual(User.objects.count(), 3)
        self.assertEqual(User.objects.filter(role=User.Role.ADMIN).count(), 1)
        self.assertEqual(Report.objects.count(), 1)
