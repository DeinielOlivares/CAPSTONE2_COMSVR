from django.db import migrations

from orms_backend.encrypted_fields import decrypt_existing_rows, encrypt_existing_rows

FIELDS = {
    "Report": ["nature_of_violation", "remarks"],
    "Concern": ["description", "remarks"],
}


def encrypt(apps, schema_editor):
    for model_name, fields in FIELDS.items():
        encrypt_existing_rows(apps.get_model("reports", model_name), fields)


def decrypt(apps, schema_editor):
    for model_name, fields in FIELDS.items():
        decrypt_existing_rows(apps.get_model("reports", model_name), fields, schema_editor.connection)


class Migration(migrations.Migration):
    """
    Encrypts the report narratives, concern descriptions and staff remarks
    already stored before 0015 made those columns encrypted. Needs
    DATA_ENCRYPTION_KEY to be set — it stops before changing anything if it isn't.
    """

    dependencies = [
        ("reports", "0015_encrypt_personal_data"),
    ]

    operations = [
        migrations.RunPython(encrypt, decrypt),
    ]
