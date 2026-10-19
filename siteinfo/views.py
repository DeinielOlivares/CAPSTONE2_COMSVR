from django.db import transaction
from django.http import Http404
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import log_action
from accounts.views import IsAdmin

from .models import AboutLogo, BarangayProfile, CouncilMember, LegalDocument, Street
from .serializers import (
    AboutLogoSerializer,
    BarangayProfileSerializer,
    BoundarySerializer,
    BrandingSerializer,
    CouncilMemberSerializer,
    LegalDocumentSerializer,
    ReorderSerializer,
    StreetSerializer,
)

PROFILE_FIELD_LABELS = {
    "name": "name",
    "city": "city",
    "address": "address",
    "phone": "phone",
    "email": "email",
    "office_hours": "office hours",
    "emergency_hotline": "emergency hotline",
    "about_text": "What is OVRMS",
    "mission_text": "Our Mission",
    "footer_tagline": "footer tagline",
    "footer_notice": "footer notice",
    "footer_quick_links": "footer quick links",
    "footer_legal_links": "footer legal links",
}


class AboutPublicView(APIView):
    """
    GET /api/site/about/ — everything the citizen About Us page and site
    footer show: the barangay's details, the visible council members and the
    visible logos. Public (guests browse About Us too).
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({
            "profile": BarangayProfileSerializer(BarangayProfile.load()).data,
            "council": CouncilMemberSerializer(CouncilMember.objects.filter(is_visible=True), many=True).data,
            "logos": AboutLogoSerializer(AboutLogo.objects.filter(is_visible=True), many=True).data,
        })


class BarangayProfileView(APIView):
    """GET/PATCH /api/site/profile/ — Administrator edits the barangay's details."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(BarangayProfileSerializer(BarangayProfile.load()).data)

    def patch(self, request):
        profile = BarangayProfile.load()
        before = BarangayProfileSerializer(profile).data
        serializer = BarangayProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        changed = [label for field, label in PROFILE_FIELD_LABELS.items() if before[field] != serializer.data[field]]
        if changed:
            log_action(request.user, f"Updated About Us details: {', '.join(changed)}")
        return Response(serializer.data)



class BrandingPublicView(APIView):
    """
    GET /api/site/branding/ — the navbar/sidebar brand name + logo URL, for
    every portal's main.js/admin.js to apply on load. Public (even a guest
    on the citizen portal sees the brand).
    """

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(BrandingSerializer(BarangayProfile.load()).data)


class BrandingView(APIView):
    """GET/PATCH /api/site/branding/admin/ — Administrator edits the website's own brand."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(BrandingSerializer(BarangayProfile.load()).data)

    def patch(self, request):
        profile = BarangayProfile.load()
        serializer = BrandingSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        old_logo = profile.site_logo
        old_logo_name = old_logo.name if old_logo else None
        serializer.save()
        if old_logo_name and old_logo_name != profile.site_logo.name:
            profile.site_logo.storage.delete(old_logo_name)
        log_action(request.user, "Updated the website's brand name/logo")
        return Response(serializer.data)


class BoundaryView(APIView):
    """
    GET/PUT /api/site/boundary/ — the barangay outline drawn on the staff
    incident heatmap. Anyone can read it (it's a map outline, and the staff
    dashboard loads it); only an Administrator can replace it.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsAdmin()]

    def get(self, request):
        return Response({"boundary": BarangayProfile.load().boundary})

    def put(self, request):
        serializer = BoundarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = BarangayProfile.load()
        profile.boundary = serializer.validated_data["boundary"]
        profile.save(update_fields=["boundary", "updated_at"])
        if profile.boundary:
            log_action(request.user, f"Updated the barangay map boundary ({len(profile.boundary)} points)")
        else:
            log_action(request.user, "Removed the barangay map boundary")
        return Response({"boundary": profile.boundary})


class StreetListCreateView(generics.ListCreateAPIView):
    """
    GET /api/site/streets/ — every barangay street (name + lat/lng). Public:
    the Street combobox on Sign Up/File Report/My Profile needs it, and Sign
    Up/guest File Report have no session yet. The staff incident heatmap
    also reads it for each street's plot point.
    POST — adds a new one. Administrator only, from the Map Boundary page
    (click the map to place it, same interaction as the boundary outline).
    """

    queryset = Street.objects.all()
    serializer_class = StreetSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsAdmin()]

    def perform_create(self, serializer):
        street = serializer.save()
        log_action(self.request.user, f"Added street \"{street.name}\" to the map")


class StreetDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    PATCH/DELETE /api/site/streets/<id>/ — rename/reposition or remove a
    street. Administrator only. Report.location is free text (see
    reports.models.Report), so deleting one never touches past reports that
    cited it.
    """

    queryset = Street.objects.all()
    serializer_class = StreetSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        street = serializer.save()
        log_action(self.request.user, f"Updated street \"{street.name}\"")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed street \"{instance.name}\" from the map")
        instance.delete()


def _delete_file(field):
    """Best-effort removal of a replaced/deleted upload (never the seeded images)."""
    if field:
        try:
            field.delete(save=False)
        except Exception:
            pass


class CouncilMemberListCreateView(generics.ListCreateAPIView):
    """GET (hidden ones too) / POST /api/site/council/ — Administrator only."""

    queryset = CouncilMember.objects.all()
    serializer_class = CouncilMemberSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        group = serializer.validated_data.get("group", CouncilMember.Group.MEMBER)
        last = CouncilMember.objects.filter(group=group).order_by("-order").first()
        member = serializer.save(order=(last.order + 1) if last else 0)
        log_action(self.request.user, f"Added {member.name} ({member.position}) to About Us")


class CouncilMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/site/council/<id>/ — Administrator only."""

    queryset = CouncilMember.objects.all()
    serializer_class = CouncilMemberSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        old_photo = serializer.instance.photo if "photo" in serializer.validated_data else None
        old_file = old_photo.name if old_photo else None
        member = serializer.save()
        if old_file and old_file != member.photo.name:
            member.photo.storage.delete(old_file)
        log_action(self.request.user, f"Updated {member.name} ({member.position}) on About Us")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed {instance.name} ({instance.position}) from About Us")
        _delete_file(instance.photo)
        instance.delete()


class AboutLogoListCreateView(generics.ListCreateAPIView):
    """GET (hidden ones too) / POST /api/site/logos/ — Administrator only."""

    queryset = AboutLogo.objects.all()
    serializer_class = AboutLogoSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        last = AboutLogo.objects.order_by("-order").first()
        logo = serializer.save(order=(last.order + 1) if last else 0)
        log_action(self.request.user, f"Added logo \"{logo.alt_text}\" to About Us")


class AboutLogoDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /api/site/logos/<id>/ — Administrator only."""

    queryset = AboutLogo.objects.all()
    serializer_class = AboutLogoSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        old_image = serializer.instance.image if "image" in serializer.validated_data else None
        old_file = old_image.name if old_image else None
        logo = serializer.save()
        if old_file and old_file != logo.image.name:
            logo.image.storage.delete(old_file)
        log_action(self.request.user, f"Updated logo \"{logo.alt_text}\" on About Us")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed logo \"{instance.alt_text}\" from About Us")
        _delete_file(instance.image)
        instance.delete()


class _ReorderView(APIView):
    """POST {"ids": [...]} — sets `order` to each id's position in the list."""

    permission_classes = [IsAdmin]
    model = None
    label = ""

    def post(self, request):
        serializer = ReorderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        found = set(self.model.objects.filter(id__in=ids).values_list("id", flat=True))
        if len(found) != len(set(ids)):
            return Response({"detail": "Some items no longer exist. Refresh and try again."}, status=400)
        with transaction.atomic():
            for index, item_id in enumerate(ids):
                self.model.objects.filter(id=item_id).update(order=index)
        log_action(request.user, f"Reordered {self.label} on About Us")
        return Response({"detail": "Order saved."})


class CouncilMemberReorderView(_ReorderView):
    model = CouncilMember
    label = "council members"


class AboutLogoReorderView(_ReorderView):
    model = AboutLogo
    label = "logos"


class LegalDocumentView(APIView):
    """
    GET /api/site/legal/<key>/ — a citizen legal page's sections. Public.
    PUT /api/site/legal/<key>/admin/ — Administrator replaces the sections.
    """

    def get_permissions(self):
        if self.request.method == "GET":
            return [permissions.AllowAny()]
        return [IsAdmin()]

    def _document(self, key):
        if key not in LegalDocument.Key.values:
            raise Http404
        document, _ = LegalDocument.objects.get_or_create(key=key)
        return document

    def get(self, request, key):
        document = self._document(key)
        return Response({"key": key, "effective_date": document.effective_date, "sections": document.sections, "updated_at": document.updated_at})

    def put(self, request, key):
        document = self._document(key)
        serializer = LegalDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "sections" in data:
            document.sections = data["sections"]
        if "effective_date" in data:
            document.effective_date = data["effective_date"].strip()
        document.save(update_fields=["sections", "effective_date", "updated_at"])
        log_action(request.user, f"Updated the {document.get_key_display()} page")
        return Response({"key": key, "effective_date": document.effective_date, "sections": document.sections, "updated_at": document.updated_at})
