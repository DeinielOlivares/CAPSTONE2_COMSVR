from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User, log_action
from accounts.views import IsAdmin, IsDocumentManager

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


def _label(doc):
    """"ordinance No. 1-(2026) — Title" for audit log lines."""
    return f"ordinance {doc.number} — {doc.title}"


class OrdinanceListCreateView(generics.ListCreateAPIView):
    """
    GET /api/ordinances/ — citizens/guests only see non-archived ordinances
    (browsable without an account, same as the old hardcoded placeholder
    list); Staff/Admin see every ordinance, archived included, so Secretary
    can find one again to unarchive it.
    POST /api/ordinances/ — upload a new ordinance (Secretary); Administrators
    can file one too. Everyone else only gets a read-only view.
    """

    def get_queryset(self):
        queryset = Ordinance.objects.all()
        if not _is_staff_or_admin(self.request.user):
            queryset = queryset.published()
        return queryset

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsDocumentManager()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        return OrdinanceCreateSerializer if self.request.method == "POST" else OrdinanceSerializer

    def get_serializer_context(self):
        context = {"request": self.request}
        user = self.request.user
        if user and user.is_authenticated and user.role == User.Role.CITIZEN:
            context["viewed_ordinance_ids"] = set(
                OrdinanceView.objects.filter(citizen=user).values_list("ordinance_id", flat=True)
            )
        return context

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ordinance = serializer.save(uploaded_by=request.user)
        log_action(request.user, f"Uploaded {_label(ordinance)}")
        return Response(
            OrdinanceSerializer(ordinance, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class OrdinanceDetailView(generics.RetrieveUpdateAPIView):
    """
    GET /api/ordinances/<id>/ — one ordinance; 404s for citizens/guests if
    it's archived (same visibility rule as the list).
    PATCH /api/ordinances/<id>/ — edit it, optionally replacing the PDF.
    Secretary or Administrator only.
    """

    def get_queryset(self):
        if _is_staff_or_admin(self.request.user):
            return Ordinance.objects.all()
        return Ordinance.objects.published()

    def get_permissions(self):
        if self.request.method in ("PATCH", "PUT"):
            return [IsDocumentManager()]
        return [permissions.AllowAny()]

    def get_serializer_class(self):
        return OrdinanceUpdateSerializer if self.request.method in ("PATCH", "PUT") else OrdinanceSerializer

    def get_serializer_context(self):
        return {"request": self.request}

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", True)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        ordinance = serializer.save()
        # An edit makes it unread again for every citizen, so it resurfaces on
        # the home page's Latest Ordinances (see OrdinanceSerializer.get_in_latest).
        OrdinanceView.objects.filter(ordinance=ordinance).delete()
        log_action(request.user, f"Updated {_label(ordinance)}")
        return Response(OrdinanceSerializer(ordinance, context={"request": request}).data)


class OrdinanceCategoryListCreateView(generics.ListCreateAPIView):
    """
    GET /api/ordinances/categories/ — the category list, for Upload/Edit
    Ordinance's Category dropdown (Secretary/Admin) and the Admin Portal's
    Ordinance Setup page (Admin only, via ?include_inactive=1 — same
    active-only-unless-you're-an-Admin rule as OrdinanceAuthorListCreateView,
    for the same reason: a new upload shouldn't be assignable to a retired
    category). POST — Administrator adds a new one. Unlike the author roster,
    this list *is* enforced on upload/edit — see OrdinanceCategory's docstring.
    """

    serializer_class = OrdinanceCategorySerializer

    def get_queryset(self):
        queryset = OrdinanceCategory.objects.all()
        include_inactive = self.request.query_params.get("include_inactive") == "1"
        if not (include_inactive and self.request.user.role == User.Role.ADMIN):
            queryset = queryset.filter(is_active=True)
        return queryset

    def get_permissions(self):
        return [IsAdmin()] if self.request.method == "POST" else [IsDocumentManager()]

    def perform_create(self, serializer):
        category = serializer.save()
        log_action(self.request.user, f"Added ordinance category {category.name}")


class OrdinanceCategoryDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    PATCH /api/ordinances/categories/<id>/ — rename a category or toggle
    is_active when it's retired (kept, not deleted, by default — see the
    model). DELETE — only for removing one added by mistake; existing
    ordinances keep their category's name regardless (see Ordinance.category's
    docstring), so this can't corrupt them. Administrator only.
    """

    queryset = OrdinanceCategory.objects.all()
    serializer_class = OrdinanceCategorySerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        category = serializer.save()
        log_action(self.request.user, f"Updated ordinance category {category.name}")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed ordinance category {instance.name}")
        instance.delete()


class OrdinanceAuthorListCreateView(generics.ListCreateAPIView):
    """
    GET /api/ordinances/authors/ — the author roster, for Upload/Edit
    Ordinance's Author autocomplete suggestions (Secretary/Admin) and the
    Admin Portal's Ordinance Setup page (Admin only, via ?include_inactive=1 —
    Secretary never needs a term-ended official suggested for a new upload,
    so that param is silently ignored for anyone who isn't an Administrator).
    POST — Administrator adds a new author. Amending the roster (who counts
    as a Kagawad/Barangay Captain and how many seats there are) is an
    Admin-only act — see accounts.views.IsAdmin and OrdinanceAuthor's
    docstring for the full scope (Sangguniang Barangay seats only).
    """

    serializer_class = OrdinanceAuthorSerializer

    def get_queryset(self):
        queryset = OrdinanceAuthor.objects.all()
        include_inactive = self.request.query_params.get("include_inactive") == "1"
        if not (include_inactive and self.request.user.role == User.Role.ADMIN):
            queryset = queryset.filter(is_active=True)
        return queryset

    def get_permissions(self):
        return [IsAdmin()] if self.request.method == "POST" else [IsDocumentManager()]

    def perform_create(self, serializer):
        author = serializer.save()
        log_action(self.request.user, f"Added ordinance author {author.name} ({author.get_position_display()})")


class OrdinanceAuthorDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    PATCH /api/ordinances/authors/<id>/ — edit a roster entry's name/position,
    or toggle is_active when a term ends (kept rather than deleted, so past
    ordinances' "who was on the roster" history survives — see the model).
    DELETE — only for removing an entry added by mistake; existing ordinances
    keep their author's name regardless (see Ordinance.author's docstring),
    so this can't corrupt them. Administrator only.
    """

    queryset = OrdinanceAuthor.objects.all()
    serializer_class = OrdinanceAuthorSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        author = serializer.save()
        log_action(self.request.user, f"Updated ordinance author {author.name} ({author.get_position_display()})")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed ordinance author {instance.name} ({instance.get_position_display()})")
        instance.delete()


class OrdinanceSuggestView(APIView):
    """
    GET /api/ordinances/suggest/?q=<text> — ranks non-archived ordinances by
    relevance to the citizen-typed violation text, for the File a Report
    form's suggestion panel. Public, and always excludes archived
    ordinances regardless of caller — this endpoint has exactly one
    consumer (the citizen form), unlike OrdinanceListCreateView which also
    serves Staff/Admin.
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        query = request.query_params.get("q", "").strip()
        if len(query) < 3:
            return Response({"results": []})

        ordinances = Ordinance.objects.published()
        matches = suggest_ordinances(query, ordinances)
        return Response({
            "results": [
                {"id": str(o.id), "number": o.number, "title": o.title, "score": round(score, 4)}
                for o, score in matches
            ]
        })


class OrdinanceArchiveView(APIView):
    """
    POST /api/ordinances/<id>/archive/ — hides an ordinance from the Citizen
    portal without deleting it (see get_queryset filters above). Staff/Admin
    can still see and unarchive it. Secretary or Administrator only.
    """

    permission_classes = [IsDocumentManager]

    def post(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        ordinance.is_archived = True
        ordinance.save(update_fields=["is_archived"])
        log_action(request.user, f"Archived {_label(ordinance)}")
        return Response(OrdinanceSerializer(ordinance, context={"request": request}).data)


class OrdinanceUnarchiveView(APIView):
    """POST /api/ordinances/<id>/unarchive/ — restores an archived ordinance (Secretary or Administrator only)."""

    permission_classes = [IsDocumentManager]

    def post(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        ordinance.is_archived = False
        ordinance.save(update_fields=["is_archived"])
        log_action(request.user, f"Unarchived {_label(ordinance)}")
        return Response(OrdinanceSerializer(ordinance, context={"request": request}).data)


class OrdinanceMarkViewedView(APIView):
    """
    POST /api/ordinances/<id>/view/ — removes this ordinance from the
    citizen home page's "Latest Ordinances" (unread) section for this
    citizen. Called from the ordinance detail page on load. No-ops (but
    still 200s) for Staff/Admin/guests, who have no "unread" state here.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        if request.user.role == User.Role.CITIZEN:
            OrdinanceView.objects.get_or_create(ordinance=ordinance, citizen=request.user)
        return Response({"detail": "Marked as viewed."})


class OrdinanceDownloadView(APIView):
    """
    GET /api/ordinances/<id>/download/ — hands back the real PDF URL rather
    than a plain <a href> straight to storage, so the download can actually
    be gated and logged. A citizen gets exactly one download per ordinance
    (OrdinanceDownload's unique_together); Staff/Admin aren't limited — the
    cap is specifically to stop a citizen's link from being reshared/scraped
    indefinitely, not to restrict staff doing their job. Every successful
    download (citizen or staff) is written to the audit log either way.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, pk):
        ordinance = get_object_or_404(Ordinance, pk=pk)
        if not ordinance.pdf_file:
            return Response(
                {"detail": "This ordinance has no PDF on file."},
                status=status.HTTP_404_NOT_FOUND,
            )

        user = request.user
        is_citizen = user.role == User.Role.CITIZEN

        if is_citizen:
            _, created = OrdinanceDownload.objects.get_or_create(ordinance=ordinance, citizen=user)
            if not created:
                return Response(
                    {
                        "detail": (
                            "You've already downloaded this ordinance. "
                            "Each document can only be downloaded once."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        log_action(user, f"Downloaded {_label(ordinance)}")

        url = ordinance.pdf_file.url
        return Response({"pdf_url": request.build_absolute_uri(url)})
