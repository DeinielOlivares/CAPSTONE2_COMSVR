"""Ordinance endpoints. Every path here starts with /api/."""

from django.urls import path

from . import views

urlpatterns = [
    path("ordinances/", views.OrdinanceListCreateView.as_view(), name="ordinance_list_create"),
    path("ordinances/categories/", views.OrdinanceCategoryListCreateView.as_view(), name="ordinance_category_list_create"),
    path("ordinances/categories/<uuid:pk>/", views.OrdinanceCategoryDetailView.as_view(), name="ordinance_category_detail"),
    path("ordinances/authors/", views.OrdinanceAuthorListCreateView.as_view(), name="ordinance_author_list_create"),
    path("ordinances/authors/<uuid:pk>/", views.OrdinanceAuthorDetailView.as_view(), name="ordinance_author_detail"),
    path("ordinances/suggest/", views.OrdinanceSuggestView.as_view(), name="ordinance_suggest"),
    path("ordinances/<uuid:pk>/", views.OrdinanceDetailView.as_view(), name="ordinance_detail"),
    path("ordinances/<uuid:pk>/archive/", views.OrdinanceArchiveView.as_view(), name="ordinance_archive"),
    path("ordinances/<uuid:pk>/unarchive/", views.OrdinanceUnarchiveView.as_view(), name="ordinance_unarchive"),
    path("ordinances/<uuid:pk>/download/", views.OrdinanceDownloadView.as_view(), name="ordinance_download"),
    path("ordinances/<uuid:pk>/view/", views.OrdinanceMarkViewedView.as_view(), name="ordinance_mark_viewed"),
]
