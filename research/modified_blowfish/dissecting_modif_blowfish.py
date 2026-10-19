import os

#length config
BLOCK_SIZE_BYTES = 8
SALT_LENGTH_BYTES = 16
IV_LENGTH_BYTES = 8
DERIVED_KEY_LENGTH_BYTES = 32
PBKDF2_ITERATIONS = 10_000

#ptext = input("Enter the plaintext string: ")
ptext_str = "Binan"
master_key = os.urandom(32)

print(f"\n[Input] plaintext string : {ptext_str}")
print(f"\n[Input] master key : {master_key.hex()}")

print("""\nSTEP 1: Generate random per-record salt
Purpose: makes the derived key unique to this record, even if
the same master key encrypts thousands of other records.""")
salt = os.urandom(SALT_LENGTH_BYTES)
print(f"[Input] salt : {salt.hex()}")

print("""\nSTEP 2: Derive per-record key (PBKDF2-HMAC-SHA256)
Purpose: stretches (master_key + salt) through iterations: rounds of
HMAC-SHA256 so this record's key is unique AND slow to brute-force.""")
iterations = PBKDF2_ITERATIONS
kdf = PBKDF2HMAC(
    algorithm=hashes.SHA256(),
    length=DERIVED_KEY_LENGTH_BYTES,
    salt=salt,
    iterations=iterations,
    backend=BACKEND,
)
derived_key = kdf.derive(master_key)
print(f"[Input] derived key : {derived_key.hex()}")