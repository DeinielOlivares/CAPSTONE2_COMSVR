from django.db import migrations

from orms_backend.encrypted_fields import decrypt_existing_rows, encrypt_existing_rows

FIELDS = ["first_name", "last_name", "contact_number", "address"]


def encrypt(apps, schema_editor):
    encrypt_existing_rows(apps.get_model("accounts", "User"), FIELDS)


def decrypt(apps, schema_editor):
    decrypt_existing_rows(apps.get_model("accounts", "User"), FIELDS, schema_editor.connection)


class Migration(migrations.Migration):
    """
    Encrypts the names, contact numbers and addresses already stored before
    0014 made those columns encrypted. Needs DATA_ENCRYPTION_KEY to be set —
    it stops before changing anything if it isn't.
    """

    dependencies = [
        ("accounts", "0014_encrypt_personal_data"),
    ]

    operations = [
        migrations.RunPython(encrypt, decrypt),
    ]
