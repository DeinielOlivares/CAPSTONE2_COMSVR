from django.db import migrations, models

OLD_SITE_NAME = "SafeSpace"
NEW_SITE_NAME = "Barangay Platero | Ordinance Violation Reporting and Monitoring System"
OLD_FOOTER_TAGLINE = "SafeSpace — Online Reporting and Management System"
NEW_FOOTER_TAGLINE = "Ordinance Violation Reporting and Monitoring System"


def rename_stored_brand(apps, schema_editor):
    # Only where the value is still the old default — a name or tagline an
    # Administrator already changed in Website Setup is left alone.
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    BarangayProfile.objects.filter(site_name=OLD_SITE_NAME).update(site_name=NEW_SITE_NAME)
    BarangayProfile.objects.filter(footer_tagline=OLD_FOOTER_TAGLINE).update(footer_tagline=NEW_FOOTER_TAGLINE)


def restore_stored_brand(apps, schema_editor):
    BarangayProfile = apps.get_model("siteinfo", "BarangayProfile")
    BarangayProfile.objects.filter(site_name=NEW_SITE_NAME).update(site_name=OLD_SITE_NAME)
    BarangayProfile.objects.filter(footer_tagline=NEW_FOOTER_TAGLINE).update(footer_tagline=OLD_FOOTER_TAGLINE)


class Migration(migrations.Migration):

    dependencies = [
        ("siteinfo", "0010_add_terms_retention_sentence"),
    ]

    operations = [
        migrations.AlterField(
            model_name="barangayprofile",
            name="site_name",
            field=models.CharField(default=NEW_SITE_NAME, max_length=120),
        ),
        migrations.AlterField(
            model_name="barangayprofile",
            name="footer_tagline",
            field=models.CharField(default=NEW_FOOTER_TAGLINE, max_length=255),
        ),
        migrations.RunPython(rename_stored_brand, restore_stored_brand),
    ]
