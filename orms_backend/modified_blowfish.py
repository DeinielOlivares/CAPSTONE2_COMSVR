"""
Modified Blowfish Data Protection Algorithm
--------------------------------------------
Implements the two-component modification described in the capstone study:

  1. Per-record key derivation with salt (PBKDF2-HMAC-SHA256)
     -> bounds the volume of data encrypted under any single effective key,
        mitigating Sweet32-style birthday-bound attacks on 64-bit blocks.

  2. Per-record random Initialization Vector (IV) in CBC mode
     -> ensures identical plaintexts never produce identical ciphertexts.

Author: (capstone student)

This is the algorithm from the study's "modif blowfish" folder, copied into the
backend. The only difference from that original is the lru_cache on derive_key
below (marked there); the scheme and its output are unchanged. The system uses
it through orms_backend/encrypted_fields.py.
"""

import os
import base64
from dataclasses import dataclass
from functools import lru_cache

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import padding as sym_padding


# ---------------------------------------------------------------------------
# Configuration constants (document these in your methodology chapter)
# ---------------------------------------------------------------------------
SALT_LENGTH_BYTES = 16          # 128-bit random salt per record
IV_LENGTH_BYTES = 8             # Blowfish block size = 64 bits = 8 bytes
DERIVED_KEY_LENGTH_BYTES = 32   # 256-bit derived subkey
PBKDF2_ITERATIONS = 100_000     # tune this after your benchmarking chapter
BACKEND = default_backend()


@dataclass
class EncryptedRecord:
    """Everything that gets stored in the database for one encrypted field."""
    salt: bytes
    iv: bytes
    ciphertext: bytes

    def to_dict(self) -> dict:
        """Serialize to base64 strings, suitable for DB storage / JSON."""
        return {
            "salt": base64.b64encode(self.salt).decode("utf-8"),
            "iv": base64.b64encode(self.iv).decode("utf-8"),
            "ciphertext": base64.b64encode(self.ciphertext).decode("utf-8"),
        }

    @staticmethod
    def from_dict(data: dict) -> "EncryptedRecord":
        return EncryptedRecord(
            salt=base64.b64decode(data["salt"]),
            iv=base64.b64decode(data["iv"]),
            ciphertext=base64.b64decode(data["ciphertext"]),
        )


# ---------------------------------------------------------------------------
# Key derivation
# ---------------------------------------------------------------------------
# Backend addition: remembers the subkey already derived for a record's salt, so
# a record that's read again (every page load re-reads the same names, addresses
# and reports) doesn't pay for PBKDF2 a second time. It caches nothing that
# wasn't already recoverable from the master key held in the same process.
@lru_cache(maxsize=50_000)
def derive_key(master_key: bytes, salt: bytes,
                iterations: int = PBKDF2_ITERATIONS,
                key_length: int = DERIVED_KEY_LENGTH_BYTES) -> bytes:
    """
    Derive a per-record subkey from the master secret and a per-record salt
    using PBKDF2-HMAC-SHA256 (Moriarty et al., 2017).
    """
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=key_length,
        salt=salt,
        iterations=iterations,
        backend=BACKEND,
    )
    return kdf.derive(master_key)


# ---------------------------------------------------------------------------
# Encryption / Decryption
# ---------------------------------------------------------------------------
def encrypt_record(plaintext: bytes, master_key: bytes,
                    iterations: int = PBKDF2_ITERATIONS) -> EncryptedRecord:
    """
    Encrypt a single record/field using the modified Blowfish scheme.

    Steps:
      1. Generate random salt -> derive per-record key via PBKDF2
      2. Generate random IV
      3. PKCS7-pad plaintext to Blowfish's 8-byte block size
      4. Encrypt with Blowfish-CBC using the derived key and IV
    """
    salt = os.urandom(SALT_LENGTH_BYTES)
    iv = os.urandom(IV_LENGTH_BYTES)

    derived_key = derive_key(master_key, salt, iterations=iterations)

    padder = sym_padding.PKCS7(algorithms.Blowfish.block_size).padder()
    padded_plaintext = padder.update(plaintext) + padder.finalize()

    cipher = Cipher(algorithms.Blowfish(derived_key), modes.CBC(iv), backend=BACKEND)
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_plaintext) + encryptor.finalize()

    return EncryptedRecord(salt=salt, iv=iv, ciphertext=ciphertext)


def decrypt_record(record: EncryptedRecord, master_key: bytes,
                    iterations: int = PBKDF2_ITERATIONS) -> bytes:
    """
    Decrypt a record encrypted with encrypt_record().

    Steps:
      1. Recompute the per-record key from the stored salt + master key
      2. Decrypt with Blowfish-CBC using the stored IV
      3. Remove PKCS7 padding
    """
    derived_key = derive_key(master_key, record.salt, iterations=iterations)

    cipher = Cipher(algorithms.Blowfish(derived_key), modes.CBC(record.iv), backend=BACKEND)
    decryptor = cipher.decryptor()
    padded_plaintext = decryptor.update(record.ciphertext) + decryptor.finalize()

    unpadder = sym_padding.PKCS7(algorithms.Blowfish.block_size).unpadder()
    plaintext = unpadder.update(padded_plaintext) + unpadder.finalize()

    return plaintext


# ---------------------------------------------------------------------------
# Convenience wrappers for string data (most common case: DB text fields)
# ---------------------------------------------------------------------------
def encrypt_text(plaintext_str: str, master_key: bytes,
                  iterations: int = PBKDF2_ITERATIONS) -> dict:
    """Encrypt a UTF-8 string and return a JSON/DB-storable dict."""
    record = encrypt_record(plaintext_str.encode("utf-8"), master_key, iterations)
    return record.to_dict()


def decrypt_text(stored_dict: dict, master_key: bytes,
                  iterations: int = PBKDF2_ITERATIONS) -> str:
    """Decrypt a dict produced by encrypt_text() back to the original string."""
    record = EncryptedRecord.from_dict(stored_dict)
    plaintext_bytes = decrypt_record(record, master_key, iterations)
    return plaintext_bytes.decode("utf-8")
