from rest_framework.throttling import SimpleRateThrottle


class ResetRequestEmailThrottle(SimpleRateThrottle):
    """
    Limits Forgot Password code requests per *email address*, on top of the
    per-IP limit (ScopedRateThrottle): an attacker rotating IPs could otherwise
    still flood one victim's inbox, or keep minting fresh codes — each with its
    own set of guesses — for that account.
    """

    scope = "reset_request_email"

    def get_cache_key(self, request, view):
        data = request.data
        email = str(data.get("email", "")).strip().lower() if hasattr(data, "get") else ""
        if not email:
            return None  # nothing to key on; the per-IP limit and validation still apply
        return self.cache_format % {"scope": self.scope, "ident": email}
