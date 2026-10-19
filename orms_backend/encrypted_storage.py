"""
EncryptedStorage — keeps uploaded personal images (voter's ID photos, report
and concern evidence photos) encrypted with the Modified Blowfish algorithm.

Each upload is saved as one file under an `enc/` folder with a random name:

    "MBF1" | PBKDF2 rounds (4 bytes) | salt (16) | IV (8) | ciphertext

The ciphertext decrypts to a one-line JSON header (the content type) followed
by the original file bytes.

A browser can't show an encrypted file directly, so url() returns a
short-lived signed link to ProtectedMediaView, which decrypts it on request.

Not encrypted: videos (too large to decrypt on every view) and files uploaded
before encryption was added (see `manage.py encrypt_existing_files`).
"""

import json
import mimetypes
import posixpath
import struct
import time
import uuid

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage, Storage, storages
from django.http import Http404, HttpResponse
from django.urls import reverse
from django.utils.deconstruct import deconstructible
from django.views import View

from . import modified_blowfish
from .encrypted_fields import _master_key

MAGIC = b"MBF1"
ENCRYPTED_FOLDER = "enc"
_HEADER = struct.Struct(f">4sI{modified_blowfish.SALT_LENGTH_BYTES}s{modified_blowfish.IV_LENGTH_BYTES}s")

_SIGNING_SALT = "orms.protected-media"
# A link stays the same for one 6-hour window (so browsers can cache the
# image) and keeps working for at least one more window after that.
_LINK_WINDOW_SECONDS = 6 * 60 * 60

# Only these are shown inline; anything else is sent as a download, so an
# uploaded file can never run as a page on this site.
_INLINE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def encrypt_bytes(data, content_type):
    """File bytes -> the encrypted blob described at the top of this module."""
    iterations = settings.MODIFIED_BLOWFISH_ITERATIONS
    plaintext = json.dumps({"type": content_type}).encode("ascii") + b"\n" + data
    record = modified_blowfish.encrypt_record(plaintext, _master_key(), iterations)
    return _HEADER.pack(MAGIC, iterations, record.salt, record.iv) + record.ciphertext


def decrypt_bytes(blob):
    """The encrypted blob -> (content type, file bytes)."""
    if len(blob) < _HEADER.size or not blob.startswith(MAGIC):
        raise ValueError("Not a Modified Blowfish encrypted file.")
    _, iterations, salt, iv = _HEADER.unpack_from(blob)
    record = modified_blowfish.EncryptedRecord(salt=salt, iv=iv, ciphertext=blob[_HEADER.size:])
    try:
        plaintext = modified_blowfish.decrypt_record(record, _master_key(), iterations)
        header, _, data = plaintext.partition(b"\n")
        return json.loads(header)["type"], data
    except (ValueError, KeyError, TypeError) as exc:
        raise ValueError(
            "Could not decrypt a stored file — DATA_ENCRYPTION_KEY is not the key it was encrypted with."
        ) from exc


def is_encrypted_name(name):
    """True for a file this storage encrypted (they all live under an `enc/` folder)."""
    return ENCRYPTED_FOLDER in str(name).replace("\\", "/").split("/")[:-1]


def _is_video(name):
    return (mimetypes.guess_type(name)[0] or "").startswith("video/")


def _signer():
    return signing.Signer(salt=_SIGNING_SALT)


def protected_url(name):
    window = int(time.time()) // _LINK_WINDOW_SECONDS
    # Signer (not signing.dumps) so the token doesn't change every second.
    token = _signer().sign_object({"n": name, "e": (window + 2) * _LINK_WINDOW_SECONDS})
    return reverse("protected_media", args=[token])


@deconstructible
class EncryptedStorage(Storage):
    """Wraps the project's normal storage; see the module docstring."""

    @property
    def _plain(self):
        # Where unencrypted files (videos, older uploads) live.
        return storages["default"]

    @property
    def _blobs(self):
        # On Cloudinary, encrypted blobs must be uploaded as "raw" files.
        if settings.STORAGES["default"]["BACKEND"] == "cloudinary_storage.storage.MediaCloudinaryStorage":
            from cloudinary_storage.storage import RawMediaCloudinaryStorage

            return RawMediaCloudinaryStorage()
        return FileSystemStorage()

    def _backend(self, name):
        return self._blobs if is_encrypted_name(name) else self._plain

    def get_available_name(self, name, max_length=None):
        # The backend storages pick their own collision-free names in _save.
        return name

    def _save(self, name, content):
        name = str(name).replace("\\", "/")
        if _is_video(name):
            return self._plain.save(name, content)
        if hasattr(content, "seek"):
            content.seek(0)
        blob = encrypt_bytes(content.read(), mimetypes.guess_type(name)[0] or "application/octet-stream")
        # Random file name, so the original name isn't readable either.
        target = posixpath.join(ENCRYPTED_FOLDER, posixpath.dirname(name), f"{uuid.uuid4().hex}.enc")
        return self._blobs.save(target, ContentFile(blob))

    def read(self, name):
        """(content type, decrypted bytes) of an encrypted file."""
        with self._blobs.open(name, "rb") as stored:
            return decrypt_bytes(stored.read())

    def _open(self, name, mode="rb"):
        if not is_encrypted_name(name):
            return self._plain.open(name, mode)
        file = ContentFile(self.read(name)[1])
        file.name = name
        return file

    def url(self, name):
        if not is_encrypted_name(name):
            return self._plain.url(name)
        return protected_url(name)

    def delete(self, name):
        return self._backend(name).delete(name)

    def exists(self, name):
        return self._backend(name).exists(name)

    def size(self, name):
        return self._backend(name).size(name)


def encrypted_storage():
    """`storage=` for model fields (a callable, so migrations reference this, not an instance)."""
    return EncryptedStorage()


class ProtectedMediaView(View):
    """
    GET /api/media/protected/<token>/ — decrypts one encrypted upload.

    No login check: an <img> tag can't send the Authorization header, so the
    signed, expiring link is the permission. Links are only created by url()
    inside API responses to people already allowed to see the file.
    """

    def get(self, request, token):
        try:
            claim = _signer().unsign_object(token)
            name, expires = claim["n"], claim["e"]
        except (signing.BadSignature, KeyError, TypeError):
            raise Http404
        if time.time() > expires or not is_encrypted_name(name):
            raise Http404
        try:
            content_type, data = EncryptedStorage().read(name)
        except (OSError, FileNotFoundError):
            raise Http404

        inline = content_type in _INLINE_TYPES
        response = HttpResponse(data, content_type=content_type if inline else "application/octet-stream")
        if not inline:
            response["Content-Disposition"] = "attachment"
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, max-age=3600"
        return response
