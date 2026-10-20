from django.db import migrations

from orms_backend.encrypted_fields import decrypt_existing_rows, encrypt_existing_rows

FIELDS = {
    "Report": ["location"],
    "Concern": ["location"],
    "Question": ["question"],
}


def encrypt(apps, schema_editor):
    for model_name, fields in FIELDS.items():
        encrypt_existing_rows(apps.get_model("reports", model_name), fields)


def decrypt(apps, schema_editor):
    for model_name, fields in FIELDS.items():
        decrypt_existing_rows(apps.get_model("reports", model_name), fields, schema_editor.connection)


class Migration(migrations.Migration):
    """
    Encrypts the report/concern locations and citizens' questions already
    stored before 0017 made those columns encrypted. Needs DATA_ENCRYPTION_KEY
    to be set. (Files uploaded before 0017 are converted separately, with
    `manage.py encrypt_existing_files`.)
    """

    dependencies = [
        ("reports", "0017_encrypt_more_personal_data"),
    ]

    operations = [
        migrations.RunPython(encrypt, decrypt),
    ]
