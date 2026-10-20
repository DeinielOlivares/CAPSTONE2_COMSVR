"""
Settings for the capstone stress test only. Never deploy with these.

Same as orms_backend.settings, except:
  - runs against its own throwaway database (STRESS_DATABASE_URL, required),
    so thousands of fake accounts and reports never land in real data;
  - emails go to memory instead of SMTP, and uploads go to local disk
    under stress_test/media instead of Cloudinary;
  - STRESS_THROTTLE=off (default) lifts every rate limit so raw capacity can
    be measured; STRESS_THROTTLE=on keeps the production limits (Table 4.C);
  - STRESS_CACHE=db keeps throttle counters in a cache table shared by every
    worker instead of the per-process LocMemCache (run
    `python manage.py createcachetable` once first).
"""

import os

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

from orms_backend.settings import *  # noqa: F401,F403
from orms_backend.settings import BASE_DIR, REST_FRAMEWORK

_db_url = os.environ.get("STRESS_DATABASE_URL", "")
if not _db_url:
    raise ImproperlyConfigured(
        "Set STRESS_DATABASE_URL to a separate, throwaway database, "
        "e.g. postgresql://postgres:<password>@localhost:5432/orms_stress"
    )
DATABASES = {"default": dj_database_url.parse(_db_url, conn_max_age=600)}

DEBUG = False
ALLOWED_HOSTS = ["*"]

EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

MEDIA_ROOT = BASE_DIR / "stress_test" / "media"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}

if os.environ.get("STRESS_THROTTLE", "off").lower() == "off":
    REST_FRAMEWORK = {
        **REST_FRAMEWORK,
        "DEFAULT_THROTTLE_RATES": {
            scope: "1000000/min" for scope in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
        },
    }

if os.environ.get("STRESS_CACHE", "locmem").lower() == "db":
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.db.DatabaseCache",
            "LOCATION": "stress_cache",
        }
    }
