# Seeds the Sangguniang Barangay ng Platero roster as author suggestions
# (see OrdinanceAuthor) — sourced from the Jan 7, 2022 session record in
# ordinances/samples/ (Kautusang Barangay bilang 004-2022 and 005-2022,
# cross-checked against each other for OCR-safe spelling). NOT guaranteed
# current: comparing this same sample set to the earlier bilang 002-2020
# record shows the Punong Barangay itself changed between 2020 and 2022
# (Ramon C. Fernandez -> Nelson D. Ama), and a barangay election has been
# held since (Dec. 2023 BSKE) that this project has no record of. An
# Administrator should confirm/correct this list on the Ordinance Setup page
# before relying on it.
#
# The Barangay Secretary (Albert C. Anasao) and Treasurer (Macrina B. Guico)
# who also appear in that record are deliberately excluded — see
# OrdinanceAuthor's docstring: they attend but aren't Sanggunian members and
# can't author an ordinance.

from django.db import migrations

COUNCIL = [
    ("Hon. Nelson D. Ama", "barangay_captain"),
    ("Hon. Lualhati C. Narvaez", "barangay_kagawad"),
    ("Hon. Eliseo L. Aurelio Jr.", "barangay_kagawad"),
    ("Hon. Lota F. Toledo", "barangay_kagawad"),
    ("Hon. Enriqueta C. Lacson", "barangay_kagawad"),
    ("Hon. Melvin L. Belan", "barangay_kagawad"),
    ("Hon. Rommel N. Almendral", "barangay_kagawad"),
    ("Hon. Florencio A. Ama", "barangay_kagawad"),
    ("Hon. Dan Paul V. Tarzona", "sk_chairperson"),
]


def seed_council(apps, schema_editor):
    OrdinanceAuthor = apps.get_model("ordinances", "OrdinanceAuthor")
    OrdinanceAuthor.objects.bulk_create(
        [OrdinanceAuthor(name=name, position=position) for name, position in COUNCIL]
    )


def unseed_council(apps, schema_editor):
    OrdinanceAuthor = apps.get_model("ordinances", "OrdinanceAuthor")
    OrdinanceAuthor.objects.filter(name__in=[name for name, _ in COUNCIL]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("ordinances", "0006_ordinance_category_and_free_text_author"),
    ]

    operations = [
        migrations.RunPython(seed_council, unseed_council),
    ]
