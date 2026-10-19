"""
Modified Blowfish -- STEP-BY-STEP WALKTHROUGH (for study purposes)
--------------------------------------------------------------------
This script does the SAME thing as modified_blowfish.py, but instead of
calling modes.CBC() as one black-box operation, it manually performs the
CBC chaining block-by-block using Blowfish in ECB mode as the raw
"encrypt one 8-byte block" primitive, so you can see and print every
intermediate value:

    master key -> salt -> derived key -> padded plaintext -> blocks ->
    IV -> XOR -> Blowfish-encrypt block -> ciphertext block -> ...

DO NOT use this file's manual-CBC approach in production -- use
modified_blowfish.py (modes.CBC) for that. This file exists purely so
you can trace and understand the algorithm for your defense.
"""

import os

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import padding as sym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Configuration
BACKEND = default_backend()
BLOCK_SIZE_BYTES = 8
SALT_LENGTH_BYTES = 16
IV_LENGTH_BYTES = 8
DERIVED_KEY_LENGTH_BYTES = 32
PBKDF2_ITERATIONS = 10_000


def hexline(label: str, data: bytes, note: str = ""):
    """Pretty-print a labeled hex dump."""
    print(f"  {label:<22}: {data.hex()}  ({len(data)} bytes){' -- ' + note if note else ''}")


def xor_bytes(a: bytes, b: bytes) -> bytes:
    return bytes(x ^ y for x, y in zip(a, b))


def derive_record_key(master_key: bytes, salt: bytes, iterations: int) -> bytes:
    """Derive the same per-record Blowfish key during encryption and decryption."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=DERIVED_KEY_LENGTH_BYTES,
        salt=salt,
        iterations=iterations,
        backend=BACKEND,
    )
    return kdf.derive(master_key)


def blowfish_encrypt_block(key: bytes, block: bytes) -> bytes:
    """Encrypt one block with ECB as the raw primitive for manual CBC chaining."""
    assert len(block) == BLOCK_SIZE_BYTES
    cipher = Cipher(algorithms.Blowfish(key), modes.ECB(), backend=BACKEND)
    encryptor = cipher.encryptor()
    return encryptor.update(block) + encryptor.finalize()


def blowfish_decrypt_block(key: bytes, block: bytes) -> bytes:
    assert len(block) == BLOCK_SIZE_BYTES
    cipher = Cipher(algorithms.Blowfish(key), modes.ECB(), backend=BACKEND)
    decryptor = cipher.decryptor()
    return decryptor.update(block) + decryptor.finalize()


def encrypt_walkthrough(plaintext_str: str, master_key: bytes,
                         iterations: int = PBKDF2_ITERATIONS):
    """Show each stage of encrypting a UTF-8 string with manual CBC chaining."""
    print("=" * 78)
    print("ENCRYPTION WALKTHROUGH")
    print("=" * 78)

    # Prepare the input.
    plaintext = plaintext_str.encode("utf-8")
    print(f"\n[Input] plaintext string : {plaintext_str!r}")
    hexline("plaintext bytes", plaintext)
    hexline("master key", master_key, "kept secret, e.g. in .env / config -- never stored per-record")

    # Derive a unique key for this record.
    print("\n--- STEP 1: Generate random per-record salt ---")
    print("Purpose: makes the derived key unique to this record, even if")
    print("         the same master key encrypts thousands of other records.")
    salt = os.urandom(SALT_LENGTH_BYTES)
    hexline("salt", salt, "random, stored alongside ciphertext -- not secret")

    print("\n--- STEP 2: Derive per-record key (PBKDF2-HMAC-SHA256) ---")
    print(f"Purpose: stretches (master_key + salt) through {iterations:,} rounds of")
    print("         HMAC-SHA256 so this record's key is unique AND slow to brute-force.")
    derived_key = derive_record_key(master_key, salt, iterations)
    hexline("derived key", derived_key, "this record's *effective* Blowfish key")

    # Pad and split the plaintext into Blowfish blocks.
    print("\n--- STEP 3: PKCS7 padding ---")
    print(f"Purpose: Blowfish encrypts fixed {BLOCK_SIZE_BYTES}-byte blocks, so the")
    print("         plaintext length must be padded up to a multiple of 8.")
    padder = sym_padding.PKCS7(algorithms.Blowfish.block_size).padder()
    padded = padder.update(plaintext) + padder.finalize()
    hexline("padded plaintext", padded)
    blocks = [
        padded[offset:offset + BLOCK_SIZE_BYTES]
        for offset in range(0, len(padded), BLOCK_SIZE_BYTES)
    ]
    print(f"  Split into {len(blocks)} block(s) of {BLOCK_SIZE_BYTES} bytes each:")
    for block_index, plain_block in enumerate(blocks):
        hexline(f"    plaintext block {block_index}", plain_block)

    # Start the CBC chain with a random IV.
    print("\n--- STEP 4: Generate random per-record IV ---")
    print("Purpose: seeds the CBC chain so identical plaintexts (e.g. two")
    print("         residents on the same street) still produce different")
    print("         ciphertexts.")
    iv = os.urandom(IV_LENGTH_BYTES)
    hexline("IV", iv, "random, stored alongside ciphertext -- not secret")

    # Encrypt each block, chaining each result into the next block.
    print("\n--- STEP 5: CBC chaining + Blowfish block encryption ---")
    print("For each block:  ciphertext_i = Blowfish_Encrypt( plaintext_i XOR previous_ciphertext )")
    print("(for block 0, 'previous_ciphertext' is the IV)")

    ciphertext_blocks = []
    previous = iv
    for block_index, plain_block in enumerate(blocks):
        print(f"\n  Block {block_index}:")
        hexline("    plaintext block", plain_block)
        previous_label = "IV" if block_index == 0 else f"ciphertext block {block_index - 1}"
        hexline("    XOR with", previous, previous_label)
        xored = xor_bytes(plain_block, previous)
        hexline("    XOR result", xored)
        enc_block = blowfish_encrypt_block(derived_key, xored)
        hexline("    Blowfish-encrypted", enc_block, f"= ciphertext block {block_index}")
        ciphertext_blocks.append(enc_block)
        previous = enc_block

    ciphertext = b"".join(ciphertext_blocks)
    print(f"\n--- RESULT: full ciphertext ---")
    hexline("ciphertext", ciphertext)

    print("\n--- What gets stored in the database for this record ---")
    hexline("salt", salt)
    hexline("iv", iv)
    hexline("ciphertext", ciphertext)
    print("  (master_key is NOT stored anywhere in the database)\n")

    return salt, iv, ciphertext


def decrypt_walkthrough(salt: bytes, iv: bytes, ciphertext: bytes,
                         master_key: bytes, iterations: int = PBKDF2_ITERATIONS):
    """Show each stage of manually decrypting a CBC-encrypted string."""
    print("=" * 78)
    print("DECRYPTION WALKTHROUGH")
    print("=" * 78)

    hexline("\n[Input] salt", salt)
    hexline("[Input] iv", iv)
    hexline("[Input] ciphertext", ciphertext)

    # Recreate the per-record key from the stored salt.
    print("\n--- STEP 1: Recompute per-record key from stored salt + master key ---")
    derived_key = derive_record_key(master_key, salt, iterations)
    hexline("derived key", derived_key, "must match the one used at encryption time")

    # Decrypt each block and XOR with the previous ciphertext block.
    print("\n--- STEP 2: CBC dechaining + Blowfish block decryption ---")
    print("For each block:  plaintext_i = Blowfish_Decrypt( ciphertext_i ) XOR previous_ciphertext")
    print("(for block 0, 'previous_ciphertext' is the IV)")

    cipher_blocks = [
        ciphertext[offset:offset + BLOCK_SIZE_BYTES]
        for offset in range(0, len(ciphertext), BLOCK_SIZE_BYTES)
    ]
    plaintext_blocks = []
    previous = iv
    for block_index, cipher_block in enumerate(cipher_blocks):
        print(f"\n  Block {block_index}:")
        hexline("    ciphertext block", cipher_block)
        dec_block = blowfish_decrypt_block(derived_key, cipher_block)
        hexline("    Blowfish-decrypted", dec_block)
        previous_label = "IV" if block_index == 0 else f"ciphertext block {block_index - 1}"
        hexline("    XOR with", previous, previous_label)
        pblock = xor_bytes(dec_block, previous)
        hexline("    XOR result", pblock, f"= plaintext block {block_index}")
        plaintext_blocks.append(pblock)
        previous = cipher_block

    padded_plaintext = b"".join(plaintext_blocks)
    print(f"\n--- Reassembled padded plaintext ---")
    hexline("padded plaintext", padded_plaintext)

    # Remove padding and decode the recovered UTF-8 text.
    print("\n--- STEP 3: Remove PKCS7 padding ---")
    unpadder = sym_padding.PKCS7(algorithms.Blowfish.block_size).unpadder()
    plaintext = unpadder.update(padded_plaintext) + unpadder.finalize()
    hexline("plaintext bytes", plaintext)
    plaintext_str = plaintext.decode("utf-8")
    print(f"  recovered string: {plaintext_str!r}\n")

    return plaintext_str


def main():
    """Run the example encryption/decryption round trip."""
    master_key = os.urandom(32)
    original_text = "Binan"

    salt, iv, ciphertext = encrypt_walkthrough(original_text, master_key)
    recovered = decrypt_walkthrough(salt, iv, ciphertext, master_key)

    print("=" * 78)
    print(f"VERIFICATION: original == recovered  ->  {original_text == recovered}")
    print("=" * 78)


if __name__ == "__main__":
    main()
