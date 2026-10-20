"""
Educational, step-by-step view of modified_blowfish.py's text encryption flow.

This demo prints secret key material so you can inspect the transformations.
Never print or expose real keys outside a controlled learning environment.
"""

import base64
import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import padding as sym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Blowfish processes 8-byte blocks. PKCS7 expects the block size in bits.
BLOCK_SIZE_BYTES = 8
SALT_LENGTH_BYTES = 16
IV_LENGTH_BYTES = BLOCK_SIZE_BYTES
DERIVED_KEY_LENGTH_BYTES = 32

# Lower than modified_blowfish.py's 100,000 default to keep this demo snappy.
# This value is for studying the flow, not a production recommendation.
PBKDF2_ITERATIONS = 10_000
BACKEND = default_backend()


def show_bytes(label: str, value: bytes) -> None:
    """Print bytes as readable hex while also showing their length."""
    print(f"{label:<24} {value.hex()} ({len(value)} bytes)")


def main() -> None:
    # A fixed example makes the output easy to compare from run to run.
    # The salt and IV remain random, so the key and ciphertext will differ.
    plaintext_str = "Binan"
    plaintext = plaintext_str.encode("utf-8")

    # This random key is only for this demo run. Real applications must load
    # a persistent secret key from protected configuration/key management.
    master_key = os.urandom(32)

    print("INPUT")
    print(f"Plaintext string        {plaintext_str!r}")
    show_bytes("UTF-8 plaintext bytes", plaintext)
    show_bytes("Master key (demo only)", master_key)

    print("\nSTEP 1 - Generate per-record salt")
    print("The salt is random, stored with the ciphertext, and is not a secret.")
    salt = os.urandom(SALT_LENGTH_BYTES)
    show_bytes("Salt", salt)

    print("\nSTEP 2 - Derive a per-record key with PBKDF2-HMAC-SHA256")
    print(f"PBKDF2 applies HMAC-SHA256 for {PBKDF2_ITERATIONS:,} iterations.")
    print("The same master key and salt recreate the same derived key.")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=DERIVED_KEY_LENGTH_BYTES,
        salt=salt,
        iterations=PBKDF2_ITERATIONS,
        backend=BACKEND,
    )
    derived_key = kdf.derive(master_key)
    show_bytes("Derived Blowfish key", derived_key)

    print("\nSTEP 3 - Pad plaintext to whole Blowfish blocks")
    print(
        f"Blowfish needs input in {BLOCK_SIZE_BYTES}-byte blocks. "
        "PKCS7 adds between 1 and 8 bytes; a full block is added when "
        "the plaintext already fits exactly."
    )
    padder = sym_padding.PKCS7(algorithms.Blowfish.block_size).padder()
    padded_plaintext = padder.update(plaintext) + padder.finalize()
    show_bytes("PKCS7-padded bytes", padded_plaintext)
    for offset in range(0, len(padded_plaintext), BLOCK_SIZE_BYTES):
        block_number = offset // BLOCK_SIZE_BYTES
        show_bytes(
            f"Plaintext block {block_number}",
            padded_plaintext[offset:offset + BLOCK_SIZE_BYTES],
        )

    print("\nSTEP 4 - Generate the CBC initialization vector (IV)")
    print("The IV is random, exactly one block long, and stored with the record.")
    iv = os.urandom(IV_LENGTH_BYTES)
    show_bytes("IV", iv)

    print("\nSTEP 5 - Encrypt padded bytes using Blowfish-CBC")
    print("CBC combines each plaintext block with the previous ciphertext block.")
    print("For the first block, the IV is used as that previous block.")
    cipher = Cipher(
        algorithms.Blowfish(derived_key),
        modes.CBC(iv),
        backend=BACKEND,
    )
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded_plaintext) + encryptor.finalize()
    show_bytes("Ciphertext bytes", ciphertext)

    print("\nSTEP 6 - Encode binary record fields for text/JSON storage")
    print("Base64 is an encoding for storage; it is not another encryption step.")
    stored_record = {
        "salt": base64.b64encode(salt).decode("utf-8"),
        "iv": base64.b64encode(iv).decode("utf-8"),
        "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
    }
    for field, value in stored_record.items():
        print(f"{field:<24} {value}")

    print("\nDECRYPTION CHECK - Reverse the operations")
    # Decode the stored values, then derive the same key from the master key
    # and stored salt. In a real app, the master key is kept separate.
    salt_from_storage = base64.b64decode(stored_record["salt"])
    iv_from_storage = base64.b64decode(stored_record["iv"])
    ciphertext_from_storage = base64.b64decode(stored_record["ciphertext"])

    decrypt_kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=DERIVED_KEY_LENGTH_BYTES,
        salt=salt_from_storage,
        iterations=PBKDF2_ITERATIONS,
        backend=BACKEND,
    )
    decryption_key = decrypt_kdf.derive(master_key)
    show_bytes("Recreated key", decryption_key)

    decrypt_cipher = Cipher(
        algorithms.Blowfish(decryption_key),
        modes.CBC(iv_from_storage),
        backend=BACKEND,
    )
    decryptor = decrypt_cipher.decryptor()
    padded_result = (
        decryptor.update(ciphertext_from_storage) + decryptor.finalize()
    )
    show_bytes("Decrypted padded bytes", padded_result)

    unpadder = sym_padding.PKCS7(algorithms.Blowfish.block_size).unpadder()
    recovered_bytes = unpadder.update(padded_result) + unpadder.finalize()
    recovered_text = recovered_bytes.decode("utf-8")
    show_bytes("Recovered UTF-8 bytes", recovered_bytes)
    print(f"Recovered text          {recovered_text!r}")
    print(f"Round-trip matches      {recovered_text == plaintext_str}")


if __name__ == "__main__":
    main()
