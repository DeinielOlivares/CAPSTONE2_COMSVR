"""
EncryptedTextField — a model field that stores text encrypted with the
study's Modified Blowfish algorithm (orms_backend/modified_blowfish.py).

In Python the field reads and writes normal text. In the database each value
is stored as JSON with its own random salt, IV and the ciphertext:

    {"salt": "...", "iv": "...", "ciphertext": "...", "iterations": 1000}

The PBKDF2 iteration count is saved with each value, so the setting
MODIFIED_BLOWFISH_ITERATIONS can change later without breaking old values.

Because the same text never encrypts the same way twice, the database cannot
search, filter or sort an encrypted column. Trying to raises FieldError.
"""

import base64
import binascii
import json

from django.conf import settings
from django.core.exceptions import FieldError, ImproperlyConfigured
from django.db import models

from . import modified_blowfish

_PREFIX = '{"salt"'


def _master_key():
    encoded = getattr(settings, "DATA_ENCRYPTION_KEY", "")
    if not encoded:
        raise ImproperlyConfigured(
            "DATA_ENCRYPTION_KEY is not set. It is the master key the encrypted personal "
            "data is derived from — see .env.example for how to generate one."
        )
    try:
        key = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise ImproperlyConfigured("DATA_ENCRYPTION_KEY must be base64 text (see .env.example).")
    if len(key) < 32:
        raise ImproperlyConfigured("DATA_ENCRYPTION_KEY must decode to at least 32 bytes (see .env.example).")
    return key


def encrypt_value(text):
    """Plain text -> the JSON string stored in the database."""
    iterations = settings.MODIFIED_BLOWFISH_ITERATIONS
    stored = modified_blowfish.encrypt_text(text, _master_key(), iterations)
    stored["iterations"] = iterations
    return json.dumps(stored, separators=(",", ":"))


def is_encrypted(stored):
    return isinstance(stored, str) and stored.startswith(_PREFIX)


def decrypt_value(stored):
    """
    The database's JSON string -> plain text. A value that isn't encrypted yet
    (written before the column was encrypted) is returned as it is.
    """
    if not is_encrypted(stored):
        return stored
    try:
        payload = json.loads(stored)
        iterations = int(payload.pop("iterations"))
    except (ValueError, KeyError, TypeError, AttributeError):
        return stored
    try:
        return modified_blowfish.decrypt_text(payload, _master_key(), iterations)
    except (ValueError, KeyError, binascii.Error) as exc:
        # Wrong padding or undecodable bytes: the key doesn't match the data.
        raise ValueError(
            "Could not decrypt a stored value — DATA_ENCRYPTION_KEY is not the key it was encrypted with."
        ) from exc


class EncryptedTextField(models.TextField):
    """
    Text that is encrypted at rest. Always a `text` column (the stored form is
    longer than the value); `max_length` still limits the text itself.
    """

    description = "Text encrypted with the Modified Blowfish algorithm"

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decrypt_value(value)

    def get_db_prep_save(self, value, connection):
        value = self.to_python(value)
        # Blank stays blank, so filter(field="") checks keep working.
        if value is None or value == "":
            return value
        return encrypt_value(value)

    def _refuse_lookup(self):
        raise FieldError(
            f"'{self.name}' is encrypted, so the database can't search, filter or compare it. "
            "Load the rows and compare the values in Python instead."
        )

    def get_prep_value(self, value):
        # Reached for query lookups only — saving goes through get_db_prep_save.
        if value is None or value == "":
            return value
        self._refuse_lookup()

    def get_lookup(self, lookup_name):
        # exact/in/isnull reach get_prep_value (which only allows blank);
        # every other lookup (icontains, startswith…) is refused here.
        if lookup_name not in ("exact", "in", "isnull"):
            self._refuse_lookup()
        return super().get_lookup(lookup_name)


# ---- Used by the data migrations that encrypted existing rows ----

def encrypt_existing_rows(model, field_names):
    """
    Re-saves `field_names` of every row through the field, which encrypts them.
    Safe to run more than once. Uses update() so auto_now timestamps don't change.
    """
    _master_key()  # fail before touching anything if the key is missing
    for row in model.objects.only("pk", *field_names).iterator():
        model.objects.filter(pk=row.pk).update(**{name: getattr(row, name) for name in field_names})


def decrypt_existing_rows(model, field_names, connection):
    """Reverse of encrypt_existing_rows: writes the plain text back, bypassing the field."""
    quote = connection.ops.quote_name
    table = quote(model._meta.db_table)
    pk_column = quote(model._meta.pk.column)
    with connection.cursor() as cursor:
        for row in model.objects.only("pk", *field_names).iterator():
            for name in field_names:
                column = quote(model._meta.get_field(name).column)
                cursor.execute(
                    f"UPDATE {table} SET {column} = %s WHERE {pk_column} = %s", [getattr(row, name), row.pk]
                )
