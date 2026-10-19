"""
Locust scenarios for the capstone stress test. Pick one by class name:

    locust -f stress_test/locustfile.py --host http://127.0.0.1:8000 BrowseOrdinances

Scenarios (Table 4.A/4.B/4.C/...):
    BrowseOrdinances   GET  /api/ordinances/                 (anonymous)
    HomeAbout          GET  /api/site/about/ + /api/site/branding/
    MyProfile          GET  /api/auth/me/                    (logged in)
    OrdinanceMatch     GET  /api/ordinances/suggest/?q=...   (TF-IDF)
    Login              POST /api/auth/login/                 (correct password)
    LoginFlood         POST /api/auth/login/                 (wrong password, Table 4.C)
    FileReport         POST /api/reports/ with a photo       (encryption + upload)
    MixedCitizen       weighted mix of the above, closest to real use

Environment options:
    STRESS_MAX_REQUESTS=1000   stop after this many requests (fixed-count runs)
    STRESS_SHAPE=step|spike    use a load shape instead of -u/-r (see bottom)
    STRESS_PHOTO=<path>        photo attached by FileReport
    STRESS_RESULT=<prefix>     where the status-code breakdown is written

Every run also writes <STRESS_RESULT>_status.csv: how many responses came back
with each HTTP status, which Table 4.C needs (2xx served vs 429 rejected).
"""

import itertools
import logging
import os
import random
import threading
import time
from collections import Counter
from pathlib import Path

import gevent
import gevent.pool
import requests
from locust import FastHttpUser, HttpUser, LoadTestShape, between, constant, events, task

PASSWORD = "Stress-Test#2026"  # matches stress_test/seed.py
EMAIL_DOMAIN = "stress.test"
CITIZEN_COUNT = int(os.environ.get("STRESS_CITIZENS", "300"))
PHOTO = Path(os.environ.get(
    "STRESS_PHOTO", Path(__file__).resolve().parent.parent / "drawables" / "BARANGAY PLATERO.jpg"
))

# What citizens type into the File Report "violation" box.
MATCH_QUERIES = [
    "neighbor smoking inside the jeepney", "loud karaoke past midnight",
    "garbage thrown in the canal", "minors outside during curfew",
    "tricycle parked on the sidewalk", "stray dogs biting kids",
    "burning plastic in the backyard", "men drinking alcohol on the street",
    "no waste segregation", "vendor blocking the road", "man walking without shirt",
    "cara y cruz gambling at the corner", "construction debris on the road",
]

_emails = itertools.cycle(f"stress{i:04d}@{EMAIL_DOMAIN}" for i in range(1, CITIZEN_COUNT + 1))
_emails_lock = threading.Lock()


def next_citizen_email():
    with _emails_lock:
        return next(_emails)


# --- Run bookkeeping ---------------------------------------------------------

status_counts = Counter()
_request_total = 0
_first_at = _last_at = None  # wall-clock span of the measured requests, for throughput
MAX_REQUESTS = int(os.environ.get("STRESS_MAX_REQUESTS", "0"))


@events.request.add_listener
def _count(response=None, exception=None, **kwargs):
    global _request_total, _first_at, _last_at
    now = time.time()
    _first_at = _first_at or now
    _last_at = now
    code = getattr(response, "status_code", 0) if response is not None else 0
    status_counts["error" if exception and not code else code] += 1
    _request_total += 1
    if MAX_REQUESTS and _request_total == MAX_REQUESTS:
        if _runner:
            gevent.spawn(_runner.quit)


_runner = None


@events.init.add_listener
def _keep_runner(environment, **kwargs):
    global _runner
    _runner = environment.runner


@events.quitting.add_listener
def _write_status(environment, **kwargs):
    prefix = os.environ.get("STRESS_RESULT", "results/run")
    Path(prefix).parent.mkdir(parents=True, exist_ok=True)
    with open(f"{prefix}_status.csv", "w", encoding="utf-8") as f:
        f.write("status,count\n")
        for code, count in sorted(status_counts.items(), key=lambda kv: str(kv[0])):
            f.write(f"{code},{count}\n")
    # Locust's own *_stats.csv can miss the last seconds when a run is stopped
    # by STRESS_MAX_REQUESTS, so the final totals are written here as well.
    total = environment.stats.total
    # Locust's own total_rps counts from when the test started, which would
    # include the pre-login phase; this counts only the span of real requests.
    span = (_last_at - _first_at) if _first_at else 0
    rps = total.num_requests / span if span > 0 else 0
    with open(f"{prefix}_summary.csv", "w", encoding="utf-8") as f:
        f.write("requests,failures,rps,avg_ms,p95_ms,max_ms\n")
        f.write(",".join(str(v) for v in [
            total.num_requests, total.num_failures, round(rps, 2),
            round(total.avg_response_time, 1), total.get_response_time_percentile(0.95),
            round(total.max_response_time or 0, 1),
        ]) + "\n")
    print("Status codes:", dict(status_counts))


# --- Scenarios ---------------------------------------------------------------
# wait_time=constant(0): each simulated user fires its next request as soon as
# the last one returns, so "users" = concurrent requests in flight, like the
# thread-pool client the draft describes.


class BrowseOrdinances(FastHttpUser):
    wait_time = constant(0)

    @task
    def browse(self):
        self.client.get("/api/ordinances/", name="GET /api/ordinances/")


class HomeAbout(FastHttpUser):
    wait_time = constant(0)

    @task
    def about(self):
        self.client.get("/api/site/about/", name="GET /api/site/about/")
        self.client.get("/api/site/branding/", name="GET /api/site/branding/")


class OrdinanceMatch(FastHttpUser):
    wait_time = constant(0)

    @task
    def suggest(self):
        q = random.choice(MATCH_QUERIES)
        self.client.get("/api/ordinances/suggest/", params={"q": q}, name="GET /api/ordinances/suggest/")


_tokens = {}  # email -> access token, filled before the test clock starts


def _fetch_token(host, email):
    resp = requests.post(
        f"{host}/api/auth/login/",
        json={"email": email, "password": PASSWORD, "portal": "citizen"},
        timeout=120,
    )
    if resp.status_code != 200:
        # Usually means the server is running with STRESS_THROTTLE=on (login is
        # limited to 10/min per IP) or the citizens weren't seeded.
        logging.warning("Setup login for %s failed with HTTP %s: %s", email, resp.status_code, resp.text[:200])
        return None
    return resp.json()["access"]


@events.test_start.add_listener
def _prelogin(environment, **kwargs):
    """
    Logs in one account per simulated user before any user starts, so the
    expensive PBKDF2 logins don't land inside the measured requests of
    scenarios like MyProfile. (Tokens last an hour; enough for the soak test.)
    """
    users = getattr(environment.parsed_options, "num_users", None) or 0
    if not any(getattr(cls, "needs_login", False) for cls in environment.user_classes) or not users:
        return
    emails = [f"stress{i:04d}@{EMAIL_DOMAIN}" for i in range(1, min(users, CITIZEN_COUNT) + 1)]
    print(f"Logging in {len(emails)} test accounts before starting...")
    pool = gevent.pool.Pool(4)
    for email, token in zip(emails, pool.imap(lambda e: _fetch_token(environment.host, e), emails)):
        if token:
            _tokens[email] = token


def log_in(user):
    """
    Gives a simulated user an account's token: the pre-fetched one if there
    is one, otherwise a fresh login. Sent with plain `requests`, not
    user.client, so setup logins stay out of the scenario's results.
    """
    email = next_citizen_email()
    token = _tokens.get(email) or _fetch_token(user.host, email)
    user.auth = {"Authorization": f"Bearer {token}"} if token else {}


def post_report(user):
    user.client.post(
        "/api/reports/",
        headers=user.auth,
        data={
            "location": "Purok 1, Barangay Platero",
            "ordinance": "Stress Ord. No. 1-(2026)",
            "incident_date": "2026-10-01",
            "nature_of_violation": f"Stress test report: {random.choice(MATCH_QUERIES)}",
        },
        files={"files": ("photo.jpg", user.photo, "image/jpeg")},
        name="POST /api/reports/",
    )


class MyProfile(FastHttpUser):
    needs_login = True
    wait_time = constant(0)

    def on_start(self):
        log_in(self)

    @task
    def me(self):
        self.client.get("/api/auth/me/", headers=self.auth, name="GET /api/auth/me/")


class Login(FastHttpUser):
    wait_time = constant(0)

    @task
    def login(self):
        self.client.post(
            "/api/auth/login/",
            json={"email": next_citizen_email(), "password": PASSWORD, "portal": "citizen"},
            name="POST /api/auth/login/",
        )


class LoginFlood(FastHttpUser):
    """Wrong passwords against flood@stress.test: 401s while under the limit, 429s past it."""
    wait_time = constant(0)

    @task
    def bad_login(self):
        with self.client.post(
            "/api/auth/login/",
            json={"email": f"flood@{EMAIL_DOMAIN}", "password": "wrong-password", "portal": "citizen"},
            name="POST /api/auth/login/ (wrong password)",
            catch_response=True,
        ) as resp:
            # 401 is the correct answer to a wrong password, not a failure of the system.
            if resp.status_code == 401:
                resp.success()


# File uploads use HttpUser (the requests library), which handles multipart
# bodies; the read scenarios use the faster FastHttpUser so the load generator
# itself doesn't become the bottleneck.
class FileReport(HttpUser):
    needs_login = True
    wait_time = constant(0)

    def on_start(self):
        log_in(self)
        self.photo = PHOTO.read_bytes()

    @task
    def file_report(self):
        post_report(self)


class MixedCitizen(HttpUser):
    """A realistic visitor: pauses 1-5 s between actions, mostly reads."""
    needs_login = True
    wait_time = between(1, 5)

    def on_start(self):
        log_in(self)
        self.photo = PHOTO.read_bytes()

    @task(30)
    def browse(self):
        self.client.get("/api/ordinances/", name="GET /api/ordinances/")

    @task(15)
    def about(self):
        self.client.get("/api/site/about/", name="GET /api/site/about/")

    @task(20)
    def suggest(self):
        self.client.get("/api/ordinances/suggest/", params={"q": random.choice(MATCH_QUERIES)},
                        name="GET /api/ordinances/suggest/")

    @task(15)
    def me(self):
        self.client.get("/api/auth/me/", headers=self.auth, name="GET /api/auth/me/")

    @task(15)
    def my_reports(self):
        self.client.get("/api/reports/", headers=self.auth, name="GET /api/reports/")

    @task(5)
    def file_report(self):
        post_report(self)


# --- Load shapes (only active when STRESS_SHAPE is set) ----------------------

SHAPE = os.environ.get("STRESS_SHAPE", "").lower()

if SHAPE == "step":
    class StepToBreak(LoadTestShape):
        """+100 users every 60 s up to 1,000: find where errors or timeouts start."""
        step_users, step_time, max_users = 100, 60, 1000

        def tick(self):
            run_time = self.get_run_time()
            users = (int(run_time // self.step_time) + 1) * self.step_users
            if users > self.max_users:
                return None
            return users, self.step_users

elif SHAPE == "spike":
    class Spike(LoadTestShape):
        """20 users for 1 min, jump to 300 for 1 min, back to 20 for 2 min."""
        stages = [(60, 20), (120, 300), (240, 20)]

        def tick(self):
            run_time = self.get_run_time()
            for end, users in self.stages:
                if run_time < end:
                    return users, 300  # spawn all at once
            return None
