from django.db import migrations

SYSTEM = "Ordinance Violation Reporting and Monitoring System"

# Applied in order to the stored About Us and legal text. The first three
# introduce the full name with its short form where the old text introduced
# "SafeSpace"; every later mention then just becomes "OVRMS". Text an
# Administrator already rewrote without the old name is left untouched.
REPLACEMENTS = [
    (
        "SafeSpace, the Barangay's Online Reporting and Management System",
        f"the Barangay's {SYSTEM} (OVRMS)",
    ),
    (
        "SafeSpace, the Barangay Platero Online Reporting and Management System",
        f"the Barangay Platero {SYSTEM} (OVRMS)",
    ),
    ("SafeSpace is a web-based system", f"The {SYSTEM} (OVRMS) is a web-based system"),
    ("Online Reporting and Management System", SYSTEM),
    ("SafeSpace", "OVRMS"),
]


def reword(text):
    for old, new in REPLACEMENTS:
        text = text.replace(old, new)
    return text


def reword_stored_text(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    for profile in BarangayProfile.objects.all():
        about_text, mission_text = reword(profile.about_text), reword(profile.mission_text)
        if (about_text, mission_text) != (profile.about_text, profile.mission_text):
            profile.about_text, profile.mission_text = about_text, mission_text
            profile.save(update_fields=["about_text", "mission_text"])

    LegalDocument = apps.get_model("siteinfo", "LegalDocument")
    for document in LegalDocument.objects.all():
        changed = False
        sections = document.sections or []
        for section in sections:
            for key in ("heading", "body"):
                value = section.get(key)
                if isinstance(value, str) and reword(value) != value:
                    section[key] = reword(value)
                    changed = True
        if changed:
            document.sections = sections
            document.save(update_fields=["sections"])


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0011_rename_site_from_safespace"),
    ]

    operations = [
        # Not reversed: the old wording can't be told apart from text an
        # Administrator wrote with the new name afterwards.
        migrations.RunPython(reword_stored_text, migrations.RunPython.noop),
    ]
