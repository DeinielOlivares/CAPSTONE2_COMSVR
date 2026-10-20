import uuid

from django.db import models


class BarangayProfile(models.Model):
    """
    The single row behind the citizen About Us page's contact card and
    description cards, and the site footer's contact column (see
    frontend/citizen/js/site-footer.js). An Administrator edits it from the
    Admin Portal's About Us Setup page, since contact details and wording
    change over time (new hotline, new email, a new administration after an
    election) and shouldn't need a code change. Always pk=1 — use load().
    """

    name = models.CharField(max_length=100, default="Barangay Platero")
    # The website's own brand — the navbar/sidebar logo + name shown across
    # all 3 portals (frontend/*/js/main.js and admin.js pull this live).
    # Deliberately separate from `name` above: that's the barangay's own
    # name (About Us), this is the system's. Written "Name | Kind of system":
    # the part after the bar is shown on a smaller line under the name. The
    # browser tab title stays a static "Barangay Platero OVRMS" regardless of
    # this field — only the visible navbar/sidebar brand follows it.
    site_name = models.CharField(
        max_length=120, default="Barangay Platero | Ordinance Violation Reporting and Monitoring System"
    )
    site_logo = models.ImageField(upload_to="site/", blank=True)
    # The page background behind every portal. Blank means the built-in
    # barangay hall photo (frontend/*/assets/barangay hall 5 pix.png).
    site_background = models.ImageField(upload_to="site/", blank=True)
    city = models.CharField(max_length=100, default="City of Biñan, Laguna")
    address = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    email = models.EmailField(blank=True)
    office_hours = models.CharField(max_length=120, blank=True)
    emergency_hotline = models.CharField(max_length=50, default="911")
    # About Us' "What is OVRMS" and "Our Mission" cards.
    about_text = models.TextField(blank=True)
    mission_text = models.TextField(blank=True)
    # The site footer's own copy (frontend/citizen/js/site-footer.js). The
    # link lists are [{"label": ..., "url": ...}] — empty falls back to the
    # built-in defaults the footer ships with.
    footer_tagline = models.CharField(max_length=255, default="Ordinance Violation Reporting and Monitoring System")
    footer_notice = models.CharField(
        max_length=255, default="Personal data is processed under the Data Privacy Act of 2012 (Republic Act No. 10173)."
    )
    footer_quick_links = models.JSONField(default=list, blank=True)
    footer_legal_links = models.JSONField(default=list, blank=True)
    # The barangay's outline on the staff incident heatmap, as a list of
    # [lat, lng] points (one closed ring; the first point isn't repeated).
    # Drawn or uploaded by an Administrator on the Map Boundary page. Empty
    # means no outline. OpenStreetMap has no Platero boundary and the PSA
    # 2023 polygon is too coarse for the app's street data, hence editable.
    boundary = models.JSONField(default=list, blank=True)
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


class Street(models.Model):
    """
    One barangay street — the Street combobox on Sign Up/File Report/My
    Profile (frontend/*/js/streets-data.js's old hardcoded STREETS list),
    and the point its reports plot at on the staff incident heatmap when a
    report has no device location (frontend/staff/js/street-coordinates.js's
    old hardcoded STREET_COORDINATES). Added by an Administrator clicking a
    point on the Map Boundary page's map, same interaction as the boundary
    outline itself. Report.location stays free text rather than a foreign
    key here (see reports.models.Report), so deleting a street never
    touches past reports that cited it.
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
    """
    One person in About Us' "Sangguniang Barangay" section. Managed by an
    Administrator because the roster changes with every barangay election —
    add the incoming officials (hidden) ahead of time, then flip visibility
    when the term turns over. `group` picks the row they appear in; `order`
    sorts within it.

    Separate from ordinances.OrdinanceAuthor on purpose: that roster is only
    the seats that can author an ordinance, while this one is the public
    face of the barangay (committee titles, photos, and appointed officers
    like the Secretary and Treasurer, who can't author ordinances).
    """

    class Group(models.TextChoices):
        CHAIRMAN = "chairman", "Punong Barangay (top row)"
        MEMBER = "member", "Sangguniang Barangay member"
        OFFICER = "officer", "Appointed officer (Secretary, Treasurer)"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150)
    # Shown under the name, e.g. "Committee Chairman on Education".
    position = models.CharField(max_length=255)
    group = models.CharField(max_length=10, choices=Group.choices, default=Group.MEMBER)
    photo = models.ImageField(upload_to="about/council/%Y/", blank=True)
    # Path under the frontend root for the portraits seeded with the app
    # (frontend/citizen/drawables/) — used until an Administrator uploads one.
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
    """
    One seal in About Us' green logo strip (barangay seal, city seal, the
    current administration's logo). Editable because the administration's
    logo changes with the Punong Barangay.
    """

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
    """
    The text of one of the citizen legal pages (Privacy Policy, Terms and
    Agreements), edited by an Administrator from Website Setup. `sections` is
    a list of {"anchor", "heading", "body"}: body is plain text where each
    block is separated by a blank line — "- " starts a bullet, "1. " a
    numbered item, "| a | b |" a table row (first row is the header), and
    **bold**, [text](url) and {{address}}/{{email}}/{{phone}}/{{name}} are
    filled in on the page. The page renders it with frontend/citizen/js/legal.js.
    """

    class Key(models.TextChoices):
        PRIVACY = "privacy", "Privacy Policy"
        TERMS = "terms", "Terms and Agreements"

    key = models.CharField(max_length=20, choices=Key.choices, unique=True)
    effective_date = models.CharField(max_length=60, blank=True)
    sections = models.JSONField(default=list, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.get_key_display()
