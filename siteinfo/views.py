"""
Site information — API views (URLs in siteinfo/urls.py, all under /api/site/).

Public (no login): about, branding, boundary, streets, legal pages.
Everything that changes content is Administrator-only.
"""

from django.db import transaction
from django.http import Http404
from rest_framework import generics, permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import log_action
from accounts.permissions import IsAdmin

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

# Field -> the words used in the audit log ("Updated About Us details: phone, email").
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


class AdminWriteMixin:
    """GET is open to everyone; every other method needs an Administrator."""

    def get_permissions(self):
        return [permissions.AllowAny()] if self.request.method == "GET" else [IsAdmin()]


def _delete_file(field):
    """Removes an uploaded file from storage (never the built-in images). Never raises."""
    if field:
        try:
            field.delete(save=False)
        except Exception:
            pass


def _delete_replaced_file(old_name, field):
    """After an edit: delete the old upload if a new one replaced it."""
    if old_name and old_name != field.name:
        field.storage.delete(old_name)


# ---- About Us and barangay details ------------------------------------------

class AboutPublicView(APIView):
    """GET /about/ — everything the About Us page and the site footer need."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response({
            "profile": BarangayProfileSerializer(BarangayProfile.load()).data,
            "council": CouncilMemberSerializer(CouncilMember.objects.filter(is_visible=True), many=True).data,
            "logos": AboutLogoSerializer(AboutLogo.objects.filter(is_visible=True), many=True).data,
        })


class BarangayProfileView(APIView):
    """GET/PATCH /profile/ — Administrator edits the barangay's details and footer."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(BarangayProfileSerializer(BarangayProfile.load()).data)

    def patch(self, request):
        profile = BarangayProfile.load()
        before = BarangayProfileSerializer(profile).data
        serializer = BarangayProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        after = BarangayProfileSerializer(profile).data
        changed = [label for field, label in PROFILE_FIELD_LABELS.items() if before[field] != after[field]]
        if changed:
            log_action(request.user, f"Updated About Us details: {', '.join(changed)}")
        return Response(after)


class BrandingPublicView(APIView):
    """GET /branding/ — the navbar/sidebar brand name and logo."""

    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(BrandingSerializer(BarangayProfile.load()).data)


class BrandingView(APIView):
    """GET/PATCH /branding/admin/ — Administrator changes the brand name/logo."""

    permission_classes = [IsAdmin]

    def get(self, request):
        return Response(BrandingSerializer(BarangayProfile.load()).data)

    def patch(self, request):
        profile = BarangayProfile.load()
        serializer = BrandingSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        old_logo_name = profile.site_logo.name if profile.site_logo else None
        serializer.save()
        _delete_replaced_file(old_logo_name, profile.site_logo)
        log_action(request.user, "Updated the website's brand name/logo")
        return Response(serializer.data)


# ---- Map: barangay outline and streets --------------------------------------

class BoundaryView(AdminWriteMixin, APIView):
    """GET/PUT /boundary/ — the barangay outline drawn on the maps."""

    def get(self, request):
        return Response({"boundary": BarangayProfile.load().boundary})

    def put(self, request):
        serializer = BoundarySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        profile = BarangayProfile.load()
        profile.set_boundary(serializer.validated_data["boundary"])
        profile.save(update_fields=["updated_at"])
        points = profile.boundary
        if points:
            log_action(request.user, f"Updated the barangay map boundary ({len(points)} points)")
        else:
            log_action(request.user, "Removed the barangay map boundary")
        return Response({"boundary": points})


class StreetListCreateView(AdminWriteMixin, generics.ListCreateAPIView):
    """GET /streets/ — all streets (Sign Up needs them before login).  POST — add one."""

    queryset = Street.objects.all()
    serializer_class = StreetSerializer

    def perform_create(self, serializer):
        street = serializer.save()
        log_action(self.request.user, f"Added street \"{street.name}\" to the map")


class StreetDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /streets/<id>/ — rename, move or remove a street (Administrator)."""

    queryset = Street.objects.all()
    serializer_class = StreetSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        street = serializer.save()
        log_action(self.request.user, f"Updated street \"{street.name}\"")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed street \"{instance.name}\" from the map")
        instance.delete()


# ---- Council members and logos (About Us) -----------------------------------

class CouncilMemberListCreateView(generics.ListCreateAPIView):
    """GET (hidden ones too) / POST /council/ — a new member goes to the end of their row."""

    queryset = CouncilMember.objects.all()
    serializer_class = CouncilMemberSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        group = serializer.validated_data.get("group", CouncilMember.Group.MEMBER)
        last = CouncilMember.objects.filter(group=group).order_by("-order").first()
        member = serializer.save(order=(last.order + 1) if last else 0)
        log_action(self.request.user, f"Added {member.name} ({member.position}) to About Us")


class CouncilMemberDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /council/<id>/"""

    queryset = CouncilMember.objects.all()
    serializer_class = CouncilMemberSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        old_photo = serializer.instance.photo if "photo" in serializer.validated_data else None
        old_name = old_photo.name if old_photo else None
        member = serializer.save()
        _delete_replaced_file(old_name, member.photo)
        log_action(self.request.user, f"Updated {member.name} ({member.position}) on About Us")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed {instance.name} ({instance.position}) from About Us")
        _delete_file(instance.photo)
        instance.delete()


class AboutLogoListCreateView(generics.ListCreateAPIView):
    """GET (hidden ones too) / POST /logos/ — a new logo goes last."""

    queryset = AboutLogo.objects.all()
    serializer_class = AboutLogoSerializer
    permission_classes = [IsAdmin]

    def perform_create(self, serializer):
        last = AboutLogo.objects.order_by("-order").first()
        logo = serializer.save(order=(last.order + 1) if last else 0)
        log_action(self.request.user, f"Added logo \"{logo.alt_text}\" to About Us")


class AboutLogoDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE /logos/<id>/"""

    queryset = AboutLogo.objects.all()
    serializer_class = AboutLogoSerializer
    permission_classes = [IsAdmin]

    def perform_update(self, serializer):
        old_image = serializer.instance.image if "image" in serializer.validated_data else None
        old_name = old_image.name if old_image else None
        logo = serializer.save()
        _delete_replaced_file(old_name, logo.image)
        log_action(self.request.user, f"Updated logo \"{logo.alt_text}\" on About Us")

    def perform_destroy(self, instance):
        log_action(self.request.user, f"Removed logo \"{instance.alt_text}\" from About Us")
        _delete_file(instance.image)
        instance.delete()


class _ReorderView(APIView):
    """POST {"ids": [...]} — each item's `order` becomes its position in the list."""

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
    """POST /council/reorder/"""

    model = CouncilMember
    label = "council members"


class AboutLogoReorderView(_ReorderView):
    """POST /logos/reorder/"""

    model = AboutLogo
    label = "logos"


# ---- Legal pages (Privacy Policy, Terms and Agreements) ---------------------

class LegalDocumentView(AdminWriteMixin, APIView):
    """
    GET /legal/<key>/        — the page's sections (anyone).
    PUT /legal/<key>/admin/  — replace them (Administrator).
    """

    def _document(self, key):
        if key not in LegalDocument.Key.values:
            raise Http404
        document, _ = LegalDocument.objects.get_or_create(key=key)
        return document

    @staticmethod
    def _response(document):
        return Response({
            "key": document.key,
            "effective_date": document.effective_date,
            "sections": document.section_list(),
            "updated_at": document.updated_at,
        })

    def get(self, request, key):
        return self._response(self._document(key))

    def put(self, request, key):
        document = self._document(key)
        serializer = LegalDocumentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "sections" in data:
            document.set_sections(data["sections"])
        if "effective_date" in data:
            document.effective_date = data["effective_date"].strip()
        document.save(update_fields=["effective_date", "updated_at"])
        log_action(request.user, f"Updated the {document.get_key_display()} page")
        return self._response(document)
