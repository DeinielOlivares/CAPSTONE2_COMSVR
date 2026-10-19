"""
Remembers the current request so log_action() (accounts/models.py) can record
the caller's IP address without every view having to pass the request along.
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
    The visitor's IP address. Behind a proxy (like Render) the real address is
    the first one in X-Forwarded-For; otherwise it's REMOTE_ADDR.
    """
    request = get_current_request()
    if not request:
        return None
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
