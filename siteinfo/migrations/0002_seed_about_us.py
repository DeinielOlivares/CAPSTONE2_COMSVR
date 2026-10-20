# Seeds About Us with what was hardcoded in frontend/citizen/about.html and
# site-footer.js before this became Admin-editable (contact details from the
# barangay's own About Us mockup, Sep 2026). Portraits and logos point at the
# images shipped in frontend/citizen/drawables/ until an Administrator
# uploads replacements from the Admin Portal's About Us Setup page.

from django.db import migrations

PROFILE = {
    "name": "Barangay Platero",
    "city": "City of Biñan, Laguna",
    "address": "83CV+X8P, Platero, Biñan, Laguna",
    "phone": "0995 167 1070",
    "email": "brgy.platero0@gmail.com",
    "office_hours": "",
    "emergency_hotline": "911",
    "about_text": (
        "SafeSpace is a web-based system that is designed to help barangay citizens report violations, "
        "submit concerns and suggestions, ask questions, and view ordinances in order to promote "
        "collaborative and safe communities."
    ),
    "mission_text": (
        "SafeSpace gives barangay citizens a way to check what happens to their reports, concerns and "
        "suggestions. It also helps promote local government accountability and action."
    ),
}

D = "citizen/drawables/"
COUNCIL = [
    ('Hon. Eliseo "Jun" Aurelio Jr.', "Barangay Chairman", "chairman", "eliseo-aurelio.png"),
    ("Hon. Albert C. Anasao", "Committee Chairman on Health, Senior Citizens, Women and Children Affairs", "member", "albert-anasao.png"),
    ("Hon. Melvin L. Belan", "Committee Chairman on Peace and Order", "member", "melvin-belan.png"),
    ("Hon. Enriqueta C. Lacson", "Committee Chairman on Disaster Risk Reduction and Management", "member", "enriqueta-lacson.png"),
    ("Hon. Rommel N. Almendral", "Committee Chairman on Education", "member", "rommel-almendral.png"),
    ("Hon. Lualhati C. Narvaez", "Committee Chairman on Livelihood, Festivity and Events", "member", "lualhatic-narvaez.png"),
    ("Hon. Ruel Paolo C. Alonte", "Committee Chairman on Infrastructure", "member", "ruel-alonte.png"),
    ("Hon. Joana Marie R. Marica", "Committee Chairman on Appropriation", "member", "joana-marica.png"),
    ("Hon. Anthony Rinmark A. Perez", "Committee Chairman on Youth and Sports Development", "member", "anthony-perez.png"),
    ("Dan Paul V. Tarzona", "Barangay Secretary", "officer", "dan-tarzona.png"),
    ("Maria Cristel D. Norte", "Barangay Treasurer", "officer", "maria-norte.png"),
]

LOGOS = [
    ("Kapitan Jun Aurelio — Tatak Aurelio, Serbisyong Makatao", "logo-jun-aurelio.png"),
    ("Barangay Platero, City of Biñan seal", "logo-barangay-platero.png"),
    ("City of Biñan seal", "logo-city-of-binan.png"),
]


def seed(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    CouncilMember = apps.get_model("siteinfo", "CouncilMember")
    AboutLogo = apps.get_model("siteinfo", "AboutLogo")

    BarangayProfile.objects.update_or_create(pk=1, defaults=PROFILE)

    order_in_group = {}
    for name, position, group, photo in COUNCIL:
        order = order_in_group.get(group, 0)
        order_in_group[group] = order + 1
        CouncilMember.objects.create(
            name=name, position=position, group=group, default_photo=D + photo, order=order
        )

    for order, (alt, image) in enumerate(LOGOS):
        AboutLogo.objects.create(alt_text=alt, default_image=D + image, order=order)


def unseed(apps, schema_editor):
    for model in ("BarangayProfile", "CouncilMember", "AboutLogo"):
        apps.get_model("siteinfo", model).objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
