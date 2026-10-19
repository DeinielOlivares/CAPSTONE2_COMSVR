from django.db import migrations

from orms_backend.encrypted_fields import decrypt_existing_rows, encrypt_existing_rows

FIELDS = ["owner_name"]


def encrypt(apps, schema_editor):
    encrypt_existing_rows(apps.get_model("accounts", "AuditLog"), FIELDS)


def decrypt(apps, schema_editor):
    decrypt_existing_rows(apps.get_model("accounts", "AuditLog"), FIELDS, schema_editor.connection)


class Migration(migrations.Migration):
    """
    Encrypts the names already recorded on audit log entries before 0016 made
    that column encrypted. Needs DATA_ENCRYPTION_KEY to be set.
    """

    dependencies = [
        ("accounts", "0016_encrypt_more_personal_data"),
    ]

    operations = [
        migrations.RunPython(encrypt, decrypt),
    ]
