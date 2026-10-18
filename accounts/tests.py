from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from orms_backend.codes import MAX_CODE_ATTEMPTS

from .lockout import FAILURE_WINDOW_MINUTES, LOCKOUT_MINUTES, MAX_FAILED_LOGINS
from .models import AuditLog, PasswordResetCode, User

LOGIN_URL = "/api/auth/login/"
GOOD_PASSWORD = "Str0ng!Pass#2026x"


# Every login attempt runs the password hasher, and these tests make dozens of them;
# the default PBKDF2 takes ~0.1s each, so use a fast hasher (tests only, never real accounts).
@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class FailedLoginLockoutTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="juan", email="juan@test.com", password=GOOD_PASSWORD, is_verified=True
        )

    def _login(self, password, email="juan@test.com"):
        return self.client.post(LOGIN_URL, {"email": email, "password": password}, format="json")

    def _fail(self, times, **kwargs):
        response = None
        for _ in range(times):
            response = self._login("wrong-password", **kwargs)
        return response

    def test_below_the_limit_does_not_lock(self):
        response = self._fail(MAX_FAILED_LOGINS - 1)
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("locked", response.data["detail"])
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self._login(GOOD_PASSWORD).status_code, 200)

    def test_wrong_password_and_unknown_email_get_the_same_message(self):
        self.assertEqual(self._login("wrong-password").data["detail"], "Incorrect email or password.")
        self.assertEqual(
            self._login(GOOD_PASSWORD, email="nobody@test.com").data["detail"], "Incorrect email or password."
        )

    def test_phone_number_is_not_accepted_as_the_login(self):
        self.user.contact_number = "09171234567"
        self.user.save()
        self.assertNotEqual(self._login(GOOD_PASSWORD, email="09171234567").status_code, 200)

    def test_successful_login_resets_the_counter(self):
        self._fail(MAX_FAILED_LOGINS - 1)
        self.assertEqual(self._login(GOOD_PASSWORD).status_code, 200)
        # Counter is back to zero, so another 9 misses still don't lock.
        self._fail(MAX_FAILED_LOGINS - 1)
        self.assertEqual(self._login(GOOD_PASSWORD).status_code, 200)

    def test_tenth_failure_locks_and_alerts_the_owner(self):
        response = self._fail(MAX_FAILED_LOGINS)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Too many failed login attempts", response.data["detail"])
        self.assertIn(f"{LOCKOUT_MINUTES} more minutes", response.data["detail"])

        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.locked_until)
        self.assertTrue(AuditLog.objects.filter(user=self.user, action__startswith="Account locked").exists())

        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["juan@test.com"])
        self.assertIn("temporarily locked", mail.outbox[0].subject)

    def test_correct_password_is_refused_while_locked(self):
        self._fail(MAX_FAILED_LOGINS)
        response = self._login(GOOD_PASSWORD)
        self.assertEqual(response.status_code, 401)
        self.assertIn("Too many failed login attempts", response.data["detail"])
        self.assertNotIn("access", response.data)

    def test_further_attempts_while_locked_send_no_more_email(self):
        self._fail(MAX_FAILED_LOGINS)
        self._fail(5)
        self.assertEqual(len(mail.outbox), 1)

    def test_lock_expires(self):
        self._fail(MAX_FAILED_LOGINS)
        User.objects.filter(pk=self.user.pk).update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self._login(GOOD_PASSWORD).status_code, 200)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.locked_until)
        self.assertEqual(self.user.failed_login_count, 0)

    def test_old_failures_do_not_add_up(self):
        self._fail(MAX_FAILED_LOGINS - 1)
        User.objects.filter(pk=self.user.pk).update(
            last_failed_login_at=timezone.now() - timedelta(minutes=FAILURE_WINDOW_MINUTES + 1)
        )
        response = self._login("wrong-password")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("Too many failed login attempts", response.data["detail"])
        self.assertEqual(len(mail.outbox), 0)

    def test_email_match_is_case_insensitive(self):
        self._fail(MAX_FAILED_LOGINS, email="JUAN@test.com")
        self.user.refresh_from_db()
        self.assertIsNotNone(self.user.locked_until)

    def test_unknown_email_gets_the_generic_error_and_no_email(self):
        response = self._fail(MAX_FAILED_LOGINS + 2, email="nobody@test.com")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("Too many failed login attempts", response.data["detail"])
        self.assertEqual(len(mail.outbox), 0)

    def test_disabled_account_is_not_locked_or_emailed(self):
        User.objects.filter(pk=self.user.pk).update(is_active=False)
        self._fail(MAX_FAILED_LOGINS + 2)
        self.user.refresh_from_db()
        self.assertIsNone(self.user.locked_until)
        self.assertEqual(len(mail.outbox), 0)

    def test_correct_password_on_unverified_account_is_not_a_failure(self):
        User.objects.filter(pk=self.user.pk).update(is_verified=False)
        for _ in range(MAX_FAILED_LOGINS + 1):
            response = self._login(GOOD_PASSWORD)
            self.assertIn("under verification", response.data["detail"])
        self.user.refresh_from_db()
        self.assertIsNone(self.user.locked_until)

    def test_locking_one_account_leaves_others_alone(self):
        other = User.objects.create_user(
            username="maria", email="maria@test.com", password=GOOD_PASSWORD, is_verified=True
        )
        self._fail(MAX_FAILED_LOGINS)
        self.assertEqual(self._login(GOOD_PASSWORD, email=other.email).status_code, 200)

    def test_completing_a_password_reset_unlocks_the_account(self):
        self._fail(MAX_FAILED_LOGINS)
        PasswordResetCode.objects.create(
            user=self.user, code="123456", expires_at=timezone.now() + timedelta(minutes=10),
            verified_at=timezone.now(),
        )
        new_password = "An0ther!Pass#2027y"
        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            {"email": "juan@test.com", "code": "123456", "password": new_password},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._login(new_password).status_code, 200)


FAST_HASHER = ["django.contrib.auth.hashers.MD5PasswordHasher"]
REAL_CACHE = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class PasswordResetCodeAttemptTests(APITestCase):
    """A 6-digit code is only 1,000,000 guesses — each code must die after a few wrong ones."""

    def setUp(self):
        self.user = User.objects.create_user(
            username="juan", email="juan@test.com", password=GOOD_PASSWORD, is_verified=True
        )
        self.client.post("/api/auth/password-reset/request/", {"email": "juan@test.com"}, format="json")
        self.code = PasswordResetCode.objects.get(user=self.user).code

    def _verify(self, code):
        return self.client.post(
            "/api/auth/password-reset/verify/", {"email": "juan@test.com", "code": code}, format="json"
        )

    def _wrong(self):
        return "000000" if self.code != "000000" else "111111"

    def test_code_is_six_digits(self):
        self.assertRegex(self.code, r"^\d{6}$")

    def test_correct_code_still_works_after_a_few_wrong_guesses(self):
        for _ in range(MAX_CODE_ATTEMPTS - 1):
            self.assertEqual(self._verify(self._wrong()).status_code, 400)
        self.assertEqual(self._verify(self.code).status_code, 200)

    def test_code_dies_after_too_many_wrong_guesses(self):
        for _ in range(MAX_CODE_ATTEMPTS - 1):
            self._verify(self._wrong())
        last = self._verify(self._wrong())
        self.assertIn("Too many incorrect attempts", str(last.data))
        # Even the right code is refused now — guessing bought the attacker nothing.
        self.assertEqual(self._verify(self.code).status_code, 400)

    def test_requesting_a_new_code_gives_a_working_one(self):
        for _ in range(MAX_CODE_ATTEMPTS):
            self._verify(self._wrong())
        self.client.post("/api/auth/password-reset/request/", {"email": "juan@test.com"}, format="json")
        new_code = PasswordResetCode.objects.filter(user=self.user, used_at__isnull=True).get().code
        self.assertEqual(self._verify(new_code).status_code, 200)

    def test_confirm_needs_the_code_to_have_been_verified_first(self):
        response = self.client.post(
            "/api/auth/password-reset/confirm/",
            {"email": "juan@test.com", "code": self.code, "password": "An0ther!Pass#2027y"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)


@override_settings(PASSWORD_HASHERS=FAST_HASHER, CACHES=REAL_CACHE)
class AuthThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        User.objects.create_user(username="juan", email="juan@test.com", password=GOOD_PASSWORD, is_verified=True)

    def _login(self):
        return self.client.post(LOGIN_URL, {"email": "nobody@test.com", "password": "x"}, format="json")

    def test_login_is_limited_per_ip(self):
        for _ in range(10):
            self.assertEqual(self._login().status_code, 401)
        blocked = self._login()
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("Retry-After", blocked)

    def test_reset_verify_is_limited(self):
        body = {"email": "juan@test.com", "code": "000000"}
        for _ in range(5):
            self.assertEqual(self.client.post("/api/auth/password-reset/verify/", body, format="json").status_code, 400)
        self.assertEqual(self.client.post("/api/auth/password-reset/verify/", body, format="json").status_code, 429)

    def test_reset_request_is_limited_per_email_not_just_per_ip(self):
        def request(email):
            return self.client.post("/api/auth/password-reset/request/", {"email": email}, format="json")

        User.objects.create_user(username="maria", email="maria@test.com", password=GOOD_PASSWORD, is_verified=True)
        for _ in range(3):
            self.assertEqual(request("juan@test.com").status_code, 200)
        self.assertEqual(request("juan@test.com").status_code, 429)
        # A different address from the same IP is unaffected by juan's email limit.
        self.assertEqual(request("maria@test.com").status_code, 200)

    def test_signup_is_limited(self):
        for _ in range(5):
            self.assertNotEqual(self.client.post("/api/auth/register/", {}, format="json").status_code, 429)
        self.assertEqual(self.client.post("/api/auth/register/", {}, format="json").status_code, 429)

    def test_forged_forwarded_for_header_does_not_dodge_the_limit(self):
        for i in range(10):
            self.client.post(
                LOGIN_URL, {"email": "n@test.com", "password": "x"}, format="json",
                HTTP_X_FORWARDED_FOR=f"10.0.0.{i}, 203.0.113.9",
            )
        blocked = self.client.post(
            LOGIN_URL, {"email": "n@test.com", "password": "x"}, format="json",
            HTTP_X_FORWARDED_FOR="10.9.9.9, 203.0.113.9",
        )
        # With NUM_PROXIES=1 only the rightmost address (the proxy's own view of
        # the client) counts, so changing the leftmost entries changes nothing.
        self.assertEqual(blocked.status_code, 429)


DETAILS = {
    "first_name": "Ana", "last_name": "Reyes", "contact_number": "09171234567", "password": GOOD_PASSWORD,
}


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class StaffSetupTakeoverTests(APITestCase):
    """
    An admin-created staff account has no password until its owner finishes setup.
    Anyone who knew that email used to be able to finish setup themselves and be
    logged in as it — as an Administrator, if that was the role. Setup now needs a
    code emailed to the address.
    """

    def setUp(self):
        self.pending = self._pending("newsec@test.com", User.Role.STAFF, "Secretary")
        self.existing = User.objects.create_user(
            username="cap", email="cap@test.com", password=GOOD_PASSWORD, role=User.Role.STAFF,
            position="Barangay Captain", is_verified=True,
        )

    def _pending(self, email, role, position):
        user = User(username=email, email=email, role=role, position=position, is_verified=True)
        user.set_unusable_password()
        user.save()
        return user

    def _request_code(self, email):
        return self.client.post("/api/auth/staff-setup/request-code/", {"email": email}, format="json")

    def _latest_code(self, user):
        return PasswordResetCode.objects.filter(user=user).latest("created_at").code

    def _verify(self, email, code):
        return self.client.post("/api/auth/password-reset/verify/", {"email": email, "code": code}, format="json")

    def _setup(self, email, code=None, **extra):
        body = {"email": email, **DETAILS, **extra}
        if code is not None:
            body["code"] = code
        return self.client.post("/api/auth/staff-setup/", body, format="json")

    def _login_as(self, email, password=GOOD_PASSWORD):
        return self.client.post(LOGIN_URL, {"email": email, "password": password}, format="json")

    def _assert_still_pending(self, user):
        user.refresh_from_db()
        self.assertFalse(user.has_usable_password())

    def test_cannot_take_over_a_pending_account_with_just_the_email(self):
        response = self._setup("newsec@test.com")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
        self._assert_still_pending(self.pending)

    def test_pending_administrator_account_is_protected_too(self):
        admin = self._pending("newadmin@test.com", User.Role.ADMIN, "Administrator")
        response = self._setup("newadmin@test.com")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
        self._assert_still_pending(admin)

    def test_a_guessed_code_does_not_work(self):
        self._request_code("newsec@test.com")
        code = self._latest_code(self.pending)
        guess = "000000" if code != "000000" else "111111"
        self.assertEqual(self._setup("newsec@test.com", guess).status_code, 400)
        self._assert_still_pending(self.pending)

    def test_a_code_that_was_emailed_but_not_verified_is_not_enough(self):
        self._request_code("newsec@test.com")
        code = self._latest_code(self.pending)
        self.assertEqual(self._setup("newsec@test.com", code).status_code, 400)
        self._assert_still_pending(self.pending)

    def test_full_flow_works(self):
        response = self._request_code("newsec@test.com")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["newsec@test.com"])
        code = self._latest_code(self.pending)
        self.assertRegex(code, r"^\d{6}$")
        self.assertIn(code, mail.outbox[0].body)

        self.assertEqual(self._verify("newsec@test.com", code).status_code, 200)
        response = self._setup("newsec@test.com", code)
        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)

        self.pending.refresh_from_db()
        self.assertTrue(self.pending.has_usable_password())
        self.assertEqual(self.pending.first_name, "Ana")
        self.assertEqual(self._login_as("newsec@test.com").status_code, 200)

    def test_code_cannot_be_reused(self):
        self._request_code("newsec@test.com")
        code = self._latest_code(self.pending)
        self._verify("newsec@test.com", code)
        self.assertEqual(self._setup("newsec@test.com", code).status_code, 200)
        # The account is no longer pending, so someone replaying the code gets nowhere.
        self.assertEqual(self._setup("newsec@test.com", code, password="Hijack!Pass#2028z").status_code, 400)
        self.assertEqual(self._login_as("newsec@test.com").status_code, 200)

    def test_code_for_one_account_cannot_set_up_another(self):
        other = self._pending("other@test.com", User.Role.STAFF, "Investigator")
        self._request_code("newsec@test.com")
        code = self._latest_code(self.pending)
        self._verify("newsec@test.com", code)
        self.assertEqual(self._setup("other@test.com", code).status_code, 400)
        self._assert_still_pending(other)

    def test_setup_on_an_already_set_up_account_is_refused_and_changes_nothing(self):
        response = self._setup("cap@test.com", "123456")
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
        self.assertEqual(self._login_as("cap@test.com").status_code, 200)

    def test_request_code_gives_the_same_answer_whether_or_not_the_account_exists(self):
        pending = self._request_code("newsec@test.com")
        unknown = self._request_code("nobody@test.com")
        set_up = self._request_code("cap@test.com")
        self.assertEqual((pending.status_code, unknown.status_code, set_up.status_code), (200, 200, 200))
        self.assertEqual(pending.data, unknown.data)
        self.assertEqual(pending.data, set_up.data)
        # ...but only the pending account's inbox actually got a code.
        self.assertEqual([m.to for m in mail.outbox], [["newsec@test.com"]])

    def test_a_citizen_email_is_not_treated_as_pending(self):
        User.objects.create_user(username="cit", email="cit@test.com", password=GOOD_PASSWORD, is_verified=True)
        self._request_code("cit@test.com")
        self.assertEqual(len(mail.outbox), 0)

    def test_requesting_a_new_code_kills_the_old_one(self):
        self._request_code("newsec@test.com")
        first = self._latest_code(self.pending)
        self._request_code("newsec@test.com")
        newest = self._latest_code(self.pending)
        if first != newest:
            self.assertEqual(self._verify("newsec@test.com", first).status_code, 400)
        self.assertEqual(self._verify("newsec@test.com", newest).status_code, 200)

    def test_the_setup_code_cannot_be_brute_forced(self):
        self._request_code("newsec@test.com")
        code = self._latest_code(self.pending)
        guess = "000000" if code != "000000" else "111111"
        for _ in range(MAX_CODE_ATTEMPTS):
            self._verify("newsec@test.com", guess)
        self.assertEqual(self._verify("newsec@test.com", code).status_code, 400)
        self.assertEqual(self._setup("newsec@test.com", code).status_code, 400)
        self._assert_still_pending(self.pending)

    def test_status_endpoint_that_revealed_staff_emails_is_gone(self):
        response = self.client.get("/api/auth/staff-setup/status/", {"email": "cap@test.com"})
        self.assertEqual(response.status_code, 404)


@override_settings(PASSWORD_HASHERS=FAST_HASHER, CACHES=REAL_CACHE)
class StaffSetupThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def _request(self, email):
        return self.client.post("/api/auth/staff-setup/request-code/", {"email": email}, format="json")

    def test_code_requests_are_limited_per_email(self):
        for _ in range(3):
            self.assertEqual(self._request("a@test.com").status_code, 200)
        self.assertEqual(self._request("a@test.com").status_code, 429)

    def test_code_requests_are_limited_per_ip(self):
        for i in range(5):
            self.assertEqual(self._request(f"user{i}@test.com").status_code, 200)
        self.assertEqual(self._request("user99@test.com").status_code, 429)


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class PasswordResetEnumerationTests(APITestCase):
    """Forgot Password must not reveal whether an email is registered."""

    def setUp(self):
        User.objects.create_user(username="juan", email="juan@test.com", password=GOOD_PASSWORD, is_verified=True)

    def _request(self, email):
        return self.client.post("/api/auth/password-reset/request/", {"email": email}, format="json")

    def test_registered_and_unregistered_emails_get_identical_responses(self):
        known = self._request("juan@test.com")
        unknown = self._request("nobody@test.com")
        self.assertEqual(known.status_code, 200)
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(known.data, unknown.data)

    def test_only_a_registered_email_actually_receives_a_code(self):
        self._request("nobody@test.com")
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(PasswordResetCode.objects.count(), 0)

        self._request("juan@test.com")
        self.assertEqual([m.to for m in mail.outbox], [["juan@test.com"]])
        self.assertEqual(PasswordResetCode.objects.count(), 1)

    def test_email_match_ignores_case(self):
        self._request("JUAN@test.com")
        self.assertEqual(len(mail.outbox), 1)

    def test_response_does_not_say_the_account_was_found(self):
        detail = self._request("juan@test.com").data["detail"]
        self.assertIn("If an account exists", detail)

    def test_a_malformed_email_is_still_rejected(self):
        self.assertEqual(self._request("not-an-email").status_code, 400)

    def test_verify_gives_the_same_error_for_unknown_emails_and_wrong_codes(self):
        self._request("juan@test.com")
        unknown = self.client.post(
            "/api/auth/password-reset/verify/", {"email": "nobody@test.com", "code": "123456"}, format="json"
        )
        known_wrong = self.client.post(
            "/api/auth/password-reset/verify/", {"email": "juan@test.com", "code": "000000"}, format="json"
        )
        self.assertEqual(unknown.status_code, 400)
        self.assertEqual(known_wrong.status_code, 400)
        self.assertEqual(unknown.data, known_wrong.data)


class DisableDeleteWithClaimsTests(APITestCase):
    """Disabling/deleting an Investigator who holds claimed reports — and the audit trail for it."""

    def setUp(self):
        from reports.models import Report

        self.Report = Report
        self.admin = User.objects.create_user(
            username="adm", email="adm@test.com", password="x", role=User.Role.ADMIN, first_name="Ana", last_name="Admin"
        )
        self.inv = User.objects.create_user(
            username="inv", email="inv@test.com", password="x", role=User.Role.STAFF, position="Investigator",
            first_name="Juan", last_name="Cruz",
        )
        citizen = User.objects.create_user(username="cit", email="cit@test.com", password="x", is_verified=True)
        self.reports = [
            Report.objects.create(
                citizen=citizen, location="Purok 1", ordinance=f"Ordinance {i}", incident_date="2026-09-01",
                nature_of_violation="x", assigned_investigator=self.inv,
            )
            for i in range(2)
        ]
        self.url = f"/api/auth/admin/users/{self.inv.id}/"
        self.client.force_authenticate(self.admin)

    def _claimed(self):
        return self.Report.objects.filter(assigned_investigator=self.inv).count()

    def _logs(self):
        return list(AuditLog.objects.filter(user=self.admin).values_list("action", flat=True))

    def test_disable_and_release_frees_claims_and_logs_each_one(self):
        response = self.client.patch(self.url, {"active": False, "release_claims": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._claimed(), 0)
        logs = self._logs()
        self.assertIn("Disabled Juan Cruz's account — 2 claimed reports released", logs)
        self.assertEqual(sum("Released Juan Cruz's claim" in a and "(account disabled)" in a for a in logs), 2)

    def test_disable_keeping_claims_leaves_them_assigned_and_says_so(self):
        response = self.client.patch(self.url, {"active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._claimed(), 2)
        self.assertIn("Disabled Juan Cruz's account — 2 claimed reports still assigned to them", self._logs())

    def test_disabling_someone_with_no_claims_logs_plainly(self):
        self.Report.objects.update(assigned_investigator=None)
        self.client.patch(self.url, {"active": False, "release_claims": True}, format="json")
        self.assertIn("Disabled Juan Cruz's account", self._logs())

    def test_delete_frees_claims_and_logs_who_did_it(self):
        response = self.client.delete(self.url)
        self.assertEqual(response.status_code, 204)
        self.assertTrue(all(r.assigned_investigator_id is None for r in self.Report.objects.all()))
        logs = self._logs()
        self.assertIn("Deleted Juan Cruz's account — 2 claimed reports released", logs)
        self.assertEqual(sum("Released Juan Cruz's claim" in a and "(account deleted)" in a for a in logs), 2)

    def test_long_log_entries_are_trimmed_not_dropped(self):
        self.reports[0].ordinance = "A" * 255
        self.reports[0].save()
        self.client.delete(self.url)
        entries = [a for a in self._logs() if a.startswith("Released")]
        self.assertEqual(len(entries), 2)
        self.assertTrue(all(len(a) <= 255 for a in entries))
