import re

from PIL import Image
from rest_framework import serializers

from .models import AboutLogo, BarangayProfile, CouncilMember, Street

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


def validate_image_upload(file):
    """ImageField already rejects non-images; this also caps size and format."""
    if file.size > MAX_IMAGE_BYTES:
        raise serializers.ValidationError("Image must be 5 MB or smaller.")
    try:
        file.seek(0)
        fmt = Image.open(file).format
    except Exception:
        raise serializers.ValidationError("Upload a valid JPG, PNG or WebP image.")
    finally:
        file.seek(0)
    if fmt not in ALLOWED_IMAGE_FORMATS:
        raise serializers.ValidationError("Upload a JPG, PNG or WebP image.")
    return file


def image_url(field, default_path):
    """An uploaded file's URL, else the seeded image under the frontend root."""
    if field:
        return field.url
    return f"/{default_path}" if default_path else ""


MAX_FOOTER_LINKS = 12

DEFAULT_FOOTER_LEGAL_LINKS = [
    {"label": "Privacy Policy", "url": "privacy-policy.html"},
    {"label": "Terms and Agreements", "url": "terms.html"},
    {"label": "Your Data Privacy Rights", "url": "privacy-policy.html#your-rights"},
]


def validate_footer_link_list(links):
    if len(links) > MAX_FOOTER_LINKS:
        raise serializers.ValidationError(f"A footer list can have at most {MAX_FOOTER_LINKS} links.")
    cleaned = []
    for item in links:
        if not isinstance(item, dict):
            raise serializers.ValidationError("Each footer link needs a label and a URL.")
        label = str(item.get("label", "")).strip()
        url = str(item.get("url", "")).strip()
        if not label or not url:
            raise serializers.ValidationError("Each footer link needs a label and a URL.")
        if len(label) > 60 or len(url) > 500:
            raise serializers.ValidationError("Footer link labels are limited to 60 characters and URLs to 500.")
        lowered = url.lower()
        allowed = lowered.startswith(("https://", "http://", "mailto:", "tel:")) or (
            ":" not in url and not url.startswith("//")
        )
        if not allowed:
            raise serializers.ValidationError(
                f"'{url}' isn't a valid link. Use a page name like faqs.html, or a full https:// address."
            )
        cleaned.append({"label": label, "url": url})
    return cleaned


class BarangayProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = BarangayProfile
        fields = [
            "name", "city", "address", "phone", "email", "office_hours",
            "emergency_hotline", "about_text", "mission_text",
            "footer_tagline", "footer_notice", "footer_quick_links", "footer_legal_links",
            "updated_at",
        ]
        read_only_fields = ["updated_at"]
        extra_kwargs = {"name": {"allow_blank": False}}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # An unsaved legal list shows the built-in links, so Admin edits those
        # directly rather than starting from an empty box.
        if not data["footer_legal_links"]:
            data["footer_legal_links"] = DEFAULT_FOOTER_LEGAL_LINKS
        return data

    def validate_footer_quick_links(self, value):
        return validate_footer_link_list(value)

    def validate_footer_legal_links(self, value):
        return validate_footer_link_list(value)


class BrandingSerializer(serializers.ModelSerializer):
    """
    GET: the website's own brand (navbar/sidebar logo + name, all 3 portals
    — see frontend/*/js/main.js and admin.js). PATCH (Admin only, Website
    Branding section of About Us Setup): site_logo is multipart; omit it to
    keep the current logo.
    """

    site_logo = serializers.ImageField(write_only=True, required=False)
    site_logo_url = serializers.SerializerMethodField()

    class Meta:
        model = BarangayProfile
        fields = ["site_name", "site_logo", "site_logo_url", "updated_at"]
        read_only_fields = ["updated_at"]
        extra_kwargs = {"site_name": {"allow_blank": False}}

    def get_site_logo_url(self, obj):
        return obj.site_logo.url if obj.site_logo else ""

    def validate_site_logo(self, file):
        return validate_image_upload(file)


MAX_BOUNDARY_POINTS = 2000


class BoundarySerializer(serializers.Serializer):
    """
    The barangay outline: a list of [lat, lng] points. Anything from 3 to
    MAX_BOUNDARY_POINTS points, or an empty list to remove the outline.
    Points must fall roughly around Biñan, Laguna, which catches a file
    uploaded with its [lng, lat] order the wrong way round.
    """

    boundary = serializers.ListField(
        child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
        max_length=MAX_BOUNDARY_POINTS,
        allow_empty=True,
    )

    def validate_boundary(self, points):
        if points and len(points) < 3:
            raise serializers.ValidationError("An outline needs at least 3 points.")
        for lat, lng in points:
            if not (13.5 <= lat <= 15.0 and 120.5 <= lng <= 121.7):
                raise serializers.ValidationError(
                    f"Point ({lat}, {lng}) is nowhere near Biñan, Laguna. Check the file's coordinates."
                )
        # A closing point equal to the first is redundant; drop it.
        if len(points) > 3 and points[0] == points[-1]:
            points = points[:-1]
        return [[round(lat, 6), round(lng, 6)] for lat, lng in points]


class StreetSerializer(serializers.ModelSerializer):
    """
    name + a single [lat, lng] point, placed by an Administrator clicking
    the Map Boundary page's map. Same Biñan bounds check as the boundary
    outline above, for the same reason (catches an obviously wrong point).
    """

    class Meta:
        model = Street
        fields = ["id", "name", "latitude", "longitude"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Street name is required.")
        return value

    def validate(self, attrs):
        lat = attrs.get("latitude", getattr(self.instance, "latitude", None))
        lng = attrs.get("longitude", getattr(self.instance, "longitude", None))
        if lat is not None and lng is not None and not (13.5 <= lat <= 15.0 and 120.5 <= lng <= 121.7):
            raise serializers.ValidationError("That point is nowhere near Biñan, Laguna.")
        return attrs


class CouncilMemberSerializer(serializers.ModelSerializer):
    photo = serializers.ImageField(write_only=True, required=False)
    photoUrl = serializers.SerializerMethodField()
    # The seeded portraits (frontend/citizen/drawables/) have their green ring
    # drawn into the image; uploads don't, so the page adds one for them.
    hasCustomPhoto = serializers.SerializerMethodField()
    # Explicit default: in a multipart upload DRF otherwise reads a missing
    # checkbox as False, silently creating the member hidden.
    is_visible = serializers.BooleanField(required=False, default=True)
    group_display = serializers.CharField(source="get_group_display", read_only=True)

    class Meta:
        model = CouncilMember
        fields = [
            "id", "name", "position", "group", "group_display", "photo", "photoUrl",
            "hasCustomPhoto", "order", "is_visible",
        ]
        read_only_fields = ["id", "order"]

    def get_photoUrl(self, obj):
        return image_url(obj.photo, obj.default_photo)

    def get_hasCustomPhoto(self, obj):
        return bool(obj.photo)

    def validate_photo(self, file):
        return validate_image_upload(file)


class AboutLogoSerializer(serializers.ModelSerializer):
    image = serializers.ImageField(write_only=True, required=False)
    imageUrl = serializers.SerializerMethodField()
    is_visible = serializers.BooleanField(required=False, default=True)  # see CouncilMemberSerializer

    class Meta:
        model = AboutLogo
        fields = ["id", "image", "imageUrl", "alt_text", "order", "is_visible"]
        read_only_fields = ["id", "order"]

    def get_imageUrl(self, obj):
        return image_url(obj.image, obj.default_image)

    def validate_image(self, file):
        return validate_image_upload(file)

    def validate(self, attrs):
        # A new logo needs a picture; an edit can change just the alt text.
        if self.instance is None and not attrs.get("image"):
            raise serializers.ValidationError({"image": "Choose an image for this logo."})
        return attrs


class ReorderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=False)


MAX_LEGAL_SECTIONS = 40
MAX_LEGAL_SECTION_CHARS = 8000


class LegalDocumentSerializer(serializers.Serializer):
    effective_date = serializers.CharField(max_length=60, required=False, allow_blank=True)
    sections = serializers.ListField(child=serializers.DictField(), max_length=MAX_LEGAL_SECTIONS, required=False)

    def validate_sections(self, sections):
        cleaned = []
        for section in sections:
            heading = str(section.get("heading", "")).strip()
            body = str(section.get("body", "")).strip()
            anchor = str(section.get("anchor", "") or "").strip()
            if len(heading) > 200:
                raise serializers.ValidationError("Section headings are limited to 200 characters.")
            if len(body) > MAX_LEGAL_SECTION_CHARS:
                raise serializers.ValidationError(
                    f"A section can have at most {MAX_LEGAL_SECTION_CHARS} characters of text."
                )
            if anchor and not re.fullmatch(r"[a-z0-9-]{1,60}", anchor):
                raise serializers.ValidationError("Section anchors may only use lowercase letters, numbers and dashes.")
            cleaned.append({"anchor": anchor, "heading": heading, "body": body})
        return cleaned
