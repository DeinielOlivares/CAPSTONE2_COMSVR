"""
Site information — content an Administrator edits without changing code.

    BarangayProfile  the single row of barangay details, website branding and footer text
    FooterLink       one link in the site footer (Quick Links or Legal list)
    BoundaryPoint    one corner of the barangay outline drawn on the maps
    Street           a barangay street (address lists + its point on the map)
    CouncilMember    a person shown in About Us' "Sangguniang Barangay"
    AboutLogo        a seal shown in About Us' logo strip
    LegalDocument    the Privacy Policy or the Terms and Agreements page
    LegalSection     one section (heading + text) of a legal page
"""

import uuid

from django.db import models, transaction


class BarangayProfile(models.Model):
    """
    Always exactly one row (pk=1) — use BarangayProfile.load().
    Shown on About Us, in the site footer, and as the navbar brand on every portal.
    """

    name = models.CharField(max_length=100, default="Barangay Platero")
    # The website's brand, written "Name | Kind of system" (the part after the
    # bar is shown on a smaller second line).
    site_name = models.CharField(
        max_length=120, default="Barangay Platero | Ordinance Violation Reporting and Monitoring System"
    )
    site_logo = models.ImageField(upload_to="site/", blank=True)
    city = models.CharField(max_length=100, default="City of Biñan, Laguna")
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    office_hours = models.CharField(max_length=120, blank=True)
    emergency_hotline = models.CharField(max_length=50, default="911")
    about_text = models.TextField(blank=True)    # About Us: "What is OVRMS"
    mission_text = models.TextField(blank=True)  # About Us: "Our Mission"
    footer_tagline = models.CharField(max_length=255, default="Ordinance Violation Reporting and Monitoring System")
    footer_notice = models.CharField(
        max_length=255, default="Personal data is processed under the Data Privacy Act of 2012 (Republic Act No. 10173)."
    )
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        profile, _ = cls.objects.get_or_create(pk=1)
        return profile

    def __str__(self):
        return self.name

    # ---- Barangay outline: [[lat, lng], ...] (one closed ring) ----

    @property
    def boundary(self):
        return [[p.latitude, p.longitude] for p in self.boundary_points.all()]

    def set_boundary(self, points):
        with transaction.atomic():
            self.boundary_points.all().delete()
            BoundaryPoint.objects.bulk_create(
                BoundaryPoint(profile=self, order=i, latitude=lat, longitude=lng) for i, (lat, lng) in enumerate(points)
            )

    # ---- Footer links: [{"label": ..., "url": ...}, ...] ----

    def footer_links(self, kind):
        return [{"label": link.label, "url": link.url} for link in self.links.filter(kind=kind)]

    def set_footer_links(self, kind, links):
        with transaction.atomic():
            self.links.filter(kind=kind).delete()
            FooterLink.objects.bulk_create(
                FooterLink(profile=self, kind=kind, order=i, label=link["label"], url=link["url"])
                for i, link in enumerate(links)
            )


class FooterLink(models.Model):
    """One footer link. No rows of a kind = the footer shows its built-in links."""

    class Kind(models.TextChoices):
        QUICK = "quick", "Quick link"
        LEGAL = "legal", "Legal link"

    profile = models.ForeignKey(BarangayProfile, on_delete=models.CASCADE, related_name="links")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    order = models.PositiveIntegerField(default=0)
    label = models.CharField(max_length=60)
    url = models.CharField(max_length=500)

    class Meta:
        ordering = ["kind", "order"]

    def __str__(self):
        return self.label


class BoundaryPoint(models.Model):
    """One corner of the barangay outline (drawn or uploaded on Admin > Map Boundary)."""

    profile = models.ForeignKey(BarangayProfile, on_delete=models.CASCADE, related_name="boundary_points")
    order = models.PositiveIntegerField()
    latitude = models.FloatField()
    longitude = models.FloatField()

    class Meta:
        ordering = ["order"]


class Street(models.Model):
    """
    A barangay street: the choices in the Street fields (Sign Up, File a
    Report, My Profile) and the point where its reports are drawn on the
    heatmap. Reports keep their location as text, so deleting a street never
    changes old reports.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150, unique=True)
    latitude = models.FloatField()
    longitude = models.FloatField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class CouncilMember(models.Model):
    """A person in About Us' "Sangguniang Barangay" section. `group` = row, `order` = position in the row."""

    class Group(models.TextChoices):
        CHAIRMAN = "chairman", "Punong Barangay (top row)"
        MEMBER = "member", "Sangguniang Barangay member"
        OFFICER = "officer", "Appointed officer (Secretary, Treasurer)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    position = models.CharField(max_length=255)  # e.g. "Committee Chairman on Education"
    group = models.CharField(max_length=10, choices=Group.choices, default=Group.MEMBER)
    photo = models.ImageField(upload_to="about/council/%Y/", blank=True)
    # Built-in portrait under frontend/ (e.g. citizen/drawables/...), used until a photo is uploaded.
    default_photo = models.CharField(max_length=255, blank=True)
    order = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "name"]

    def __str__(self):
        return f"{self.name} — {self.position}"


class AboutLogo(models.Model):
    """A seal in About Us' logo strip (barangay, city, current administration)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    image = models.ImageField(upload_to="about/logos/", blank=True)
    default_image = models.CharField(max_length=255, blank=True)
    alt_text = models.CharField(max_length=150)
    order = models.PositiveIntegerField(default=0)
    is_visible = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "created_at"]

    def __str__(self):
        return self.alt_text


class LegalDocument(models.Model):
    """The Privacy Policy or the Terms and Agreements page (rendered by citizen/js/legal.js)."""

    class Key(models.TextChoices):
        PRIVACY = "privacy", "Privacy Policy"
        TERMS = "terms", "Terms and Agreements"

    key = models.CharField(max_length=20, choices=Key.choices, unique=True)
    effective_date = models.CharField(max_length=60, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.get_key_display()

    def section_list(self):
        return [{"anchor": s.anchor, "heading": s.heading, "body": s.body} for s in self.sections.all()]

    def set_sections(self, sections):
        with transaction.atomic():
            self.sections.all().delete()
            LegalSection.objects.bulk_create(
                LegalSection(document=self, order=i, anchor=s["anchor"], heading=s["heading"], body=s["body"])
                for i, s in enumerate(sections)
            )


class LegalSection(models.Model):
    """
    One section of a legal page. `body` is plain text where blocks are separated
    by a blank line: "- " starts a bullet, "1. " a numbered item, "| a | b |" a
    table row; **bold**, [text](url) and {{address}}/{{email}}/{{phone}}/{{name}}
    are filled in by the page.
    """

    document = models.ForeignKey(LegalDocument, on_delete=models.CASCADE, related_name="sections")
    order = models.PositiveIntegerField()
    anchor = models.CharField(max_length=60, blank=True)  # the #link target, e.g. "your-rights"
    heading = models.CharField(max_length=200, blank=True)
    body = models.TextField(blank=True)

    class Meta:
        ordering = ["order"]
