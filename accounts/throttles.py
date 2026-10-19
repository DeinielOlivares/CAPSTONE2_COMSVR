from rest_framework.throttling import SimpleRateThrottle


class ResetRequestEmailThrottle(SimpleRateThrottle):
    """
    Limits code/link requests per *email address* (on top of the per-IP limit),
    so someone switching IP addresses still can't flood one person's inbox.
    Rate: "reset_request_email" in settings.REST_FRAMEWORK.
    """

    scope = "reset_request_email"

    def get_cache_key(self, request, view):
        data = request.data
        email = str(data.get("email", "")).strip().lower() if hasattr(data, "get") else ""
        if not email:
            return None  # nothing to count by; the per-IP limit still applies
        return self.cache_format % {"scope": self.scope, "ident": email}
