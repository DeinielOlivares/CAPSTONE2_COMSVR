from django.urls import path

from . import views

urlpatterns = [
    path("", views.AnnouncementListView.as_view(), name="announcement_list"),
    path("<uuid:pk>/view/", views.AnnouncementMarkViewedView.as_view(), name="announcement_mark_viewed"),
    path("staff/", views.StaffAnnouncementListCreateView.as_view(), name="staff_announcement_list_create"),
    path("staff/<uuid:pk>/", views.StaffAnnouncementDetailView.as_view(), name="staff_announcement_detail"),
]
