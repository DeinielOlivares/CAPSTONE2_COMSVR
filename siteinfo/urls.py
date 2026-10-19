"""Site information endpoints. Every path here starts with /api/site/."""

from django.urls import path

from . import views

urlpatterns = [
    path("about/", views.AboutPublicView.as_view(), name="site_about"),
    path("boundary/", views.BoundaryView.as_view(), name="site_boundary"),
    path("profile/", views.BarangayProfileView.as_view(), name="site_profile"),
    path("branding/", views.BrandingPublicView.as_view(), name="site_branding"),
    path("legal/<str:key>/", views.LegalDocumentView.as_view(), name="site_legal"),
    path("legal/<str:key>/admin/", views.LegalDocumentView.as_view(), name="site_legal_admin"),
    path("branding/admin/", views.BrandingView.as_view(), name="site_branding_admin"),
    path("council/", views.CouncilMemberListCreateView.as_view(), name="site_council_list_create"),
    path("council/reorder/", views.CouncilMemberReorderView.as_view(), name="site_council_reorder"),
    path("council/<uuid:pk>/", views.CouncilMemberDetailView.as_view(), name="site_council_detail"),
    path("logos/", views.AboutLogoListCreateView.as_view(), name="site_logo_list_create"),
    path("logos/reorder/", views.AboutLogoReorderView.as_view(), name="site_logo_reorder"),
    path("logos/<uuid:pk>/", views.AboutLogoDetailView.as_view(), name="site_logo_detail"),
    path("streets/", views.StreetListCreateView.as_view(), name="site_streets"),
    path("streets/<uuid:pk>/", views.StreetDetailView.as_view(), name="site_street_detail"),
]
