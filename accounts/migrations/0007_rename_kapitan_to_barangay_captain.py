from django.db import migrations


def rename_kapitan(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(position="Kapitan").update(position="Barangay Captain")


def rename_back(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    User.objects.filter(position="Barangay Captain").update(position="Kapitan")


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0006_auditlog"),
    ]

    operations = [
        migrations.RunPython(rename_kapitan, rename_back),
    ]
