"""
Top-level URL map.

    /api/auth/...           accounts app (login, sign up, profile, admin accounts)
    /api/reports|concerns|questions|faqs/...   reports app
    /api/ordinances/...     ordinances app
    /api/site/...           siteinfo app (About Us, branding, legal pages, map)
    /api/announcements/...  announcements app
    /api/media/protected/   decrypts an encrypted upload for a signed link
    /django-admin/          Django's own admin site

Everything else (/citizen/, /staff/, /admin/, /shared/) is the static
frontend, served by WhiteNoise from the frontend/ folder.
"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from django.views.generic.base import RedirectView

from .encrypted_storage import ProtectedMediaView

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("reports.urls")),
    path("api/", include("ordinances.urls")),
    path("api/site/", include("siteinfo.urls")),
    path("api/announcements/", include("announcements.urls")),
    path("api/media/protected/<str:token>/", ProtectedMediaView.as_view(), name="protected_media"),
    # Old address of the citizen login page.
    path("citizen/login/", RedirectView.as_view(url="/citizen/login.html", permanent=False)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
