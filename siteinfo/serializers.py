import re

from rest_framework import serializers

from orms_backend import validators

from .models import AboutLogo, BarangayProfile, CouncilMember, FooterLink, Street

MAX_IMAGE_BYTES = validators.MAX_IMAGE_BYTES


def validate_image_upload(file):
    """JPG/PNG/WebP up to MAX_IMAGE_BYTES (read at call time, so tests can lower it)."""
    return validators.validate_image_upload(file, max_bytes=MAX_IMAGE_BYTES)


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
    """
    The barangay's details and footer text. The two footer link lists are
    stored as FooterLink rows but sent and received as lists of
    {"label": ..., "url": ...}.
    """

    footer_quick_links = serializers.JSONField(required=False, write_only=True)
    footer_legal_links = serializers.JSONField(required=False, write_only=True)

    LINK_FIELDS = {"footer_quick_links": FooterLink.Kind.QUICK, "footer_legal_links": FooterLink.Kind.LEGAL}

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
        for field, kind in self.LINK_FIELDS.items():
            data[field] = instance.footer_links(kind)
        # No saved legal links yet: show the built-in ones, so the Administrator
        # edits those instead of starting from an empty list.
        if not data["footer_legal_links"]:
            data["footer_legal_links"] = DEFAULT_FOOTER_LEGAL_LINKS
        return data

    def validate_footer_quick_links(self, value):
        return validate_footer_link_list(value)

    def validate_footer_legal_links(self, value):
        return validate_footer_link_list(value)

    def update(self, instance, validated_data):
        links = {field: validated_data.pop(field) for field in self.LINK_FIELDS if field in validated_data}
        instance = super().update(instance, validated_data)
        for field, value in links.items():
            instance.set_footer_links(self.LINK_FIELDS[field], value)
        return instance


class BrandingSerializer(serializers.ModelSerializer):
    """The website's brand: name and logo shown in every portal's navbar/sidebar."""

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
    The barangay outline: 3 to MAX_BOUNDARY_POINTS [lat, lng] points, or an
    empty list to remove it. Every point must be near Biñan, Laguna (this also
    catches files with latitude and longitude swapped).
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
    """A street name and its point on the map (must be near Biñan, Laguna)."""

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
    # Uploaded photos get a green ring added by the page (built-in ones already have it).
    hasCustomPhoto = serializers.SerializerMethodField()
    # Default True: in a multipart upload a missing checkbox would otherwise mean False.
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
