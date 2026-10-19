import datetime

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import AuditLog
from .matching import suggest_ordinances
from .models import Ordinance, OrdinanceAuthor, OrdinanceCategory

User = get_user_model()


class OrdinanceArchiveTests(APITestCase):
    def setUp(self):
        self.secretary = User.objects.create_user(
            username="sec", email="sec@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.captain = User.objects.create_user(
            username="cap", email="cap@test.com", password="x", role=User.Role.STAFF, position="Barangay Captain"
        )
        self.ordinance = Ordinance.objects.create(
            number="No. 1-(2026)", title="Test Ordinance", author="Hon. Test",
            category="Test", date_approved=datetime.date.today(), description="desc",
            uploaded_by=self.secretary,
        )

    def test_public_list_shows_uploader_and_hides_archived(self):
        response = self.client.get("/api/ordinances/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["uploaded_by_name"], "sec")
        self.assertFalse(response.data[0]["is_archived"])

        self.ordinance.is_archived = True
        self.ordinance.save()
        response = self.client.get("/api/ordinances/")
        self.assertEqual(response.data, [])

    def test_staff_list_still_sees_archived(self):
        self.ordinance.is_archived = True
        self.ordinance.save()
        self.client.force_authenticate(self.captain)
        response = self.client.get("/api/ordinances/")
        self.assertEqual(len(response.data), 1)
        self.assertTrue(response.data[0]["is_archived"])

    def test_secretary_can_archive_and_it_is_logged(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.post(f"/api/ordinances/{self.ordinance.id}/archive/")
        self.assertEqual(response.status_code, 200)
        self.ordinance.refresh_from_db()
        self.assertTrue(self.ordinance.is_archived)
        self.assertTrue(AuditLog.objects.filter(action__icontains="Archived ordinance").exists())

        response = self.client.get("/api/ordinances/")
        self.assertEqual(len(response.data), 1)  # staff still sees it

        response = self.client.post(f"/api/ordinances/{self.ordinance.id}/unarchive/")
        self.assertEqual(response.status_code, 200)
        self.ordinance.refresh_from_db()
        self.assertFalse(self.ordinance.is_archived)
        self.assertTrue(AuditLog.objects.filter(action__icontains="Unarchived ordinance").exists())

    def test_captain_cannot_archive(self):
        self.client.force_authenticate(self.captain)
        response = self.client.post(f"/api/ordinances/{self.ordinance.id}/archive/")
        self.assertEqual(response.status_code, 403)

    def test_anonymous_cannot_archive(self):
        response = self.client.post(f"/api/ordinances/{self.ordinance.id}/archive/")
        self.assertIn(response.status_code, (401, 403))


class OrdinanceSuggestTests(APITestCase):
    def setUp(self):
        self.secretary = User.objects.create_user(
            username="sec2", email="sec2@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.business = Ordinance.objects.create(
            number="No. 1-(2026)", title="Business Permit Renewal", author="Hon. Test",
            category="Business", date_approved=datetime.date.today(),
            description="Requirements and deadlines for renewing a business permit annually.",
            uploaded_by=self.secretary,
        )
        self.curfew = Ordinance.objects.create(
            number="No. 2-(2026)", title="Minor Curfew Ordinance", author="Hon. Test",
            category="Public Order", date_approved=datetime.date.today(),
            description="Prohibits minors from being in public places late at night without a guardian.",
            uploaded_by=self.secretary,
        )

    def test_relevant_query_ranks_matching_ordinance_first(self):
        response = self.client.get("/api/ordinances/suggest/", {"q": "my minor child was out past midnight alone"})
        self.assertEqual(response.status_code, 200)
        results = response.data["results"]
        self.assertTrue(results)
        self.assertEqual(results[0]["id"], str(self.curfew.id))

    def test_short_query_returns_empty(self):
        response = self.client.get("/api/ordinances/suggest/", {"q": "hi"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    def test_missing_query_returns_empty(self):
        response = self.client.get("/api/ordinances/suggest/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])

    def test_archived_ordinance_never_suggested(self):
        self.curfew.is_archived = True
        self.curfew.save()
        response = self.client.get("/api/ordinances/suggest/", {"q": "my minor child was out past midnight alone"})
        ids = [r["id"] for r in response.data["results"]]
        self.assertNotIn(str(self.curfew.id), ids)

    def test_unrelated_query_below_threshold_returns_empty(self):
        response = self.client.get("/api/ordinances/suggest/", {"q": "asdf qwer zxcv nonsense words"})
        self.assertEqual(response.data["results"], [])

    def test_fewer_than_two_ordinances_returns_empty(self):
        Ordinance.objects.all().delete()
        Ordinance.objects.create(
            number="No. 3-(2026)", title="Solo Ordinance", author="Hon. Test",
            category="Test", date_approved=datetime.date.today(), description="Only one exists.",
        )
        response = self.client.get("/api/ordinances/suggest/", {"q": "solo ordinance test query text here"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"], [])


class SuggestOrdinancesFunctionTests(TestCase):
    def test_empty_ordinances_returns_empty(self):
        self.assertEqual(suggest_ordinances("noise complaint", []), [])

    def test_blank_query_returns_empty(self):
        ordinance = Ordinance(title="A", category="B", description="C")
        self.assertEqual(suggest_ordinances("   ", [ordinance, ordinance]), [])


class OrdinanceAuthorEndpointTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="admin1", email="admin1@test.com", password="x", role=User.Role.ADMIN)
        self.secretary = User.objects.create_user(
            username="sec5", email="sec5@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.captain = User.objects.create_user(
            username="cap5", email="cap5@test.com", password="x", role=User.Role.STAFF, position="Barangay Captain"
        )
        self.active = OrdinanceAuthor.objects.create(name="Hon. Active Kagawad", position=OrdinanceAuthor.Position.BARANGAY_KAGAWAD)
        self.inactive = OrdinanceAuthor.objects.create(
            name="Hon. Former Captain", position=OrdinanceAuthor.Position.BARANGAY_CAPTAIN, is_active=False
        )

    def test_secretary_sees_only_active_authors(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.get("/api/ordinances/authors/")
        self.assertEqual(response.status_code, 200)
        names = [a["name"] for a in response.data]
        self.assertIn("Hon. Active Kagawad", names)
        self.assertNotIn("Hon. Former Captain", names)

    def test_secretary_cannot_see_inactive_even_with_include_inactive(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.get("/api/ordinances/authors/", {"include_inactive": "1"})
        names = [a["name"] for a in response.data]
        self.assertNotIn("Hon. Former Captain", names)

    def test_admin_can_see_inactive_with_include_inactive(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/ordinances/authors/", {"include_inactive": "1"})
        names = [a["name"] for a in response.data]
        self.assertIn("Hon. Former Captain", names)

    def test_captain_cannot_read_the_roster(self):
        self.client.force_authenticate(self.captain)
        self.assertEqual(self.client.get("/api/ordinances/authors/").status_code, 403)

    def test_anonymous_cannot_read_the_roster(self):
        self.assertIn(self.client.get("/api/ordinances/authors/").status_code, (401, 403))

    def test_position_display_is_included(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.get("/api/ordinances/authors/")
        row = next(a for a in response.data if a["name"] == "Hon. Active Kagawad")
        self.assertEqual(row["position_display"], "Barangay Kagawad")

    def test_secretary_cannot_create_an_author(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.post(
            "/api/ordinances/authors/", {"name": "Hon. New Guy", "position": "barangay_kagawad"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_an_author_and_it_is_logged(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/ordinances/authors/", {"name": "Hon. New Guy", "position": "barangay_kagawad"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(OrdinanceAuthor.objects.filter(name="Hon. New Guy").exists())
        self.assertTrue(AuditLog.objects.filter(action__icontains="Added ordinance author").exists())

    def test_admin_can_deactivate_an_author(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(
            f"/api/ordinances/authors/{self.active.id}/", {"is_active": False}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.active.refresh_from_db()
        self.assertFalse(self.active.is_active)

    def test_secretary_cannot_edit_or_delete_an_author(self):
        self.client.force_authenticate(self.secretary)
        self.assertEqual(
            self.client.patch(f"/api/ordinances/authors/{self.active.id}/", {"is_active": False}, format="json").status_code,
            403,
        )
        self.assertEqual(self.client.delete(f"/api/ordinances/authors/{self.active.id}/").status_code, 403)

    def test_admin_can_delete_an_author(self):
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f"/api/ordinances/authors/{self.active.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(OrdinanceAuthor.objects.filter(pk=self.active.id).exists())


class OrdinanceAuthorSingleSeatTests(APITestCase):
    """
    Only one active Punong Barangay and one active SK Chairperson at a time
    (one seat each) — Barangay Kagawad has 7 seats, so no such limit there.
    """

    def setUp(self):
        self.admin = User.objects.create_user(username="admin3", email="admin3@test.com", password="x", role=User.Role.ADMIN)
        self.client.force_authenticate(self.admin)
        # migration 0007 seeds Barangay Platero's real roster (including an
        # active Captain and SK Chairperson) — cleared here so this class's
        # uniqueness assertions test a controlled fixture, not whatever
        # happens to already be seeded.
        OrdinanceAuthor.objects.all().delete()
        self.captain = OrdinanceAuthor.objects.create(name="Hon. Sitting Captain", position=OrdinanceAuthor.Position.BARANGAY_CAPTAIN)

    def _create(self, name, position):
        return self.client.post("/api/ordinances/authors/", {"name": name, "position": position}, format="json")

    def test_cannot_create_a_second_active_captain(self):
        response = self._create("Hon. Rival Captain", "barangay_captain")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Only one is allowed at a time", str(response.data))
        self.assertFalse(OrdinanceAuthor.objects.filter(name="Hon. Rival Captain").exists())

    def test_cannot_create_a_second_active_sk_chairperson(self):
        OrdinanceAuthor.objects.create(name="Hon. Sitting SK Chair", position=OrdinanceAuthor.Position.SK_CHAIRPERSON)
        response = self._create("Hon. Rival SK Chair", "sk_chairperson")
        self.assertEqual(response.status_code, 400)

    def test_multiple_active_kagawad_are_allowed(self):
        for i in range(7):
            response = self._create(f"Hon. Kagawad {i}", "barangay_kagawad")
            self.assertEqual(response.status_code, 201, response.data)

    def test_can_add_a_captain_once_the_sitting_one_is_inactive(self):
        self.captain.is_active = False
        self.captain.save(update_fields=["is_active"])
        response = self._create("Hon. New Captain", "barangay_captain")
        self.assertEqual(response.status_code, 201, response.data)

    def test_renaming_the_sitting_captain_does_not_trip_the_check_on_themselves(self):
        response = self.client.patch(
            f"/api/ordinances/authors/{self.captain.id}/", {"name": "Hon. Sitting Captain Jr."}, format="json"
        )
        self.assertEqual(response.status_code, 200)

    def test_promoting_a_kagawad_into_the_taken_captain_seat_is_rejected(self):
        kagawad = OrdinanceAuthor.objects.create(name="Hon. Ambitious Kagawad", position=OrdinanceAuthor.Position.BARANGAY_KAGAWAD)
        response = self.client.patch(
            f"/api/ordinances/authors/{kagawad.id}/", {"position": "barangay_captain"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        kagawad.refresh_from_db()
        self.assertEqual(kagawad.position, OrdinanceAuthor.Position.BARANGAY_KAGAWAD)

    def test_reactivating_a_former_captain_while_another_is_active_is_rejected(self):
        former = OrdinanceAuthor.objects.create(
            name="Hon. Former Captain", position=OrdinanceAuthor.Position.BARANGAY_CAPTAIN, is_active=False
        )
        response = self.client.patch(f"/api/ordinances/authors/{former.id}/", {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 400)
        former.refresh_from_db()
        self.assertFalse(former.is_active)

    def test_deactivating_the_sitting_captain_is_unaffected_by_the_check(self):
        response = self.client.patch(f"/api/ordinances/authors/{self.captain.id}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)


class OrdinanceCategoryEndpointTests(APITestCase):
    """Mirrors OrdinanceAuthorEndpointTests — same CRUD/permission shape, different resource."""

    def setUp(self):
        self.admin = User.objects.create_user(username="admin2", email="admin2@test.com", password="x", role=User.Role.ADMIN)
        self.secretary = User.objects.create_user(
            username="sec6", email="sec6@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.captain = User.objects.create_user(
            username="cap6", email="cap6@test.com", password="x", role=User.Role.STAFF, position="Barangay Captain"
        )
        self.active = OrdinanceCategory.objects.create(name="Test Active Category")
        self.inactive = OrdinanceCategory.objects.create(name="Retired Category", is_active=False)

    def test_secretary_sees_only_active_categories(self):
        self.client.force_authenticate(self.secretary)
        response = self.client.get("/api/ordinances/categories/")
        self.assertEqual(response.status_code, 200)
        names = [c["name"] for c in response.data]
        self.assertIn("Test Active Category", names)
        self.assertNotIn("Retired Category", names)

    def test_admin_can_see_inactive_with_include_inactive(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get("/api/ordinances/categories/", {"include_inactive": "1"})
        names = [c["name"] for c in response.data]
        self.assertIn("Retired Category", names)

    def test_captain_cannot_read_the_list(self):
        self.client.force_authenticate(self.captain)
        self.assertEqual(self.client.get("/api/ordinances/categories/").status_code, 403)

    def test_anonymous_cannot_read_it(self):
        self.assertIn(self.client.get("/api/ordinances/categories/").status_code, (401, 403))

    def test_secretary_cannot_create_a_category(self):
        self.client.force_authenticate(self.secretary)
        self.assertEqual(self.client.post("/api/ordinances/categories/", {"name": "New One"}, format="json").status_code, 403)

    def test_admin_can_create_a_category_and_it_is_logged(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/ordinances/categories/", {"name": "New One"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertTrue(OrdinanceCategory.objects.filter(name="New One").exists())
        self.assertTrue(AuditLog.objects.filter(action__icontains="Added ordinance category").exists())

    def test_duplicate_category_name_is_rejected(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/ordinances/categories/", {"name": "Test Active Category"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_admin_can_retire_a_category(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f"/api/ordinances/categories/{self.active.id}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.active.refresh_from_db()
        self.assertFalse(self.active.is_active)

    def test_secretary_cannot_edit_or_delete_a_category(self):
        self.client.force_authenticate(self.secretary)
        self.assertEqual(
            self.client.patch(f"/api/ordinances/categories/{self.active.id}/", {"is_active": False}, format="json").status_code,
            403,
        )
        self.assertEqual(self.client.delete(f"/api/ordinances/categories/{self.active.id}/").status_code, 403)

    def test_admin_can_delete_a_category(self):
        self.client.force_authenticate(self.admin)
        response = self.client.delete(f"/api/ordinances/categories/{self.active.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(OrdinanceCategory.objects.filter(pk=self.active.id).exists())


class OrdinanceCreateWithAuthorAndCategoryTests(APITestCase):
    """
    The upload/edit endpoints themselves. Author is free text again (no
    author_id — the roster only backs autocomplete suggestions client-side);
    category still has to name a currently-active OrdinanceCategory.
    """

    def setUp(self):
        self.secretary = User.objects.create_user(
            username="sec7", email="sec7@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        OrdinanceCategory.objects.create(name="Test Category")
        self.client.force_authenticate(self.secretary)
        self.pdf = SimpleUploadedFile("ord.pdf", b"%PDF-1.4 fake", content_type="application/pdf")

    def _payload(self, **overrides):
        payload = {
            "number": "No. 1-(2026)", "title": "Test Ordinance", "author": "Hon. Juan Dela Cruz",
            "category": "Test Category", "date_approved": "2026-01-01", "description": "desc", "pdf_file": self.pdf,
        }
        payload.update(overrides)
        return payload

    def test_create_stores_author_and_category_as_plain_text(self):
        response = self.client.post("/api/ordinances/", self._payload(), format="multipart")
        self.assertEqual(response.status_code, 201, response.data)
        ordinance = Ordinance.objects.get()
        self.assertEqual(ordinance.author, "Hon. Juan Dela Cruz")
        self.assertEqual(ordinance.category, "Test Category")

    def test_author_is_not_validated_against_the_roster(self):
        # Not every author is a currently-serving Councilor/Kagawad (a City
        # Ordinance can be co-authored, or an ordinance can come from outside
        # the barangay/city council entirely) — free text always goes through.
        response = self.client.post(
            "/api/ordinances/", self._payload(author="Some Name Not On Any Roster"), format="multipart"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Ordinance.objects.get().author, "Some Name Not On Any Roster")

    def test_non_pdf_file_is_rejected_with_the_file_message(self):
        for upload in (
            SimpleUploadedFile("ord.docx", b"PK\x03\x04 word file", content_type="application/pdf"),
            SimpleUploadedFile("ord.pdf", b"not really a pdf", content_type="application/pdf"),
        ):
            response = self.client.post("/api/ordinances/", self._payload(pdf_file=upload), format="multipart")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.data["pdf_file"], ["Could not upload file, check the file type and file size."])
        self.assertFalse(Ordinance.objects.exists())

    def test_extract_endpoint_is_gone(self):
        response = self.client.post("/api/ordinances/extract/", {"pdf_file": self.pdf}, format="multipart")
        self.assertIn(response.status_code, (404, 405))

    def test_missing_author_is_still_rejected(self):
        payload = self._payload()
        del payload["author"]
        response = self.client.post("/api/ordinances/", payload, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("author", response.data)

    def test_invalid_category_is_rejected(self):
        response = self.client.post("/api/ordinances/", self._payload(category="Not A Real Category"), format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_retired_category_cannot_be_assigned_to_a_new_ordinance(self):
        OrdinanceCategory.objects.create(name="Retired Category", is_active=False)
        response = self.client.post("/api/ordinances/", self._payload(category="Retired Category"), format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_editing_can_change_just_the_title_and_keeps_author_and_category(self):
        created = self.client.post("/api/ordinances/", self._payload(), format="multipart").data
        response = self.client.patch(f"/api/ordinances/{created['id']}/", {"title": "Renamed"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["author"], "Hon. Juan Dela Cruz")
        self.assertEqual(response.data["category"], "Test Category")
        self.assertEqual(response.data["title"], "Renamed")

    def test_renaming_a_category_does_not_change_an_already_uploaded_ordinance(self):
        created = self.client.post("/api/ordinances/", self._payload(), format="multipart").data
        category = OrdinanceCategory.objects.get(name="Test Category")
        category.name = "Test Category Renamed"
        category.save(update_fields=["name"])
        ordinance = Ordinance.objects.get(pk=created["id"])
        self.assertEqual(ordinance.category, "Test Category")


class OrdinanceQuerySetShortcutTests(TestCase):
    def setUp(self):
        base = dict(author="Hon. A", category="C", date_approved=datetime.date(2026, 1, 1), description="d")
        self.ord = Ordinance.objects.create(number="1", title="Ord", **base)
        self.old_ord = Ordinance.objects.create(number="2", title="Old", is_archived=True, **base)

    def test_published_shortcut(self):
        self.assertEqual(set(Ordinance.objects.all()), {self.ord, self.old_ord})
        self.assertEqual(list(Ordinance.objects.published()), [self.ord])
