from functools import wraps

from django.conf import settings
from django.http import JsonResponse
from google.auth.transport.requests import Request
from google.oauth2.id_token import verify_oauth2_token


def service_identity(view):
    @wraps(view)
    def guarded(request, *args, **kwargs):
        audience = getattr(settings, "PETE_INTAKE_AUDIENCE", "")
        allowed = getattr(settings, "PETE_INTAKE_ALLOWED_SERVICE_ACCOUNTS", [])
        header = request.headers.get("Authorization", "")
        def denied():
            result = JsonResponse({"error": "Service identity required."}, status=403)
            result["Cache-Control"] = "no-store"
            return result
        if (not isinstance(audience, str) or not audience or not isinstance(allowed, (list, tuple, set))
                or not allowed or not all(isinstance(email, str) and email.endswith(".iam.gserviceaccount.com") for email in allowed)
                or not header.startswith("Bearer ")):
            return denied()
        try:
            claims = verify_oauth2_token(header[7:], Request(), audience=audience)
            if claims.get("aud") != audience or claims.get("email_verified") is not True or claims.get("email") not in allowed:
                raise ValueError("Identity mismatch")
        except Exception:
            # Never log tokens or customer payloads on a failed request.
            return denied()
        return view(request, *args, **kwargs)
    return guarded
