"""
Project-wide DRF exception handler.

DRF's stock 429 message ("Request was throttled. Expected available in 12
seconds.") tells whoever is hammering an endpoint exactly how long to wait
before the next burst. Users don't need the countdown, so swap it for a
generic message. Everything else is left to DRF's default handler.
"""

from rest_framework.exceptions import Throttled
from rest_framework.views import exception_handler as drf_exception_handler

THROTTLED_MESSAGE = "Too many attempts. Please try again later."


def exception_handler(exc, context):
    response = drf_exception_handler(exc, context)
    if response is not None and isinstance(exc, Throttled):
        response.data = {"detail": THROTTLED_MESSAGE}
    return response
