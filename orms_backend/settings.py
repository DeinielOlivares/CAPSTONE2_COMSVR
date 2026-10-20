"""
Django settings for orms_backend project.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Core / security -------------------------------------------------------
# All of these come from environment variables so nothing secret is
# committed to GitHub. Set them in Render's dashboard (or a local .env file
# for development — see .env.example).

SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

# Render's health checks and the deployed URL both need to be trusted for
# CSRF once DEBUG is off.
CSRF_TRUSTED_ORIGINS = config("CSRF_TRUSTED_ORIGINS", default="", cast=Csv())

# --- Data protection (Modified Blowfish) ---------------------------------
# The master key every encrypted personal-data value's own key is derived from
# (see orms_backend/encrypted_fields.py). Kept out of the code and out of the
# database on purpose: the database alone is unreadable without it. If it is
# lost, the encrypted data cannot be recovered — back it up somewhere separate
# from the database. Nothing is encrypted or decrypted without it; there is no
# default, so a missing key fails loudly instead of writing unprotected data.
DATA_ENCRYPTION_KEY = config("DATA_ENCRYPTION_KEY", default="")
# PBKDF2-HMAC-SHA256 rounds used to derive each value's key. Stored alongside
# every value, so changing this only affects values written afterwards. Higher
# costs time on every first read of a value (about 0.5 ms per 1,000 rounds on
# a typical machine) — set it from the study's performance testing.
MODIFIED_BLOWFISH_ITERATIONS = config("MODIFIED_BLOWFISH_ITERATIONS", default=1000, cast=int)

AUTH_USER_MODEL = "accounts.User"

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "cloudinary_storage",
    "cloudinary",
    "accounts",
    "reports",
    "ordinances",
    "siteinfo",
    "announcements",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "accounts.middleware.CurrentRequestMiddleware",
]

ROOT_URLCONF = "orms_backend.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "orms_backend.wsgi.application"

# --- Database ----------------------------------------------------------
# Reads DATABASE_URL from the environment (Render/Neon/Supabase all provide
# this format). Falls back to local sqlite for quick local dev without
# needing Postgres installed.
#
# Goes through decouple's config() rather than dj_database_url.config()
# (which reads os.environ directly) — decouple loads .env into its own
# internal store without also populating os.environ, so dj_database_url.config()
# was silently never seeing DATABASE_URL and always falling back to sqlite,
# even with a real Postgres URL set in .env.

DATABASES = {
    "default": dj_database_url.parse(
        config("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
        conn_max_age=600,
    )
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "accounts.password_validators.CharacterClassValidator"},
]

# How long an emailed one-time account setup link stays valid (see
# accounts/setup_links.py). Django's own default is the same 3 days; set here
# so the setup email's "expires in" text and the actual expiry can't drift.
PASSWORD_RESET_TIMEOUT = 60 * 60 * 72

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Manila"
USE_I18N = True
USE_TZ = True

# --- Static files & the existing frontend -------------------------------
# collectstatic output (DRF's browsable API assets, Django admin CSS, etc.)
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The citizen/staff/admin portals (plain HTML/CSS/JS) are served directly
# from the project root ("/citizen/...", "/staff/...", "/admin-portal/...")
# by WhiteNoise, so the whole system — API + frontend — is one deployable
# unit with one URL. This is what WHITENOISE_ROOT is for: files here are
# served from "/", separately from the STATIC_URL-prefixed app assets above.
WHITENOISE_ROOT = BASE_DIR / "frontend"
WHITENOISE_INDEX_FILE = "index.html"

# User-uploaded files (voter's ID images, evidence photos/videos).
#
# Render's disk does NOT persist uploads across deploys/restarts, so in
# production these go to Cloudinary instead of the local filesystem. Set
# CLOUDINARY_URL (from the Cloudinary dashboard, format:
# cloudinary://<api_key>:<api_secret>@<cloud_name>) as an env var to enable
# this. Left unset, uploads fall back to local disk under MEDIA_ROOT — fine
# for local dev, not for production.
CLOUDINARY_URL = config("CLOUDINARY_URL", default="")
if CLOUDINARY_URL:
    os.environ.setdefault("CLOUDINARY_URL", CLOUDINARY_URL)

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

STORAGES = {
    "default": {
        "BACKEND": (
            "cloudinary_storage.storage.MediaCloudinaryStorage"
            if CLOUDINARY_URL
            else "django.core.files.storage.FileSystemStorage"
        ),
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# Django rejects any multipart request (including file uploads — the PDF
# content counts against this, not just the form fields) over this size with
# a 400 before it ever reaches a view. The default is 2.5MB, which a real
# scanned multi-page ordinance resolution PDF blows past easily — that 400
# is exactly what was showing up as "Could not upload this ordinance." in
# the UI (see ordinances-data.js's readFirstError, fixed to surface this
# response's actual detail message instead of a generic fallback).
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Django REST Framework + JWT ----------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    # Rate limiting. Everything gets the broad anon/user limits below; views
    # that override throttle_classes with ScopedRateThrottle + a throttle_scope
    # get their own tighter one from the matching entry.
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        # Broad limits, per IP (anon) / per account (user). Generous on purpose:
        # a barangay hall or mobile carrier can put many real people behind one IP.
        "anon": "120/min",
        "user": "300/min",
        # Sensitive endpoints — see the views that name these as throttle_scope.
        "login": "10/min",
        "register": "5/hour",
        "signup_code": "5/hour",
        "signup_code_email": "3/hour",
        "signup_verify": "5/min",
        "account_setup": "10/min",
        "account_setup_link": "5/hour",
        "reset_request": "5/hour",
        "reset_request_email": "3/hour",
        "reset_verify": "5/min",
        "reset_confirm": "5/min",
        "report_send_code": "3/hour",
        "report_verify_code": "5/min",
        "profile_edit_code": "5/hour",
    },
    # How many proxies sit in front of the app. Without this DRF can't tell the
    # real client IP from X-Forwarded-For, which anyone can fake — so every
    # visitor would either share one limit or dodge it by changing the header.
    # 1 = a single trusted proxy (Render's load balancer). Verify after deploying.
    "NUM_PROXIES": config("NUM_PROXIES", default=1, cast=int),
}

# Throttle counters live in the cache. LocMemCache is per-process, which is right
# for a single gunicorn worker (as deployed); running several workers or
# instances would each count separately, so switch to a shared cache (Redis) then.
# Tests get DummyCache so unrelated tests don't trip limits by sharing 127.0.0.1;
# throttle tests opt back in with override_settings.
if "test" in sys.argv:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.dummy.DummyCache"}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    # Without this, Django's last_login field never updates on JWT login,
    # which would make the admin Manage Accounts "Active"/last-active status
    # meaningless (every account would permanently show "Never logged in").
    "UPDATE_LAST_LOGIN": True,
}

# --- Email -----------------------------------------------------------------
# Brevo's SMTP relay (see README for setup — sign up, verify a sender email,
# then SMTP & API -> SMTP -> generate an SMTP key). Sends real email when
# EMAIL_HOST_USER is set; otherwise falls back to printing the email to the
# console, so local dev/testing works without needing real credentials.
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_BACKEND = (
    "django.core.mail.backends.smtp.EmailBackend"
    if EMAIL_HOST_USER
    else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = config("EMAIL_HOST", default="smtp-relay.brevo.com")
# Some hosts (Render included) block or silently swallow outbound SMTP on
# the standard ports — the connection just hangs instead of failing. Without
# a timeout, that hang is unbounded: it blocks the whole request until the
# WSGI server's OWN worker-timeout kills the process outright (a forced
# worker-abort raises SystemExit, which deliberately isn't caught by
# emails.py's `except Exception` — that's correct, since a bare except
# should never swallow a real process-exit signal — so it bypasses the
# "email failures never break the request" guarantee entirely and takes the
# whole worker down instead of just failing the one send). This timeout is
# what turns that hang into an ordinary, catchable exception instead.
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)

# decouple's default= only kicks in when the key is missing entirely, not
# when it's present-but-blank (which .env.example ships as, so people fill
# it in) — so an explicit `or` here is what actually falls back correctly.
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="") or EMAIL_HOST_USER or "no-reply@orms.local"

# The citizen portal's own origin, for the handful of emails that include an
# actual clickable link back to the site (e.g. an Announcement's "quick
# link" — see orms_backend/emails.py's send_announcement_posted_email).
# Everything else just says "Log in to Barangay Platero OVRMS" as plain text, so this
# isn't needed more broadly. Frontend is same-origin via WhiteNoise (see
# CORS note below), so this is also where the backend itself is reachable.
FRONTEND_BASE_URL = config("FRONTEND_BASE_URL", default="http://127.0.0.1:8000").rstrip("/")

# --- CORS ----------------------------------------------------------------
# Frontend is served from the same origin via WhiteNoise above, so CORS
# usually isn't even hit in production. This stays enabled for local dev,
# where the frontend might be opened from a different port/tool.
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="", cast=Csv())
CORS_ALLOW_ALL_ORIGINS = DEBUG
