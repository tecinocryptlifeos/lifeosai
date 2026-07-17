import base64
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date, datetime, timedelta, timezone


def _env(name):
    return os.environ.get(name, "").strip()


def _enabled(name):
    return _env(name).lower() in {"1", "true", "yes", "on"}


def _public_key():
    return _env("SUPABASE_PUBLISHABLE_KEY") or _env("SUPABASE_ANON_KEY")


def _server_key():
    return _env("SUPABASE_SECRET_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")


def configured():
    return bool(_env("SUPABASE_URL") and _public_key() and _server_key())


def _integer_setting(name, default, minimum, maximum):
    try:
        value = int(_env(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def public_config():
    email_enabled = _enabled("LIFEOS_EMAIL_AUTH_ENABLED")
    return {
        "ok": True,
        "configured": configured(),
        "supabase_url": _env("SUPABASE_URL"),
        "supabase_anon_key": _public_key(),
        "auth_required": True,
        "auth_mode": "mandatory",
        "email_enabled": email_enabled,
        "registration_enabled": email_enabled and _enabled("LIFEOS_REGISTRATION_ENABLED"),
        "google_enabled": _enabled("LIFEOS_GOOGLE_AUTH_ENABLED"),
        "minimum_age": _integer_setting("LIFEOS_MINIMUM_AGE", 13, 13, 18),
        "password_min_length": _integer_setting("LIFEOS_PASSWORD_MIN_LENGTH", 10, 8, 128),
    }


def _request(url, method="GET", headers=None, payload=None, timeout=15):
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read()
            return response.status, json.loads(raw.decode("utf-8") or "{}")
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            data = json.loads(raw)
        except Exception:
            data = {"error": raw[:500]}
        return error.code, data


def bearer(headers):
    value = (headers.get("Authorization") or "").strip()
    if not value.lower().startswith("bearer "):
        return ""
    return value[7:].strip()


def _verified_token_claims(token):
    """Decode claims only after Supabase has verified the same access token."""
    try:
        encoded = token.split(".", 2)[1]
        encoded += "=" * (-len(encoded) % 4)
        return json.loads(base64.urlsafe_b64decode(encoded).decode("utf-8"))
    except Exception:
        return {}


def _access_metadata(user):
    value = user.get("app_metadata")
    return value if isinstance(value, dict) else {}


def _enforce_lifeos_access(user, token):
    metadata = _access_metadata(user)
    if metadata.get("lifeos_access_blocked") is True:
        raise PermissionError(
            "This LifeOS account has been blocked by an administrator."
        )
    try:
        issued_at = int(_verified_token_claims(token).get("iat") or 0)
        valid_after = int(metadata.get("lifeos_session_not_before") or 0)
    except (TypeError, ValueError):
        issued_at = 0
        valid_after = 0
    if valid_after and issued_at <= valid_after:
        raise PermissionError(
            "This LifeOS session was signed out by an administrator. Sign in again."
        )


def verify_user(headers):
    if not configured():
        raise RuntimeError("LifeOS authentication is not configured")
    token = bearer(headers)
    if not token:
        raise PermissionError("Sign-in is required")
    status, user = _request(
        _env("SUPABASE_URL").rstrip("/") + "/auth/v1/user",
        headers={"apikey": _public_key(), "Authorization": "Bearer " + token},
    )
    if status != 200 or not user.get("id"):
        raise PermissionError("The sign-in session is invalid or expired")
    _enforce_lifeos_access(user, token)
    return user, token


def is_admin(user):
    allowed = {item.strip().lower() for item in _env("LIFEOS_ADMIN_EMAILS").split(",") if item.strip()}
    return bool(user.get("email") and user["email"].lower() in allowed)


def _rest(table, method="GET", query="", payload=None, prefer="return=minimal"):
    url = _env("SUPABASE_URL").rstrip("/") + "/rest/v1/" + table
    if query:
        url += "?" + query
    key = _server_key()
    headers = {"apikey": key, "Prefer": prefer}
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    return _request(url, method=method, headers=headers, payload=payload)


def _auth_admin_request(path, method="GET", payload=None):
    """Call Supabase Auth Admin from the server; the secret never reaches a browser."""
    key = _server_key()
    headers = {
        "apikey": key,
        "User-Agent": "LifeOS-Admin/2.0.6",
    }
    if not key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + key
    url = _env("SUPABASE_URL").rstrip("/") + "/auth/v1/admin/" + path.lstrip("/")
    return _request(url, method=method, headers=headers, payload=payload)


def _user_id(value):
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError):
        raise ValueError("A valid user ID is required")


def _auth_user(user_id):
    status, data = _auth_admin_request("users/" + _user_id(user_id))
    if status != 200 or not isinstance(data, dict) or not data.get("id"):
        raise RuntimeError("The selected user account could not be loaded")
    return data


def _auth_users():
    status, data = _auth_admin_request("users?page=1&per_page=250")
    if status != 200:
        return []
    if isinstance(data, dict) and isinstance(data.get("users"), list):
        return data["users"]
    return data if isinstance(data, list) else []


PROFILE_REQUIRED_FIELDS = ("first_name", "surname", "date_of_birth", "country")


def _clean_profile_text(value, maximum=160):
    return " ".join(str(value or "").split())[:maximum]


def _birth_date(value):
    raw = str(value or "").strip()
    try:
        parsed = date.fromisoformat(raw)
    except (TypeError, ValueError):
        raise ValueError("Enter a valid date of birth")
    if parsed > date.today():
        raise ValueError("Date of birth cannot be in the future")
    return parsed


def _age_on(birth_date, today=None):
    today = today or date.today()
    return today.year - birth_date.year - (
        (today.month, today.day) < (birth_date.month, birth_date.day)
    )


def _profile_payload(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid profile request")
    first_name = _clean_profile_text(payload.get("first_name"), 80)
    surname = _clean_profile_text(payload.get("surname"), 80)
    country = _clean_profile_text(payload.get("country"), 100)
    phone = _clean_profile_text(payload.get("phone"), 40) or None
    if not first_name:
        raise ValueError("First name is required")
    if not surname:
        raise ValueError("Surname is required")
    if not country:
        raise ValueError("Country is required")
    birth = _birth_date(payload.get("date_of_birth"))
    minimum_age = _integer_setting("LIFEOS_MINIMUM_AGE", 13, 13, 18)
    if _age_on(birth) < minimum_age:
        raise ValueError(
            f"LifeOS accounts require a minimum age of {minimum_age}"
        )
    if payload.get("accept_terms") is not True:
        raise ValueError("Accept the Terms and Privacy Policy to continue")
    return {
        "first_name": first_name,
        "surname": surname,
        "full_name": f"{first_name} {surname}",
        "date_of_birth": birth.isoformat(),
        "country": country,
        "phone": phone,
        "terms_accepted_at": datetime.now(timezone.utc).isoformat(),
        "minimum_age_confirmed": True,
    }


def _profile_complete(profile):
    if not isinstance(profile, dict):
        return False
    if any(not str(profile.get(field) or "").strip() for field in PROFILE_REQUIRED_FIELDS):
        return False
    if not profile.get("terms_accepted_at"):
        return False
    try:
        birth = _birth_date(profile.get("date_of_birth"))
    except ValueError:
        return False
    return _age_on(birth) >= _integer_setting("LIFEOS_MINIMUM_AGE", 13, 13, 18)


def account_profile(user):
    user_id = _user_id(user.get("id"))
    status, rows = _rest(
        "lifeos_profiles",
        query=urllib.parse.urlencode({
            "select": "user_id,email,display_name,first_name,surname,date_of_birth,country,phone,terms_accepted_at,created_at,last_sign_in_at,account_status",
            "user_id": "eq." + user_id,
            "limit": "1",
        }),
    )
    if status != 200 or not isinstance(rows, list):
        raise RuntimeError("The LifeOS account profile could not be loaded")
    profile = rows[0] if rows else {
        "user_id": user_id,
        "email": user.get("email"),
        "display_name": (user.get("user_metadata") or {}).get("full_name") or "",
        "first_name": (user.get("user_metadata") or {}).get("first_name") or "",
        "surname": (user.get("user_metadata") or {}).get("surname") or "",
        "date_of_birth": (user.get("user_metadata") or {}).get("date_of_birth"),
        "country": (user.get("user_metadata") or {}).get("country") or "",
        "phone": (user.get("user_metadata") or {}).get("phone") or "",
        "terms_accepted_at": (user.get("user_metadata") or {}).get("terms_accepted_at"),
    }
    safe_profile = {
        "email": profile.get("email") or user.get("email"),
        "display_name": profile.get("display_name") or "",
        "first_name": profile.get("first_name") or "",
        "surname": profile.get("surname") or "",
        "date_of_birth": profile.get("date_of_birth"),
        "country": profile.get("country") or "",
        "phone": profile.get("phone") or "",
        "terms_accepted_at": profile.get("terms_accepted_at"),
    }
    return {
        "ok": True,
        "complete": _profile_complete(safe_profile),
        "minimum_age": _integer_setting("LIFEOS_MINIMUM_AGE", 13, 13, 18),
        "profile": safe_profile,
    }


def update_account_profile(user, payload):
    values = _profile_payload(payload)
    current_metadata = user.get("user_metadata")
    metadata = dict(current_metadata) if isinstance(current_metadata, dict) else {}
    metadata.update(values)
    status, updated = _auth_admin_request(
        "users/" + _user_id(user.get("id")),
        method="PUT",
        payload={"user_metadata": metadata},
    )
    if status != 200 or not isinstance(updated, dict):
        raise RuntimeError("The LifeOS account profile could not be updated")
    result = account_profile(updated)
    if not result.get("complete"):
        raise RuntimeError("The LifeOS account profile remains incomplete")
    return result


def require_complete_profile(user):
    result = account_profile(user)
    if not result.get("complete"):
        raise PermissionError("Complete your LifeOS profile before using Sophia")
    return result


def _safe_error_fields(event_type, payload):
    """Classify client diagnostics without retaining arbitrary user-supplied text."""
    if event_type not in {"voice_error", "microphone_error", "audio_error"}:
        return None, None
    raw_code = str(payload.get("error_code") or "").strip()
    error_code = raw_code[:60] if re.fullmatch(r"[A-Za-z0-9_.:\- ]{1,60}", raw_code) else None
    raw = " ".join(str(payload.get("error_message") or "").split()).lower()
    combined = " ".join((raw_code.lower(), raw, event_type))
    if "1008" in combined:
        return error_code or "1008", "Gemini Live connection closed with code 1008."
    if "goaway" in combined or "go away" in combined:
        return error_code or "GOAWAY", "Gemini Live requested an orderly session handover."
    if "notallowed" in combined or "permission" in combined or "microphone" in combined:
        return error_code or "MICROPHONE", "Browser microphone access failed."
    if "audio" in combined or "speaker" in combined or "output" in combined:
        return error_code or "AUDIO_OUTPUT", "Sophia audio output routing failed."
    if "429" in combined or "quota" in combined or "demand" in combined:
        return error_code or "RATE_LIMIT", "The intelligence provider temporarily limited the request."
    if "401" in combined or "403" in combined or "auth" in combined or "session" in combined:
        return error_code or "AUTH", "The account session was rejected or expired."
    if "503" in combined or "unavailable" in combined:
        return error_code or "UNAVAILABLE", "The upstream intelligence service was unavailable."
    return error_code or event_type.upper(), "A protected LifeOS interface reported an operational error."


def record_event(user, payload, client_ip=""):
    allowed = {
        "sign_in", "sign_out", "voice_start", "voice_connected", "voice_end",
        "voice_error", "microphone_error", "audio_error", "chat_message", "page_view",
        "admin_block", "admin_unblock", "admin_session_revoke"
    }
    event_type = str(payload.get("event_type") or "").strip().lower()
    if event_type not in allowed:
        raise ValueError("Unsupported event type")
    supplied_metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    permitted_metadata = {
        "route", "transport", "reason", "status", "language", "model",
        "target_user_id", "target_email", "action",
    }
    metadata = {
        key: str(value)[:160]
        for key, value in supplied_metadata.items()
        if key in permitted_metadata and value is not None
    }
    error_code, error_message = _safe_error_fields(event_type, payload)
    row = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "event_type": event_type,
        "session_id": str(payload.get("session_id") or "")[:100] or None,
        "error_code": error_code,
        "error_message": error_message,
        "device_type": str(payload.get("device_type") or "")[:80] or None,
        "browser": str(payload.get("browser") or "")[:160] or None,
        "client_ip": client_ip[:80] or None,
        "metadata": metadata,
    }
    status, data = _rest("lifeos_events", method="POST", payload=row)
    if status not in (200, 201):
        raise RuntimeError("Event logging failed: " + str(data)[:400])
    return {"ok": True}


def manage_user(actor, payload):
    if not is_admin(actor):
        raise PermissionError("Administrator access is required")
    if not isinstance(payload, dict):
        raise ValueError("Invalid administration request")
    action = str(payload.get("action") or "").strip().lower()
    if action not in {"block", "unblock", "sign_out"}:
        raise ValueError("Unsupported administration action")

    target = _auth_user(payload.get("user_id"))
    if target.get("id") == actor.get("id"):
        raise PermissionError("Administrators cannot change their own access here")
    if is_admin(target):
        raise PermissionError("Administrator accounts cannot be managed from this panel")

    app_metadata = dict(_access_metadata(target))
    now = datetime.now(timezone.utc)
    now_epoch = int(now.timestamp())
    attributes = {"app_metadata": app_metadata}
    event_type = ""

    if action == "block":
        app_metadata.update({
            "lifeos_access_blocked": True,
            "lifeos_access_blocked_at": now.isoformat(),
            "lifeos_session_not_before": now_epoch,
        })
        attributes["ban_duration"] = "876000h"
        event_type = "admin_block"
    elif action == "unblock":
        app_metadata.update({
            "lifeos_access_blocked": False,
            "lifeos_access_unblocked_at": now.isoformat(),
        })
        attributes["ban_duration"] = "none"
        event_type = "admin_unblock"
    else:
        app_metadata["lifeos_session_not_before"] = now_epoch
        event_type = "admin_session_revoke"

    status, _updated = _auth_admin_request(
        "users/" + target["id"],
        method="PUT",
        payload=attributes,
    )
    if status != 200:
        raise RuntimeError("The administration action could not be completed")

    record_event(actor, {
        "event_type": event_type,
        "metadata": {
            "route": "/admin",
            "action": action,
            "target_user_id": target["id"],
            "target_email": target.get("email") or "",
            "status": "completed",
        },
    })
    return {
        "ok": True,
        "action": action,
        "user": {
            "user_id": target["id"],
            "email": target.get("email"),
            "account_status": "blocked" if action == "block" else "active",
        },
    }


def _error_insight(event):
    code = str(event.get("error_code") or "").lower()
    message = str(event.get("error_message") or "").lower()
    event_type = str(event.get("event_type") or "").lower()
    combined = " ".join((code, message, event_type))
    if "1008" in combined or "goaway" in combined or "go away" in combined:
        explanation = "The live provider requested an orderly session handover."
        action = "Confirm automatic renewal succeeded; ask the user to restart only if it did not."
    elif "microphone" in combined or "notallowed" in combined or "permission" in combined:
        explanation = "The browser could not start or retain microphone access."
        action = "Check site microphone permission, Android privacy controls, and the active input device."
    elif "audio" in combined or "speaker" in combined or "output" in combined:
        explanation = "Sophia audio could not be routed to the selected output."
        action = "Return output to phone default, raise Voice Volume, and retry the session."
    elif "401" in combined or "session" in combined or "auth" in combined:
        explanation = "The account session was missing, expired, revoked, or rejected."
        action = "Ask the user to sign in again; check block status before further troubleshooting."
    elif "429" in combined or "demand" in combined or "quota" in combined:
        explanation = "The intelligence provider temporarily limited the request."
        action = "Wait briefly and retry; compare the time with provider usage and service logs."
    else:
        explanation = "An operational failure was reported by the protected LifeOS interface."
        action = "Open the details, note the time and surface, then reproduce once before changing code."
    return {
        "id": event.get("id"),
        "created_at": event.get("created_at"),
        "user_email": event.get("user_email"),
        "event_type": event.get("event_type"),
        "error_code": event.get("error_code"),
        "error_message": event.get("error_message"),
        "device_type": event.get("device_type"),
        "browser": event.get("browser"),
        "session_id": event.get("session_id"),
        "route": (event.get("metadata") or {}).get("route")
            if isinstance(event.get("metadata"), dict) else None,
        "explanation": explanation,
        "recommended_action": action,
    }


def admin_dashboard(user):
    if not is_admin(user):
        raise PermissionError("Administrator access is required")
    status, events = _rest(
        "lifeos_events",
        query=urllib.parse.urlencode({"select":"id,user_id,user_email,event_type,session_id,error_code,error_message,device_type,browser,metadata,created_at", "order":"created_at.desc", "limit":"250"}),
        prefer="count=exact",
    )
    if status != 200:
        raise RuntimeError("Could not load analytics: " + str(events)[:400])
    status2, profiles = _rest(
        "lifeos_profiles",
        query=urllib.parse.urlencode({"select":"user_id,email,display_name,first_name,surname,date_of_birth,country,phone,terms_accepted_at,created_at,last_sign_in_at,account_status", "order":"last_sign_in_at.desc.nullslast", "limit":"250"}),
        prefer="count=exact",
    )
    if status2 != 200:
        raise RuntimeError("Could not load users: " + str(profiles)[:400])
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    signed = [e for e in events if e.get("event_type") == "sign_in"]
    starts = [e for e in events if e.get("event_type") == "voice_start"]
    chat_messages = [e for e in events if e.get("event_type") == "chat_message"]
    errors = [
        e for e in events
        if e.get("event_type", "").endswith("error")
        or e.get("error_code")
        or e.get("error_message")
    ]
    active_since = (now - timedelta(hours=24)).isoformat()
    active_ids = {
        e.get("user_id")
        for e in events
        if e.get("created_at", "") >= active_since
        and e.get("event_type") in {"voice_start", "voice_connected", "chat_message", "page_view"}
    }
    auth_users = _auth_users()
    if auth_users:
        profiles = [{
            "user_id": item.get("id"),
            "email": item.get("email"),
            "display_name": (
                (item.get("user_metadata") or {}).get("full_name")
                or (item.get("user_metadata") or {}).get("name")
                or ""
            ),
            "first_name": (item.get("user_metadata") or {}).get("first_name") or "",
            "surname": (item.get("user_metadata") or {}).get("surname") or "",
            "date_of_birth": (item.get("user_metadata") or {}).get("date_of_birth") or None,
            "country": (item.get("user_metadata") or {}).get("country") or "",
            "phone": (item.get("user_metadata") or {}).get("phone") or "",
            "terms_accepted_at": (item.get("user_metadata") or {}).get("terms_accepted_at") or None,
            "created_at": item.get("created_at"),
            "last_sign_in_at": item.get("last_sign_in_at"),
            "account_status": (
                "blocked"
                if (item.get("app_metadata") or {}).get("lifeos_access_blocked") is True
                else "active"
            ),
            "can_manage": item.get("id") != user.get("id") and not is_admin(item),
        } for item in auth_users]
    else:
        for profile in profiles:
            profile["can_manage"] = (
                profile.get("user_id") != user.get("id")
                and not is_admin(profile)
            )

    return {
        "ok": True,
        "metrics": {
            "registered_users": len(profiles),
            "sign_ins_today": sum(1 for e in signed if str(e.get("created_at", "")).startswith(today)),
            "voice_sessions_today": sum(1 for e in starts if str(e.get("created_at", "")).startswith(today)),
            "chat_messages_today": sum(1 for e in chat_messages if str(e.get("created_at", "")).startswith(today)),
            "active_users_24h": len(active_ids),
            "recent_errors": len(errors),
        },
        "users": profiles,
        "events": events,
        "errors": [_error_insight(event) for event in errors],
    }
