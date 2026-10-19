import re
from datetime import datetime, timedelta
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from django.utils.http import urlsafe_base64_encode
from rest_framework.test import APITestCase

from orms_backend.codes import MAX_CODE_ATTEMPTS

from .lockout import FAILURE_WINDOW_MINUTES, LOCKOUT_MINUTES, MAX_FAILED_LOGINS
from .models import AuditLog, PasswordResetCode, User
from .setup_links import RESET_LINK_TTL_HOURS, SETUP_LINK_TTL_HOURS, reset_token_generator, setup_token_generator

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
SETUP_LINK_RE = re.compile(r"account-setup\.html#uid=([\w-]+)&(?:amp;)?token=([\w-]+)")


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class AccountSetupLinkTests(APITestCase):
    """
    Accounts someone else creates get no password — just a one-time emailed
    link where the owner fills in their details and chooses their own (see
    accounts/setup_links.py). Anyone who merely knows the email, or holds an
    old/used/expired link, must get nowhere.
    """

    def setUp(self):
        self.admin = User.objects.create_user(
            username="adm1", email="adm1@test.com", password=GOOD_PASSWORD, role=User.Role.ADMIN, is_verified=True
        )
        self.existing = User.objects.create_user(
            username="cap", email="cap@test.com", password=GOOD_PASSWORD, role=User.Role.STAFF,
            position="Barangay Captain", is_verified=True,
        )

    # --- helpers ---

    def _create_staff(self, email="newsec@test.com", staff_role="Secretary"):
        self.client.force_authenticate(self.admin)
        response = self.client.post(
            "/api/auth/admin/create-user/", {"email": email, "staff_role": staff_role}, format="json"
        )
        self.client.force_authenticate(None)
        self.assertEqual(response.status_code, 201, response.data)
        return User.objects.get(email=email)

    def _create_citizen_direct(self, email="juana@test.com"):
        self.client.force_authenticate(self.admin)
        response = self.client.post("/api/auth/admin/create-citizen-direct/", {
            "email": email, "first_name": "Juana", "last_name": "Cruz",
            "contact_number": "09181234567", "address": "Block 1, Lot 2, Rizal St.",
        }, format="json")
        self.client.force_authenticate(None)
        self.assertEqual(response.status_code, 201, response.data)
        return User.objects.get(email=email)

    def _link(self):
        return SETUP_LINK_RE.search(mail.outbox[-1].body).groups()

    def _check(self, uid, token):
        return self.client.post("/api/auth/account-setup/check/", {"uid": uid, "token": token}, format="json")

    def _setup(self, uid, token, **extra):
        body = {"uid": uid, "token": token, **DETAILS, **extra}
        return self.client.post("/api/auth/account-setup/", body, format="json")

    def _request_link(self, **body):
        return self.client.post("/api/auth/account-setup/request-link/", body, format="json")

    def _login_as(self, email, password=GOOD_PASSWORD, portal="staff"):
        return self.client.post(LOGIN_URL, {"email": email, "password": password, "portal": portal}, format="json")

    def _assert_still_pending(self, user):
        user.refresh_from_db()
        self.assertFalse(user.has_usable_password())

    # --- creation sends a link, never a password ---

    def test_admin_created_staff_account_gets_a_setup_link_and_no_password(self):
        user = self._create_staff()
        self.assertFalse(user.has_usable_password())
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["newsec@test.com"])
        self.assertIn("/staff/account-setup.html#uid=", mail.outbox[0].body)

    def test_directly_created_citizen_gets_a_link_with_their_details_prefilled(self):
        user = self._create_citizen_direct()
        self.assertFalse(user.has_usable_password())
        self.assertIn("/citizen/account-setup.html#uid=", mail.outbox[-1].body)
        response = self._check(*self._link())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["first_name"], "Juana")
        self.assertEqual(response.data["address"], "Block 1, Lot 2, Rizal St.")

    def test_invited_citizen_gets_a_link(self):
        self.client.force_authenticate(self.admin)
        self.client.post("/api/auth/admin/create-citizen/", {"email": "inv@test.com"}, format="json")
        self.client.force_authenticate(None)
        self.assertEqual(self._check(*self._link()).status_code, 200)

    # --- the happy path ---

    def test_full_staff_setup_flow(self):
        user = self._create_staff()
        uid, token = self._link()
        self.assertEqual(self._check(uid, token).data["email"], "newsec@test.com")

        response = self._setup(uid, token)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn("access", response.data)
        user.refresh_from_db()
        self.assertTrue(user.has_usable_password())
        self.assertEqual(user.first_name, "Ana")
        self.assertEqual(self._login_as("newsec@test.com").status_code, 200)

    def test_citizen_can_correct_prefilled_details_during_setup(self):
        user = self._create_citizen_direct()
        response = self._setup(
            *self._link(), first_name="Juanita", last_name="Cruz",
            contact_number="09181234567", address="Block 3, Lot 4, Rizal St.",
        )
        self.assertEqual(response.status_code, 200, response.data)
        user.refresh_from_db()
        self.assertEqual(user.first_name, "Juanita")
        self.assertEqual(user.address, "Block 3, Lot 4, Rizal St.")

    # --- what must not work ---

    def test_cannot_set_up_with_just_the_email(self):
        user = self._create_staff()
        response = self.client.post(
            "/api/auth/account-setup/", {"email": "newsec@test.com", **DETAILS}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
        self._assert_still_pending(user)

    def test_a_tampered_token_does_not_work(self):
        user = self._create_staff()
        uid, token = self._link()
        tampered = token[:-1] + ("a" if token[-1] != "a" else "b")
        self.assertEqual(self._setup(uid, tampered).status_code, 400)
        self._assert_still_pending(user)

    def test_link_is_single_use(self):
        self._create_staff()
        uid, token = self._link()
        self.assertEqual(self._setup(uid, token).status_code, 200)
        self.assertEqual(self._check(uid, token).status_code, 400)
        self.assertEqual(self._setup(uid, token, password="Hijack!Pass#2028z").status_code, 400)
        self.assertEqual(self._login_as("newsec@test.com").status_code, 200)

    def test_one_accounts_token_cannot_set_up_another(self):
        self._create_staff()
        _, token = self._link()
        other = self._create_staff("other@test.com", "Investigator")
        other_uid, _ = self._link()
        self.assertEqual(self._setup(other_uid, token).status_code, 400)
        self._assert_still_pending(other)

    def test_expired_link_is_refused(self):
        user = self._create_staff()
        uid, token = self._link()
        later = datetime.now() + timedelta(hours=SETUP_LINK_TTL_HOURS + 1)
        with mock.patch.object(setup_token_generator, "_now", return_value=later):
            self.assertEqual(self._check(uid, token).status_code, 400)
            self.assertEqual(self._setup(uid, token).status_code, 400)
        self._assert_still_pending(user)

    def test_requesting_a_new_link_kills_the_old_one(self):
        self._create_staff()
        old = self._link()
        self._request_link(email="newsec@test.com")
        new = self._link()
        self.assertEqual(self._check(*old).status_code, 400)
        self.assertEqual(self._check(*new).status_code, 200)

    def test_new_link_can_be_requested_from_an_expired_one(self):
        self._create_staff()
        uid, _ = self._link()
        self.assertEqual(self._request_link(uid=uid).status_code, 200)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(mail.outbox[-1].to, ["newsec@test.com"])

    def test_a_valid_token_for_an_already_set_up_account_is_refused(self):
        uid = urlsafe_base64_encode(str(self.existing.pk).encode())
        token = setup_token_generator.make_token(self.existing)
        self.assertEqual(self._setup(uid, token).status_code, 400)
        self.assertEqual(self._login_as("cap@test.com").status_code, 200)

    def test_request_link_gives_the_same_answer_whether_or_not_the_account_exists(self):
        self._create_staff()
        mail.outbox.clear()
        pending = self._request_link(email="newsec@test.com")
        unknown = self._request_link(email="nobody@test.com")
        set_up = self._request_link(email="cap@test.com")
        self.assertEqual((pending.status_code, unknown.status_code, set_up.status_code), (200, 200, 200))
        self.assertEqual(pending.data, unknown.data)
        self.assertEqual(pending.data, set_up.data)
        self.assertEqual([m.to for m in mail.outbox], [["newsec@test.com"]])

    # --- password rules apply at setup too ---

    def test_setup_password_must_meet_the_rules(self):
        user = self._create_staff()
        response = self._setup(*self._link(), password="qwertzuiop")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self._assert_still_pending(user)

    def test_setup_password_cannot_resemble_the_name_being_entered(self):
        user = self._create_staff()
        response = self._setup(*self._link(), first_name="Maximiliano", password="Maximiliano!1")
        self.assertEqual(response.status_code, 400)
        self.assertIn("password", response.data)
        self._assert_still_pending(user)

    # --- login on a pending account ---

    def test_login_on_a_pending_account_points_to_setup(self):
        self._create_staff()
        response = self._login_as("newsec@test.com", "anything")
        self.assertEqual(response.status_code, 401)
        self.assertIn("hasn't been set up", str(response.data["detail"]))

    def test_citizen_login_does_not_reveal_pending_staff_accounts(self):
        self._create_staff()
        response = self._login_as("newsec@test.com", "anything", portal="citizen")
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("set up", str(response.data["detail"]))

    def test_old_code_based_setup_endpoints_are_gone(self):
        self.assertEqual(self.client.post("/api/auth/staff-setup/", {}, format="json").status_code, 404)
        self.assertEqual(self.client.post("/api/auth/staff-setup/request-code/", {}, format="json").status_code, 404)


@override_settings(PASSWORD_HASHERS=FAST_HASHER, CACHES=REAL_CACHE)
class AccountSetupThrottleTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)

    def _request(self, email):
        return self.client.post("/api/auth/account-setup/request-link/", {"email": email}, format="json")

    def test_link_requests_are_limited_per_email(self):
        for _ in range(3):
            self.assertEqual(self._request("a@test.com").status_code, 200)
        self.assertEqual(self._request("a@test.com").status_code, 429)

    def test_link_requests_are_limited_per_ip(self):
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

    def test_disable_without_releasing_active_claims_is_refused(self):
        response = self.client.patch(self.url, {"active": False}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["active_claims"], 2)
        self.inv.refresh_from_db()
        self.assertTrue(self.inv.is_active)
        self.assertEqual(self._claimed(), 2)

    def test_closed_claims_stay_with_the_investigator_and_dont_block(self):
        self.Report.objects.update(status=self.Report.Status.RESOLVED)
        self.reports[1].status = self.Report.Status.WITH_REMARKS
        self.reports[1].save()
        response = self.client.patch(self.url, {"active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._claimed(), 2)

    def test_release_only_frees_active_claims(self):
        self.reports[0].status = self.Report.Status.RESOLVED
        self.reports[0].save()
        response = self.client.patch(self.url, {"active": False, "release_claims": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.reports[0].refresh_from_db()
        self.reports[1].refresh_from_db()
        self.assertEqual(self.reports[0].assigned_investigator_id, self.inv.id)
        self.assertIsNone(self.reports[1].assigned_investigator_id)
        self.assertIn("Disabled Juan Cruz's account — 1 claimed report released", self._logs())

    def test_role_change_without_releasing_active_claims_is_refused(self):
        response = self.client.patch(self.url, {"staff_role": "Secretary"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.position, "Investigator")
        self.assertEqual(self._claimed(), 2)

    def test_role_change_with_release_frees_claims_then_changes_role(self):
        response = self.client.patch(self.url, {"staff_role": "Secretary", "release_claims": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.inv.refresh_from_db()
        self.assertEqual(self.inv.position, "Secretary")
        self.assertEqual(self._claimed(), 0)
        logs = self._logs()
        self.assertIn("Changed Juan Cruz's role to Secretary — 2 claimed reports released", logs)
        self.assertEqual(sum("(role changed)" in a for a in logs), 2)

    def test_resaving_the_same_role_needs_no_release(self):
        response = self.client.patch(self.url, {"staff_role": "Investigator"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._claimed(), 2)

    def test_refused_role_change_releases_nothing(self):
        # Last-admin/uniqueness style refusals happen before any release.
        response = self.client.patch(self.url, {"staff_role": "Not A Role", "release_claims": True}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._claimed(), 2)

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


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ChangePasswordRulesTests(APITestCase):
    """Change Password enforces the same character-class rules as Sign Up."""

    url = "/api/auth/change-password/"

    def setUp(self):
        self.user = User.objects.create_user(
            username="maria", email="maria@test.com", password=GOOD_PASSWORD, is_verified=True
        )
        self.client.force_authenticate(self.user)

    def _change(self, new_password):
        return self.client.post(
            self.url, {"current_password": GOOD_PASSWORD, "new_password": new_password}, format="json"
        )

    def test_password_missing_character_classes_is_rejected(self):
        for weak in ["qwertzuiop", "QWERTZUIOP1", "Qwertzuiop1"]:
            response = self._change(weak)
            self.assertEqual(response.status_code, 400, weak)
            self.assertIn("new_password", response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(GOOD_PASSWORD))

    def test_password_meeting_every_rule_is_accepted(self):
        self.assertEqual(self._change("An0ther!Pass#2027y").status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("An0ther!Pass#2027y"))


RESET_LINK_RE = re.compile(r"new-password\.html#uid=([\w-]+)&(?:amp;)?token=([\w-]+)")


@override_settings(PASSWORD_HASHERS=FAST_HASHER)
class AdminAccountLinkButtonTests(APITestCase):
    """Manage Accounts' Resend Setup Link and Reset Password buttons."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="adm2", email="adm2@test.com", password=GOOD_PASSWORD, role=User.Role.ADMIN, is_verified=True
        )
        self.staff = User.objects.create_user(
            username="inv", email="inv@test.com", password=GOOD_PASSWORD, role=User.Role.STAFF,
            position="Investigator", is_verified=True, first_name="Ivan",
        )
        self.citizen = User.objects.create_user(
            username="cit", email="cit@test.com", password=GOOD_PASSWORD, is_verified=True
        )
        self.pending = User(username="new@test.com", email="new@test.com", role=User.Role.STAFF,
                            position="Investigator", is_verified=True)
        self.pending.set_unusable_password()
        self.pending.save()

    def _as_admin(self, method_path):
        self.client.force_authenticate(self.admin)
        response = self.client.post(method_path, format="json")
        self.client.force_authenticate(None)
        return response

    def _resend(self, user):
        return self._as_admin(f"/api/auth/admin/users/{user.pk}/resend-setup-link/")

    def _reset(self, user):
        return self._as_admin(f"/api/auth/admin/users/{user.pk}/reset-password/")

    def _reset_link(self):
        return RESET_LINK_RE.search(mail.outbox[-1].body).groups()

    def _confirm(self, uid, token, password="Brand!New#Pass2029"):
        return self.client.post(
            "/api/auth/password-link/", {"uid": uid, "token": token, "password": password}, format="json"
        )

    def _login(self, email, password):
        return self.client.post(LOGIN_URL, {"email": email, "password": password, "portal": "staff"}, format="json")

    # --- Resend Setup Link ---

    def test_resend_setup_link_works_while_pending(self):
        self.assertEqual(self._resend(self.pending).status_code, 200)
        self.assertEqual(mail.outbox[-1].to, ["new@test.com"])
        self.assertIn("account-setup.html#uid=", mail.outbox[-1].body)

    def test_resend_setup_link_is_refused_once_set_up(self):
        response = self._resend(self.staff)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)
        self.staff.refresh_from_db()
        self.assertTrue(self.staff.check_password(GOOD_PASSWORD))

    def test_only_admins_can_resend(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(f"/api/auth/admin/users/{self.pending.pk}/resend-setup-link/")
        self.assertEqual(response.status_code, 403)

    # --- Reset Password ---

    def test_reset_password_emails_a_link_and_never_returns_a_token(self):
        response = self._reset(self.staff)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("token", response.data)
        self.assertEqual(mail.outbox[-1].to, ["inv@test.com"])
        # Current password still works until the link is used.
        self.assertEqual(self._login("inv@test.com", GOOD_PASSWORD).status_code, 200)

    def test_full_reset_flow(self):
        self._reset(self.staff)
        uid, token = self._reset_link()
        check = self.client.post("/api/auth/password-link/check/", {"uid": uid, "token": token}, format="json")
        self.assertEqual(check.status_code, 200)
        self.assertEqual(check.data["email"], "inv@test.com")
        self.assertEqual(self._confirm(uid, token).status_code, 200)
        self.assertEqual(self._login("inv@test.com", "Brand!New#Pass2029").status_code, 200)
        self.assertEqual(self._login("inv@test.com", GOOD_PASSWORD).status_code, 401)

    def test_reset_link_is_single_use(self):
        self._reset(self.staff)
        uid, token = self._reset_link()
        self.assertEqual(self._confirm(uid, token).status_code, 200)
        self.assertEqual(self._confirm(uid, token, "Hijack!Pass#2030q").status_code, 400)

    def test_reset_link_expires_after_its_own_shorter_window(self):
        self._reset(self.staff)
        uid, token = self._reset_link()
        later = datetime.now() + timedelta(hours=RESET_LINK_TTL_HOURS + 1)
        with mock.patch.object(reset_token_generator, "_now", return_value=later):
            self.assertEqual(self._confirm(uid, token).status_code, 400)

    def test_reset_and_setup_tokens_are_not_interchangeable(self):
        self._reset(self.staff)
        uid, token = self._reset_link()
        response = self.client.post(
            "/api/auth/account-setup/", {"uid": uid, "token": token, **DETAILS}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_new_password_must_meet_rules_and_differ_from_current(self):
        self._reset(self.staff)
        uid, token = self._reset_link()
        self.assertEqual(self._confirm(uid, token, "qwertzuiop").status_code, 400)
        self.assertEqual(self._confirm(uid, token, GOOD_PASSWORD).status_code, 400)

    def test_reset_password_is_refused_for_citizens(self):
        self.assertEqual(self._reset(self.citizen).status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_password_is_refused_for_pending_accounts(self):
        self.assertEqual(self._reset(self.pending).status_code, 400)

    def test_reset_password_is_refused_for_yourself(self):
        self.assertEqual(self._reset(self.admin).status_code, 400)

    def test_reset_password_is_refused_for_disabled_accounts(self):
        self.staff.is_active = False
        self.staff.save()
        self.assertEqual(self._reset(self.staff).status_code, 400)


class CreateAdminCommandTests(APITestCase):
    """create_admin runs on every deploy/restart, so it must never undo a password change."""

    ENV = {"ADMIN_EMAIL": "first.admin@test.com", "ADMIN_PASSWORD": "Default!Pass#2026"}

    def _run(self):
        import os
        from io import StringIO

        from django.core.management import call_command

        with mock.patch.dict(os.environ, self.ENV):
            call_command("create_admin", stdout=StringIO())

    def test_creates_the_account_the_first_time(self):
        self._run()
        user = User.objects.get(email=self.ENV["ADMIN_EMAIL"])
        self.assertEqual(user.role, User.Role.ADMIN)
        self.assertTrue(user.check_password(self.ENV["ADMIN_PASSWORD"]))

    def test_a_changed_password_survives_later_runs(self):
        self._run()
        user = User.objects.get(email=self.ENV["ADMIN_EMAIL"])
        user.set_password(GOOD_PASSWORD)
        user.save()

        self._run()
        user.refresh_from_db()
        self.assertTrue(user.check_password(GOOD_PASSWORD))
        self.assertFalse(user.check_password(self.ENV["ADMIN_PASSWORD"]))
        self.assertEqual(User.objects.filter(email__iexact=self.ENV["ADMIN_EMAIL"]).count(), 1)
