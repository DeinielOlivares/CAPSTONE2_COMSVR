"""
Django settings for the Barangay Platero OVRMS project.

Secrets and machine-specific values come from environment variables (or a
local .env file — see .env.example), never from the code.
"""

import os
import sys
from datetime import timedelta
from pathlib import Path

import dj_database_url
from decouple import Csv, config

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Core / security --------------------------------------------------------

SECRET_KEY = config("SECRET_KEY")
DEBUG = config("DEBUG", default=False, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())
CSRF_TRUSTED_ORIGINS = config("CSRF_TRUSTED_ORIGINS", default="", cast=Csv())

# --- Data protection (Modified Blowfish) ------------------------------------
# Master key that every encrypted value's own key is derived from (see
# orms_backend/encrypted_fields.py). Required — there is no default, so a
# missing key fails loudly. If it is lost, the encrypted data can't be read:
# back it up separately from the database.
DATA_ENCRYPTION_KEY = config("DATA_ENCRYPTION_KEY", default="")
# PBKDF2 rounds per value (saved with each value, so changing it is safe).
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
    # The system's own apps:
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

# --- Database ---------------------------------------------------------------
# DATABASE_URL (PostgreSQL on the live site); a local SQLite file otherwise.

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

# How long an emailed account setup link stays valid (3 days).
PASSWORD_RESET_TIMEOUT = 60 * 60 * 72

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Manila"
USE_I18N = True
USE_TZ = True

# --- Static files and the frontend ------------------------------------------
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# The three portals (plain HTML/CSS/JS in frontend/) are served from "/" by
# WhiteNoise, so the API and the website are one deployable app.
WHITENOISE_ROOT = BASE_DIR / "frontend"
WHITENOISE_INDEX_FILE = "index.html"

# --- Uploaded files ---------------------------------------------------------
# Cloudinary in production (set CLOUDINARY_URL); the local media/ folder otherwise.
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

# Largest upload accepted (scanned ordinance PDFs can be big).
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024  # 25MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Django REST Framework + JWT --------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    # Rate limits. Every request counts toward anon/user; views with a
    # throttle_scope also get the tighter limit named below.
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "120/min",   # per IP address
        "user": "300/min",   # per account
        "login": "10/min",
        "register": "5/hour",
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
    # Number of proxies in front of the app (Render has 1), so the real
    # visitor IP is read from X-Forwarded-For.
    "NUM_PROXIES": config("NUM_PROXIES", default=1, cast=int),
}

# Rate-limit counters live in the cache. Tests use a dummy cache so unrelated
# tests don't hit limits (throttle tests turn the real cache back on).
if "test" in sys.argv:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.dummy.DummyCache"}}
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=1),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "UPDATE_LAST_LOGIN": True,  # Manage Accounts shows "last active"
}

# --- Email ------------------------------------------------------------------
# Brevo SMTP when EMAIL_HOST_USER is set; otherwise emails are printed to the
# console (handy for local development).
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_BACKEND = (
    "django.core.mail.backends.smtp.EmailBackend"
    if EMAIL_HOST_USER
    else "django.core.mail.backends.console.EmailBackend"
)
EMAIL_HOST = config("EMAIL_HOST", default="smtp-relay.brevo.com")
# Without a timeout a blocked SMTP port would hang the request forever.
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_TLS = config("EMAIL_USE_TLS", default=True, cast=bool)

# `or` (not just default=) because .env.example ships these keys blank.
DEFAULT_FROM_EMAIL = config("DEFAULT_FROM_EMAIL", default="") or EMAIL_HOST_USER or "no-reply@orms.local"

# The site's own address, used for links inside emails.
FRONTEND_BASE_URL = config("FRONTEND_BASE_URL", default="http://127.0.0.1:8000").rstrip("/")

# --- CORS -------------------------------------------------------------------
# The frontend is served from the same address, so CORS only matters in development.
CORS_ALLOWED_ORIGINS = config("CORS_ALLOWED_ORIGINS", default="", cast=Csv())
CORS_ALLOW_ALL_ORIGINS = DEBUG
