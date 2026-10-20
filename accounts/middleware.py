"""
Barangay Platero OVRMS — stashes the current request in a thread-local so log_action()
(accounts/models.py) can read the caller's IP without every one of its ~60
call sites across the codebase having to thread a request object through.
"""

import threading

_local = threading.local()


class CurrentRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _local.request = request
        try:
            return self.get_response(request)
        finally:
            _local.request = None


def get_current_request():
    return getattr(_local, "request", None)


def client_ip():
    """
    The real client address, preferring X-Forwarded-For's first hop (Render
    and most hosts sit behind a proxy, so REMOTE_ADDR alone would just be
    that proxy) and falling back to REMOTE_ADDR for local/direct requests.
    """
    request = get_current_request()
    if not request:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
