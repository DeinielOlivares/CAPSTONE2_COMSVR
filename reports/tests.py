from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APITestCase

from accounts.models import User
from orms_backend.codes import MAX_CODE_ATTEMPTS

from .models import Concern, Report, ReportVerificationCode

REAL_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


class ReportVerificationCodeTests(APITestCase):
    """The report-filing identity code has the same 1,000,000-guess weakness as Forgot Password."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="juan", email="juan@test.com", password="x", is_verified=True
        )
        self.client.force_authenticate(self.user)

    def _send(self):
        return self.client.post("/api/reports/send-verification/")

    def _verify(self, code):
        return self.client.post("/api/reports/verify-code/", {"code": code}, format="json")

    def _live_codes(self):
        return [c for c in ReportVerificationCode.objects.filter(user=self.user) if c.is_valid()]

    def _wrong(self, code):
        return "000000" if code != "000000" else "111111"

    def test_correct_code_verifies(self):
        self._send()
        code = self._live_codes()[0].code
        self.assertRegex(code, r"^\d{6}$")
        self.assertEqual(self._verify(code).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    def test_sending_again_kills_the_earlier_code(self):
        self._send()
        first = self._live_codes()[0].code
        self._send()
        # Only one live code at a time — stacking them would multiply an attacker's odds per guess.
        self.assertEqual(len(self._live_codes()), 1)
        newest = self._live_codes()[0].code
        if newest != first:
            self.assertEqual(self._verify(first).status_code, 400)
        self.assertEqual(self._verify(newest).status_code, 200)

    def test_code_dies_after_too_many_wrong_guesses(self):
        self._send()
        code = self._live_codes()[0].code
        for _ in range(MAX_CODE_ATTEMPTS - 1):
            self.assertEqual(self._verify(self._wrong(code)).status_code, 400)
        last = self._verify(self._wrong(code))
        self.assertIn("Too many incorrect attempts", str(last.data))
        self.assertEqual(self._verify(code).status_code, 400)

    def test_correct_code_works_after_a_few_wrong_guesses(self):
        self._send()
        code = self._live_codes()[0].code
        for _ in range(MAX_CODE_ATTEMPTS - 1):
            self._verify(self._wrong(code))
        self.assertEqual(self._verify(code).status_code, 200)

    def test_verifying_with_no_code_requested_fails_cleanly(self):
        self.assertEqual(self._verify("123456").status_code, 400)


@override_settings(CACHES=REAL_CACHE)
class ReportVerificationThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.user = User.objects.create_user(username="juan", email="juan@test.com", password="x", is_verified=True)
        self.client.force_authenticate(self.user)

    def test_sending_codes_is_limited(self):
        for _ in range(3):
            self.assertEqual(self.client.post("/api/reports/send-verification/").status_code, 200)
        self.assertEqual(self.client.post("/api/reports/send-verification/").status_code, 429)

    def test_verify_attempts_are_limited(self):
        for _ in range(5):
            self.assertEqual(self.client.post("/api/reports/verify-code/", {"code": "000000"}, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/reports/verify-code/", {"code": "000000"}, format="json").status_code, 429)

    def test_limit_is_per_user(self):
        for _ in range(3):
            self.client.post("/api/reports/send-verification/")
        other = User.objects.create_user(username="maria", email="maria@test.com", password="x", is_verified=True)
        self.client.force_authenticate(other)
        self.assertEqual(self.client.post("/api/reports/send-verification/").status_code, 200)


class ReportStatusClaimGateTests(APITestCase):
    """An Investigator can only work (status/remarks) a report they've claimed themselves."""

    def setUp(self):
        self.citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        self.investigator = User.objects.create_user(
            username="inv1", email="inv1@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.other_investigator = User.objects.create_user(
            username="inv2", email="inv2@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.admin = User.objects.create_user(username="adm", email="adm@test.com", password="x", role=User.Role.ADMIN)
        self.report = Report.objects.create(
            citizen=self.citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
            nature_of_violation="Dumping garbage",
        )
        self.url = f"/api/reports/staff/{self.report.id}/"

    def _patch(self, **body):
        return self.client.patch(self.url, body or {"status": "under_review"}, format="json")

    def test_unclaimed_report_cannot_be_updated(self):
        self.client.force_authenticate(self.investigator)
        response = self._patch(status="under_review")
        self.assertEqual(response.status_code, 403)
        self.assertIn("Claim this report", response.data["detail"])
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, Report.Status.SUBMITTED)

    def test_report_claimed_by_someone_else_cannot_be_updated(self):
        self.report.assigned_investigator = self.other_investigator
        self.report.save()
        self.client.force_authenticate(self.investigator)
        response = self._patch(status="under_review")
        self.assertEqual(response.status_code, 403)
        self.assertIn("inv2", response.data["detail"])
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, Report.Status.SUBMITTED)

    def test_remarks_only_edit_is_also_blocked_without_the_claim(self):
        self.client.force_authenticate(self.investigator)
        self.assertEqual(self._patch(remarks="Looking into it").status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.remarks, "")

    def test_claiming_it_first_lets_the_investigator_update_it(self):
        self.client.force_authenticate(self.investigator)
        self.assertEqual(self.client.post(f"{self.url}claim/").status_code, 200)
        response = self._patch(status="under_review", remarks="On it")
        self.assertEqual(response.status_code, 200)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, Report.Status.UNDER_REVIEW)
        self.assertEqual(self.report.remarks, "On it")

    def test_investigator_cannot_forfeit_their_own_claim(self):
        self.client.force_authenticate(self.investigator)
        self.client.post(f"{self.url}claim/")
        self.assertEqual(self.client.post(f"{self.url}forfeit/").status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.assigned_investigator, self.investigator)
        # Still theirs, so they can keep working it.
        self.assertEqual(self._patch(status="in_action").status_code, 200)

    def test_admin_can_release_a_claim(self):
        self.report.assigned_investigator = self.investigator
        self.report.save()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f"{self.url}forfeit/").status_code, 200)
        self.report.refresh_from_db()
        self.assertIsNone(self.report.assigned_investigator)
        # Freed up, so another Investigator can now claim it.
        self.client.force_authenticate(self.other_investigator)
        self.assertEqual(self.client.post(f"{self.url}claim/").status_code, 200)

    def test_second_investigator_cannot_update_after_the_first_claims_it(self):
        self.client.force_authenticate(self.investigator)
        self.client.post(f"{self.url}claim/")
        self.client.force_authenticate(self.other_investigator)
        self.assertEqual(self._patch(status="resolved").status_code, 403)
        self.report.refresh_from_db()
        self.assertNotEqual(self.report.status, Report.Status.RESOLVED)

    def test_with_remarks_closes_the_report_and_emails_the_citizen(self):
        self.client.force_authenticate(self.investigator)
        self.client.post(f"{self.url}claim/")
        mail.outbox.clear()
        response = self._patch(status="with_remarks", remarks="No violation found on inspection.")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "with_remarks")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("With Remarks", mail.outbox[0].subject)
        # Re-saving the same status doesn't email again.
        self._patch(status="with_remarks")
        self.assertEqual(len(mail.outbox), 1)

    def test_admin_can_still_update_on_someones_behalf(self):
        self.report.assigned_investigator = self.other_investigator
        self.report.save()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self._patch(status="under_review").status_code, 200)

    def test_non_investigator_staff_are_still_refused_outright(self):
        secretary = User.objects.create_user(
            username="sec", email="sec@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.client.force_authenticate(secretary)
        self.assertEqual(self._patch(status="under_review").status_code, 403)


class BarangayCaptainReportsReadOnlyTests(APITestCase):
    """Barangay Captain can view reports but never claim, change status, or leave remarks."""

    def setUp(self):
        self.citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        self.captain = User.objects.create_user(
            username="cap", email="cap@test.com", password="x", role=User.Role.STAFF, position="Barangay Captain"
        )
        self.investigator = User.objects.create_user(
            username="inv1", email="inv1@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.report = Report.objects.create(
            citizen=self.citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
            nature_of_violation="Dumping garbage",
        )
        self.url = f"/api/reports/staff/{self.report.id}/"
        self.client.force_authenticate(self.captain)

    def test_captain_can_view_the_list_and_a_report(self):
        self.assertEqual(self.client.get("/api/reports/staff/").status_code, 200)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_captain_cannot_claim(self):
        self.assertEqual(self.client.post(f"{self.url}claim/").status_code, 403)
        self.report.refresh_from_db()
        self.assertIsNone(self.report.assigned_investigator)

    def test_captain_cannot_change_status(self):
        self.assertEqual(self.client.patch(self.url, {"status": "resolved"}, format="json").status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, Report.Status.SUBMITTED)

    def test_captain_cannot_leave_remarks(self):
        self.assertEqual(self.client.patch(self.url, {"remarks": "Noted"}, format="json").status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.remarks, "")

    def test_captain_cannot_forfeit_someone_elses_claim(self):
        self.report.assigned_investigator = self.investigator
        self.report.save()
        self.assertEqual(self.client.post(f"{self.url}forfeit/").status_code, 403)
        self.report.refresh_from_db()
        self.assertEqual(self.report.assigned_investigator, self.investigator)


class ClaimedReportsFilterTests(APITestCase):
    """Manage Accounts lists one Investigator's claims via ?assigned_to=<user id>."""

    def setUp(self):
        citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        self.inv1 = User.objects.create_user(
            username="inv1", email="inv1@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        inv2 = User.objects.create_user(
            username="inv2", email="inv2@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.admin = User.objects.create_user(username="adm", email="adm@test.com", password="x", role=User.Role.ADMIN)

        def make(holder):
            return Report.objects.create(
                citizen=citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
                nature_of_violation="Dumping garbage", assigned_investigator=holder,
            )

        self.mine = [make(self.inv1), make(self.inv1)]
        make(inv2)
        make(None)
        self.client.force_authenticate(self.admin)

    def test_filter_returns_only_that_investigators_claims(self):
        response = self.client.get(f"/api/reports/staff/?assigned_to={self.inv1.id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({r["id"] for r in response.data}, {str(r.id) for r in self.mine})

    def test_no_filter_still_returns_everything(self):
        self.assertEqual(len(self.client.get("/api/reports/staff/").data), 4)

    def test_malformed_id_returns_nothing_rather_than_erroring(self):
        response = self.client.get("/api/reports/staff/?assigned_to=not-a-uuid")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])

    def test_active_filter_leaves_out_closed_claims(self):
        self.mine[0].status = Report.Status.RESOLVED
        self.mine[0].save()
        response = self.client.get(f"/api/reports/staff/?assigned_to={self.inv1.id}&active=1")
        self.assertEqual({r["id"] for r in response.data}, {str(self.mine[1].id)})


class ReportNumberTests(APITestCase):
    """Each report gets "YYYYMMDD-N" — the Nth filed that day — for its Download Report file name."""

    def setUp(self):
        self.citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)

    def _make(self):
        return Report.objects.create(
            citizen=self.citizen, location="Block 1, Purok 1", ordinance="Anti-Littering",
            incident_date="2026-09-01", nature_of_violation="Dumping garbage",
        )

    def test_numbers_count_up_within_a_day(self):
        from django.utils import timezone

        prefix = timezone.localdate().strftime("%Y%m%d")
        self.assertEqual([self._make().report_number for _ in range(3)], [f"{prefix}-1", f"{prefix}-2", f"{prefix}-3"])

    def test_number_is_kept_when_an_earlier_report_is_deleted(self):
        first, second = self._make(), self._make()
        number = second.report_number
        first.delete()
        second.status = Report.Status.UNDER_REVIEW
        second.save()
        second.refresh_from_db()
        self.assertEqual(second.report_number, number)
        self.assertNotEqual(self._make().report_number, number)

    def test_each_day_starts_again_at_one(self):
        import datetime
        from unittest import mock

        from django.utils import timezone

        self._make()
        with mock.patch.object(timezone, "localdate", return_value=datetime.date(2030, 1, 1)):
            self.assertEqual(self._make().report_number, "20300101-1")

    def test_a_clash_takes_the_next_number(self):
        from unittest import mock

        from . import models

        taken = self._make().report_number
        real_next = models.next_report_number
        calls = []

        def stale_then_real(day):
            calls.append(day)
            return taken if len(calls) == 1 else real_next(day)

        with mock.patch.object(models, "next_report_number", side_effect=stale_then_real):
            report = self._make()
        self.assertNotEqual(report.report_number, taken)
        self.assertTrue(report.report_number.endswith("-2"))

    def test_shown_to_the_citizen_and_staff(self):
        report = self._make()
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get("/api/reports/").data[0]["report_number"], report.report_number)
        staff = User.objects.create_user(
            username="inv", email="inv@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.client.force_authenticate(staff)
        self.assertEqual(self.client.get("/api/reports/staff/").data[0]["report_number"], report.report_number)


class ReportRemarksAutoReviewTests(APITestCase):
    """Remarks saved on a New Submission without moving its status put it Under Review."""

    def setUp(self):
        citizen = User.objects.create_user(username="cit4", email="cit4@test.com", password="x", is_verified=True)
        self.investigator = User.objects.create_user(
            username="inv4", email="inv4@test.com", password="x", role=User.Role.STAFF, position="Investigator"
        )
        self.report = Report.objects.create(
            citizen=citizen, location="Purok 1", ordinance="Anti-Littering", incident_date="2026-09-01",
            nature_of_violation="Dumping garbage", assigned_investigator=self.investigator,
        )
        self.url = f"/api/reports/staff/{self.report.id}/"
        self.client.force_authenticate(self.investigator)

    def _status_after(self, body):
        response = self.client.patch(self.url, body, format="json")
        self.assertEqual(response.status_code, 200)
        self.report.refresh_from_db()
        return self.report.status

    def test_remarks_with_status_left_as_submitted_moves_to_under_review(self):
        self.assertEqual(self._status_after({"status": "submitted", "remarks": "Site visit scheduled."}), "under_review")

    def test_remarks_without_a_status_also_moves_it(self):
        self.assertEqual(self._status_after({"remarks": "Site visit scheduled."}), "under_review")

    def test_a_status_the_investigator_picked_is_kept(self):
        self.assertEqual(self._status_after({"status": "in_action", "remarks": "Team dispatched."}), "in_action")

    def test_blank_remarks_leave_it_submitted(self):
        self.assertEqual(self._status_after({"status": "submitted", "remarks": "   "}), "submitted")

    def test_only_applies_to_new_submissions(self):
        self.report.status = Report.Status.IN_ACTION
        self.report.save()
        self.assertEqual(self._status_after({"status": "in_action", "remarks": "Still ongoing."}), "in_action")


class ConcernAutoReviewTests(APITestCase):
    def setUp(self):
        from .models import ConcernFolder

        self.citizen = User.objects.create_user(username="cit3", email="cit3@test.com", password="x")
        self.secretary = User.objects.create_user(
            username="sec3", email="sec3@test.com", password="x", role=User.Role.STAFF, position="Secretary"
        )
        self.folder = ConcernFolder.objects.create(name="Stray Animals")
        self.concern = Concern.objects.create(citizen=self.citizen, description="Stray dogs near the plaza")
        self.url = f"/api/concerns/staff/{self.concern.id}/"
        self.client.force_authenticate(self.secretary)

    def _patch(self, body):
        response = self.client.patch(self.url, body, format="json")
        self.assertEqual(response.status_code, 200)
        self.concern.refresh_from_db()
        return response

    def test_status_cannot_be_set_by_hand(self):
        self._patch({"status": "reviewed"})
        self.assertEqual(self.concern.status, Concern.Status.SUBMITTED)
        self.assertIsNone(self.concern.reviewed_at)

    def test_saving_remarks_marks_it_reviewed(self):
        response = self._patch({"remarks": "Endorsed to the committee."})
        self.assertEqual(self.concern.status, Concern.Status.REVIEWED)
        self.assertIsNotNone(response.data["reviewed_at"])

    def test_blank_remarks_do_not(self):
        self._patch({"remarks": "  "})
        self.assertEqual(self.concern.status, Concern.Status.SUBMITTED)

    def test_filing_under_a_category_marks_it_reviewed_and_removing_keeps_it(self):
        self._patch({"folder": str(self.folder.id)})
        self.assertEqual(self.concern.status, Concern.Status.REVIEWED)
        stamped = self.concern.reviewed_at

        response = self._patch({"folder": None})
        self.assertEqual(self.concern.status, Concern.Status.REVIEWED)
        self.assertIsNone(self.concern.folder_id)
        self.assertIsNone(response.data["folder"])
        self.assertEqual(self.concern.reviewed_at, stamped)

        self._patch({"remarks": "Later note."})
        self.assertEqual(self.concern.reviewed_at, stamped)

    def test_removing_from_a_category_alone_does_not_review_it(self):
        self._patch({"folder": None})
        self.assertEqual(self.concern.status, Concern.Status.SUBMITTED)


class StaffReportAnalysisBaseTests(APITestCase):
    def setUp(self):
        self.citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        User.objects.create_user(username="pending", email="pending@test.com", password="x", is_verified=False)
        User.objects.create_user(
            username="gone", email="gone@test.com", password="x", is_verified=True, is_active=False
        )
        self.captain = User.objects.create_user(
            username="cap", email="cap@test.com", password="x", role=User.Role.STAFF,
            position="Barangay Captain", is_verified=True,
        )

    def test_counts_only_approved_active_citizens(self):
        self.client.force_authenticate(self.captain)
        response = self.client.get("/api/reports/staff/analysis-base/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"registered_citizens": 1})

    def test_citizens_cannot_read_it(self):
        self.client.force_authenticate(self.citizen)
        self.assertEqual(self.client.get("/api/reports/staff/analysis-base/").status_code, 403)

    def test_staff_report_list_identifies_the_reporter(self):
        report = Report.objects.create(
            citizen=self.citizen, location="Block 1, Lot 2, Main Street", ordinance="Ord 1 — Curfew",
            incident_date="2026-10-01", nature_of_violation="Out past curfew.",
        )
        self.client.force_authenticate(self.captain)
        rows = self.client.get("/api/reports/staff/").json()
        self.assertEqual(rows[0]["id"], str(report.id))
        self.assertEqual(rows[0]["reporterId"], str(self.citizen.id))
