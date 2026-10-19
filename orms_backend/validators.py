"""Upload checks shared by more than one app."""

from PIL import Image
from rest_framework import serializers

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_FORMATS = {"JPEG", "PNG", "WEBP"}


def validate_image_upload(file, max_bytes=MAX_IMAGE_BYTES):
    """A JPG, PNG or WebP image of at most 5 MB."""
    if file.size > max_bytes:
        raise serializers.ValidationError("Image must be 5 MB or smaller.")
    try:
        file.seek(0)
        fmt = Image.open(file).format
    except Exception:
        raise serializers.ValidationError("Upload a valid JPG, PNG or WebP image.")
    finally:
        file.seek(0)
    if fmt not in ALLOWED_IMAGE_FORMATS:
        raise serializers.ValidationError("Upload a JPG, PNG or WebP image.")
    return file
