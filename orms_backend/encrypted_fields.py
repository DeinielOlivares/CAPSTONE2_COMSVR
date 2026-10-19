"""
Barangay Platero OVRMS — model fields that keep personal data encrypted in the
database with the study's Modified Blowfish algorithm (see modified_blowfish.py).

A field declared as EncryptedTextField reads and writes ordinary text in Python
— views, serializers and templates don't change — but what sits in the database
column is the algorithm's output for that one value: its own random salt (so
its own derived key), its own random IV, and the ciphertext, e.g.

    {"salt": "...", "iv": "...", "ciphertext": "...", "iterations": 1000}

The PBKDF2 iteration count is stored with each value so the setting
(MODIFIED_BLOWFISH_ITERATIONS) can be re-tuned later without making older
values unreadable.

Because every value has a different key and IV, the same text never encrypts
the same way twice — which is the point, and also means an encrypted column
can't be searched, filtered or sorted by the database. Trying to raises
FieldError rather than quietly matching nothing.
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
    The database's JSON string -> plain text. Anything that isn't in the stored
    format is returned as it is: that's a value written before the column was
    encrypted, which the data migration (or the next save) then encrypts.
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
    Text that is encrypted at rest. Always a `text` column, since the stored
    form is several times longer than the value; `max_length` still limits the
    text itself (forms and serializers enforce it), as it does on a CharField.
    """

    description = "Text encrypted with the Modified Blowfish algorithm"

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decrypt_value(value)

    def get_db_prep_save(self, value, connection):
        value = self.to_python(value)
        # Blank stays blank: nothing to protect, and "is it filled in?" checks
        # (filter(field="")) keep working.
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
        # exact/in/isnull are let through as far as get_prep_value above, which
        # only accepts blank. Pattern lookups (icontains, startswith…) never
        # call it, so they're refused here.
        if lookup_name not in ("exact", "in", "isnull"):
            self._refuse_lookup()
        return super().get_lookup(lookup_name)


# ---- For the data migrations that encrypt rows written before a column was
# ---- switched to EncryptedTextField (and decrypt them again on reversal).

def encrypt_existing_rows(model, field_names):
    """
    Re-writes every row's `field_names` through the field, which encrypts them.
    Reading goes through from_db_value, so a value that's still plain text
    comes out as it is and one that's already encrypted is decrypted first —
    safe to run more than once. Uses update(), so auto_now timestamps (e.g.
    Report.updated_at, shown to residents as "last updated") don't move.
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
