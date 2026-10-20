"""
Shows that the running system and the demo use the same Modified Blowfish
algorithm, by making each one read what the other wrote.

Why not just compare ciphertexts? Because they can never be equal, even with
the same master key: every record gets a new random salt (so a new derived
key) and a new random IV. Two encryptions of the same text always differ —
that is the modification working. What CAN be checked is that a value
encrypted by one side decrypts correctly on the other:

  1. System -> demo: take a value exactly as it sits in the system's
     database and decrypt it with the ORIGINAL modified_blowfish.py in this
     folder (not the backend's copy).
  2. Demo -> system: encrypt a value with the original file, and have the
     system's own field code decrypt it.
  3. Same inputs, same key: both files derive the identical per-record key
     from the same master key, salt and iteration count.

Both use the system's master key from .env, which is how the demo is given
"the same key" — the demo files otherwise invent a random key on every run.

Run from the project folder:
    venv\\Scripts\\python "modif blowfish\\verify_system_matches_demo.py"
"""

import base64
import importlib.util
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
sys.path.insert(0, str(PROJECT))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "orms_backend.settings")

import django  # noqa: E402

django.setup()

from django.conf import settings  # noqa: E402
from django.db import connection  # noqa: E402

from orms_backend import encrypted_fields  # noqa: E402
from orms_backend import modified_blowfish as system_copy  # noqa: E402

# The demo's file, loaded straight from this folder under its own name so it
# can't be confused with the backend's copy.
_spec = importlib.util.spec_from_file_location("demo_modified_blowfish", HERE / "modified_blowfish.py")
demo = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = demo  # dataclasses needs the module registered while it loads
_spec.loader.exec_module(demo)

MASTER_KEY = base64.b64decode(settings.DATA_ENCRYPTION_KEY)

CHECKS = [
    # (label, table, column) — a few of the columns the system encrypts
    ("Account first name", "accounts_user", "first_name"),
    ("Account last name", "accounts_user", "last_name"),
    ("Report narrative", "reports_report", "nature_of_violation"),
    ("Report location", "reports_report", "location"),
]


def rule(title):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


def short(text, width=60):
    text = str(text)
    return text if len(text) <= width else text[: width - 1] + "…"


def main():
    failures = 0
    print(f"Demo file    : {HERE / 'modified_blowfish.py'}")
    print(f"System file  : {Path(system_copy.__file__)}")
    print(f"Master key   : {len(MASTER_KEY) * 8}-bit, from DATA_ENCRYPTION_KEY in .env (not shown)")
    print(f"Database     : {connection.settings_dict['NAME']} on {connection.settings_dict.get('HOST') or 'local file'}")

    rule("1. SYSTEM -> DEMO: the demo file decrypts what the system stored")
    with connection.cursor() as cursor:
        for label, table, column in CHECKS:
            cursor.execute(f'SELECT "{column}" FROM "{table}" WHERE "{column}" LIKE %s LIMIT 1', ['{"salt"%'])
            row = cursor.fetchone()
            if not row:
                print(f"\n{label}: no encrypted value in the database yet — skipped")
                continue
            stored = json.loads(row[0])
            iterations = stored.pop("iterations")
            print(f"\n{label}  ({table}.{column})")
            print(f"  as stored  salt       : {stored['salt']}")
            print(f"             iv         : {stored['iv']}")
            print(f"             ciphertext : {short(stored['ciphertext'])}")
            print(f"             iterations : {iterations}")
            recovered = demo.decrypt_text(stored, MASTER_KEY, iterations)
            expected = encrypted_fields.decrypt_value(row[0])
            ok = recovered == expected
            failures += not ok
            print(f"  demo file decrypts it to : {short(recovered)!r}")
            print(f"  system reads it as       : {short(expected)!r}   {'MATCH' if ok else 'MISMATCH'}")

    rule("2. DEMO -> SYSTEM: the system decrypts what the demo file encrypted")
    sample = "Juan Dela Cruz, 123 Rizal St., Biñan, Laguna"
    iterations = settings.MODIFIED_BLOWFISH_ITERATIONS
    from_demo = demo.encrypt_text(sample, MASTER_KEY, iterations)
    from_demo["iterations"] = iterations
    as_stored = json.dumps(from_demo, separators=(",", ":"))
    recovered = encrypted_fields.decrypt_value(as_stored)
    ok = recovered == sample
    failures += not ok
    print(f"\n  plaintext                : {sample!r}")
    print(f"  demo file encrypts it to : {short(as_stored, 66)}")
    print(f"  system decrypts it to    : {recovered!r}   {'MATCH' if ok else 'MISMATCH'}")

    rule("3. SAME INPUTS: both files derive the same per-record key")
    salt = os.urandom(demo.SALT_LENGTH_BYTES)
    key_demo = demo.derive_key(MASTER_KEY, salt, iterations=iterations)
    key_system = system_copy.derive_key(MASTER_KEY, salt, iterations=iterations)
    ok = key_demo == key_system
    failures += not ok
    print(f"\n  salt                     : {salt.hex()}")
    print(f"  demo file's derived key  : {key_demo.hex()}")
    print(f"  system's derived key     : {key_system.hex()}   {'MATCH' if ok else 'MISMATCH'}")
    constants = ["SALT_LENGTH_BYTES", "IV_LENGTH_BYTES", "DERIVED_KEY_LENGTH_BYTES"]
    same = all(getattr(demo, name) == getattr(system_copy, name) for name in constants)
    failures += not same
    print(f"  salt / IV / key lengths  : {[getattr(demo, name) for name in constants]} bytes   {'MATCH' if same else 'MISMATCH'}")

    rule("RESULT")
    if failures:
        print(f"\n{failures} check(s) did NOT match — the system and the demo are not using the same algorithm.")
        sys.exit(1)
    print("\nEvery check matched: the system and the demo use the same algorithm.")
    print("(The ciphertexts above change on every run and never repeat — that is the per-record salt and IV.)")


if __name__ == "__main__":
    main()
