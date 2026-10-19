"""
Ordinances — API views (URLs in ordinances/urls.py, all under /api/ordinances/).

Citizens and guests only ever see published (not archived) ordinances.
Staff and Administrators see all of them.
"""

from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User, log_action
from accounts.permissions import IsAdmin, IsDocumentManager

from .matching import suggest_ordinances
from .models import Ordinance, OrdinanceAuthor, OrdinanceCategory, OrdinanceDownload, OrdinanceView
from .serializers import (
    OrdinanceAuthorSerializer,
    OrdinanceCategorySerializer,
    OrdinanceCreateSerializer,
    OrdinanceSerializer,
    OrdinanceUpdateSerializer,
)


def _is_staff_or_admin(user):
    return bool(user and user.is_authenticated and user.role in (User.Role.STAFF, User.Role.ADMIN))


def _visible_ordinances(user):
    return Ordinance.objects.all() if _is_staff_or_admin(user) else Ordinance.objects.published()


def _label(ordinance):
    """e.g. "ordinance No. 1-(2026) — Title", for audit log lines."""
    return f"ordinance {ordinance.number} — {ordinance.title}"


def _ordinance_response(ordinance, request, **kwargs):
    return Response(OrdinanceSerializer(ordinance, context={"request": request}).data, **kwargs)


# ---- Ordinances ------------------------------------------------------------

class OrdinanceListCreateView(generics.ListCreateAPIView):
    """
    GET  /ordinances/ — anyone (no login needed).
    POST /ordinances/ — upload a new ordinance (Secretary/Administrator).
    """

    def get_queryset(self):
        return _visible_ordinances(self.request.user)

    def get_permissions(self):
        return [IsDocumentManager()] if self.request.method == "POST" else [permissions.AllowAny()]

    def get_serializer_class(self):
        return OrdinanceCreateSerializer if self.request.method == "POST" else OrdinanceSerializer

    def get_serializer_context(self):
        context = {"request": self.request}
        user = self.request.user
        if user and user.is_authenticated and user.role == User.Role.CITIZEN:
            # Loaded once here instead of one query per ordinance.
            context["viewed_ordinance_ids"] = set(
                OrdinanceView.objects.filter(citizen=user).values_list("ordinance_id", flat=True)
            )
        return context

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ordinance = serializer.save(uploaded_by=request.user)
        log_action(request.user, f"Uploaded {_label(ordinance)}")
        return _ordinance_response(ordinance, request, status=status.HTTP_201_CREATED)


class OrdinanceDetailView(generics.RetrieveUpdateAPIView):
    """
    GET   /ordinances/<id>/ — one ordinance (archived ones: staff only).
    PATCH /ordinances/<id>/ — edit it, optionally with a new PDF (Secretary/Administrator).
    """

    def get_queryset(self):
        return _visible_ordinances(self.request.user)

    def get_permissions(self):
        return [IsDocumentManager()] if self.request.method in ("PATCH", "PUT") else [permissions.AllowAny()]

    def get_serializer_class(self):
        return OrdinanceUpdateSerializer if self.request.method in ("PATCH", "PUT") else OrdinanceSerializer

    def update(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_object(), data=request.data, partial=kwargs.pop("partial", True))
        serializer.is_valid(raise_exception=True)
        ordinance = serializer.save()
        # An edited ordinance counts as unread again for every citizen.
        OrdinanceView.objects.filter(ordinance=ordinance).delete()
        log_action(request.user, f"Updated {_label(ordinance)}")
        return _ordinance_response(ordinance, request)


class OrdinanceSuggestView(APIView):
    """GET /ordinances/suggest/?q=<text> — best-matching ordinances for File a Report."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 3:
            return Response({"results": []})
        matches = suggest_ordinances(query, Ordinance.objects.published())
        return Response({
            "results": [
                {"id": str(o.id), "number": o.number, "title": o.title, "score": round(score, 4)}
                for o, score in matches
            ]
        })


class _SetArchivedView(APIView):
    """POST — archive (hide from citizens) or unarchive an ordinance."""

    permission_classes = [IsDocumentManager]
    archived = True
    verb = ""

    def post(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        ordinance.is_archived = self.archived
        ordinance.save(update_fields=["is_archived"])
        log_action(request.user, f"{self.verb} {_label(ordinance)}")
        return _ordinance_response(ordinance, request)


class OrdinanceArchiveView(_SetArchivedView):
    """POST /ordinances/<id>/archive/"""

    archived = True
    verb = "Archived"


class OrdinanceUnarchiveView(_SetArchivedView):
    """POST /ordinances/<id>/unarchive/"""

    archived = False
    verb = "Unarchived"


class OrdinanceMarkViewedView(APIView):
    """POST /ordinances/<id>/view/ — a citizen opened it (does nothing for staff)."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        if request.user.role == User.Role.CITIZEN:
            OrdinanceView.objects.get_or_create(ordinance=ordinance, citizen=request.user)
        return Response({"detail": "Marked as viewed."})


class OrdinanceDownloadView(APIView):
    """
    GET /ordinances/<id>/download/ — returns the PDF link and logs the download.
    A citizen may download each ordinance only once; staff have no limit.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        if not ordinance.pdf_file:
            return Response({"detail": "This ordinance has no PDF on file."}, status=status.HTTP_404_NOT_FOUND)

        user = request.user
        if user.role == User.Role.CITIZEN:
            _, created = OrdinanceDownload.objects.get_or_create(ordinance=ordinance, citizen=user)
            if not created:
                return Response(
                    {"detail": "You've already downloaded this ordinance. Each document can only be downloaded once."},
                    status=status.HTTP_403_FORBIDDEN,
                )

        log_action(user, f"Downloaded {_label(ordinance)}")
        return Response({"pdf_url": request.build_absolute_uri(ordinance.pdf_file.url)})


# ---- Category list and author list (managed by an Administrator) -----------

class _ManagedListView(generics.ListCreateAPIView):
    """
    GET  — the active entries (Secretary/Administrator).
           An Administrator can add ?include_inactive=1 to see retired ones too.
    POST — add an entry (Administrator).
    """

    model = None

    def get_queryset(self):
        queryset = self.model.objects.all()
        include_inactive = self.request.query_params.get("include_inactive") == "1"
        if not (include_inactive and self.request.user.role == User.Role.ADMIN):
            queryset = queryset.filter(is_active=True)
        return queryset

    def get_permissions(self):
        return [IsAdmin()] if self.request.method == "POST" else [IsDocumentManager()]


class OrdinanceCategoryListCreateView(_ManagedListView):
    """GET/POST /ordinances/categories/"""

    model = OrdinanceCategory
    serializer_class = OrdinanceCategorySerializer

    def perform_create(self, serializer):
        category = serializer.save()
        log_action(self.request.user, f"Added ordinance category {category.name}")


class OrdinanceCategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (rename / retire) and DELETE /ordinances/categories/<id>/ — Administrator."""

    queryset = OrdinanceCategory.objects.all()
    serializer_class = OrdinanceCategorySerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        category = serializer.save()
        log_action(self.request.user, f"Updated ordinance category {category.name}")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed ordinance category {instance.name}")
        instance.delete()


class OrdinanceAuthorListCreateView(_ManagedListView):
    """GET/POST /ordinances/authors/"""

    model = OrdinanceAuthor
    serializer_class = OrdinanceAuthorSerializer

    def perform_create(self, serializer):
        author = serializer.save()
        log_action(self.request.user, f"Added ordinance author {author.name} ({author.get_position_display()})")


class OrdinanceAuthorDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH (edit / end term) and DELETE /ordinances/authors/<id>/ — Administrator."""

    queryset = OrdinanceAuthor.objects.all()
    serializer_class = OrdinanceAuthorSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        author = serializer.save()
        log_action(self.request.user, f"Updated ordinance author {author.name} ({author.get_position_display()})")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed ordinance author {instance.name} ({instance.get_position_display()})")
        instance.delete()
