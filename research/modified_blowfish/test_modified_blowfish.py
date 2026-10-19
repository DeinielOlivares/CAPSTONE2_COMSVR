"""
Correctness and demonstration tests for the Modified Blowfish scheme.
Run: python3 test_modified_blowfish.py
"""

import os
import time
import json

from modified_blowfish import (
    encrypt_text, decrypt_text,
    encrypt_record, decrypt_record,
    PBKDF2_ITERATIONS,
)


def test_basic_roundtrip():
    print("=== Test 1: Basic encrypt -> decrypt roundtrip ===")
    master_key = os.urandom(32)  # in production this comes from config/env, never hardcoded
    original = "Juan Dela Cruz, 123 Rizal St., Binan, Laguna"

    stored = encrypt_text(original, master_key)
    recovered = decrypt_text(stored, master_key)

    print("Original :", original)
    print("Recovered:", recovered)
    assert recovered == original, "Roundtrip failed!"
    print("PASSED\n")
    return stored


def test_wrong_key_fails():
    print("=== Test 2: Decryption with wrong master key should fail/garble ===")
    master_key = os.urandom(32)
    wrong_key = os.urandom(32)
    original = "Confidential barangay case report"

    stored = encrypt_text(original, master_key)
    try:
        recovered = decrypt_text(stored, wrong_key)
        # If it doesn't throw, the output should NOT match (extremely unlikely to match)
        assert recovered != original
        print("Did not raise, but output correctly does not match original.")
    except Exception as e:
        print(f"Correctly failed to decrypt with wrong key ({type(e).__name__}).")
    print("PASSED\n")


def test_identical_plaintexts_differ():
    print("=== Test 3: Identical plaintexts -> different ciphertexts (per-record IV/salt) ===")
    master_key = os.urandom(32)
    same_address = "456 Mabini St., Binan, Laguna"

    record_a = encrypt_text(same_address, master_key)
    record_b = encrypt_text(same_address, master_key)

    print("Ciphertext A:", record_a["ciphertext"][:40], "...")
    print("Ciphertext B:", record_b["ciphertext"][:40], "...")
    print("Salt A == Salt B? ", record_a["salt"] == record_b["salt"])
    print("IV A   == IV B?   ", record_a["iv"] == record_b["iv"])

    assert record_a["ciphertext"] != record_b["ciphertext"], \
        "Identical plaintexts produced identical ciphertext -- modification failed!"
    assert record_a["salt"] != record_b["salt"]
    assert record_a["iv"] != record_b["iv"]

    # But both should still decrypt correctly back to the same plaintext
    assert decrypt_text(record_a, master_key) == same_address
    assert decrypt_text(record_b, master_key) == same_address
    print("PASSED -- ciphertexts differ, salts/IVs differ, both decrypt correctly\n")


def test_tampered_ciphertext_fails():
    print("=== Test 4: Tampered ciphertext should fail to decrypt correctly ===")
    master_key = os.urandom(32)
    original = "Violation report #2026-0091"
    stored = encrypt_text(original, master_key)

    # Flip a byte in the ciphertext to simulate tampering
    raw = bytearray(bytes.fromhex(
        __import__("base64").b64decode(stored["ciphertext"]).hex()
    ))
    raw[0] ^= 0xFF
    import base64
    stored["ciphertext"] = base64.b64encode(bytes(raw)).decode("utf-8")

    try:
        recovered = decrypt_text(stored, master_key)
        assert recovered != original
        print("Tampering was not caught by padding, but plaintext is garbled (as expected for raw CBC).")
    except Exception as e:
        print(f"Tampering correctly caused a decryption error ({type(e).__name__}).")
    print("PASSED (note: for authenticated integrity checking, "
          "consider adding an HMAC -- see recommendations below)\n")


def benchmark(n_records: int = 200, iterations: int = PBKDF2_ITERATIONS):
    print(f"=== Benchmark: {n_records} records, PBKDF2 iterations={iterations} ===")
    master_key = os.urandom(32)
    sample_text = "Sample barangay record field data for benchmarking purposes."

    start = time.perf_counter()
    stored_records = [encrypt_text(sample_text, master_key, iterations=iterations)
                       for _ in range(n_records)]
    encrypt_time = time.perf_counter() - start

    start = time.perf_counter()
    for rec in stored_records:
        decrypt_text(rec, master_key, iterations=iterations)
    decrypt_time = time.perf_counter() - start

    print(f"Total encrypt time : {encrypt_time:.4f}s "
          f"({(encrypt_time / n_records) * 1000:.3f} ms/record)")
    print(f"Total decrypt time : {decrypt_time:.4f}s "
          f"({(decrypt_time / n_records) * 1000:.3f} ms/record)")
    print()


if __name__ == "__main__":
    stored_example = test_basic_roundtrip()
    test_wrong_key_fails()
    test_identical_plaintexts_differ()
    test_tampered_ciphertext_fails()

    print("--- Example stored record (what actually sits in the DB) ---")
    print(json.dumps(stored_example, indent=2))
    print()

    # Benchmark at a couple of iteration counts so you can put a table
    # in your Results chapter re: overhead vs. security tradeoff
    benchmark(n_records=100, iterations=10_000)
    benchmark(n_records=100, iterations=100_000)
