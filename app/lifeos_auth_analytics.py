import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def _env(name):
    return os.environ.get(name, "").strip()


def configured():
    return bool(_env("SUPABASE_URL") and _env("SUPABASE_ANON_KEY") and _env("SUPABASE_SERVICE_ROLE_KEY"))


def public_config():
    return {
        "ok": True,
        "configured": configured(),
        "supabase_url": _env("SUPABASE_URL"),
        "supabase_anon_key": _env("SUPABASE_ANON_KEY"),
        "auth_required": _env("LIFEOS_AUTH_REQUIRED").lower() not in {"0", "false", "no", "off"},
        "google_enabled": _env("LIFEOS_GOOGLE_AUTH_ENABLED").lower() in {"1", "true", "yes", "on"},
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


def verify_user(headers):
    if not configured():
        raise RuntimeError("LifeOS authentication is not configured")
    token = bearer(headers)
    if not token:
        raise PermissionError("Sign-in is required")
    status, user = _request(
        _env("SUPABASE_URL").rstrip("/") + "/auth/v1/user",
        headers={"apikey": _env("SUPABASE_ANON_KEY"), "Authorization": "Bearer " + token},
    )
    if status != 200 or not user.get("id"):
        raise PermissionError("The sign-in session is invalid or expired")
    return user, token


def is_admin(user):
    allowed = {item.strip().lower() for item in _env("LIFEOS_ADMIN_EMAILS").split(",") if item.strip()}
    return bool(user.get("email") and user["email"].lower() in allowed)


def _rest(table, method="GET", query="", payload=None, prefer="return=minimal"):
    url = _env("SUPABASE_URL").rstrip("/") + "/rest/v1/" + table
    if query:
        url += "?" + query
    key = _env("SUPABASE_SERVICE_ROLE_KEY")
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Prefer": prefer}
    return _request(url, method=method, headers=headers, payload=payload)


def record_event(user, payload, client_ip=""):
    allowed = {
        "sign_in", "sign_out", "voice_start", "voice_connected", "voice_end",
        "voice_error", "microphone_error", "audio_error", "page_view"
    }
    event_type = str(payload.get("event_type") or "").strip().lower()
    if event_type not in allowed:
        raise ValueError("Unsupported event type")
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    metadata = dict(list(metadata.items())[:20])
    row = {
        "user_id": user["id"],
        "user_email": user.get("email"),
        "event_type": event_type,
        "session_id": str(payload.get("session_id") or "")[:100] or None,
        "error_code": str(payload.get("error_code") or "")[:120] or None,
        "error_message": str(payload.get("error_message") or "")[:800] or None,
        "device_type": str(payload.get("device_type") or "")[:80] or None,
        "browser": str(payload.get("browser") or "")[:160] or None,
        "client_ip": client_ip[:80] or None,
        "metadata": metadata,
    }
    status, data = _rest("lifeos_events", method="POST", payload=row)
    if status not in (200, 201):
        raise RuntimeError("Event logging failed: " + str(data)[:400])
    return {"ok": True}


def admin_dashboard(user):
    if not is_admin(user):
        raise PermissionError("Administrator access is required")
    status, events = _rest(
        "lifeos_events",
        query=urllib.parse.urlencode({"select":"id,user_id,user_email,event_type,session_id,error_code,error_message,device_type,browser,created_at", "order":"created_at.desc", "limit":"250"}),
        prefer="count=exact",
    )
    if status != 200:
        raise RuntimeError("Could not load analytics: " + str(events)[:400])
    status2, profiles = _rest(
        "lifeos_profiles",
        query=urllib.parse.urlencode({"select":"user_id,email,display_name,created_at,last_sign_in_at,account_status", "order":"last_sign_in_at.desc.nullslast", "limit":"250"}),
        prefer="count=exact",
    )
    if status2 != 200:
        raise RuntimeError("Could not load users: " + str(profiles)[:400])
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    signed = [e for e in events if e.get("event_type") == "sign_in"]
    starts = [e for e in events if e.get("event_type") == "voice_start"]
    errors = [e for e in events if e.get("event_type", "").endswith("error")]
    active_ids = {e.get("user_id") for e in events if e.get("created_at", "") >= now.isoformat()[:13] and e.get("event_type") in {"voice_start","voice_connected","page_view"}}
    return {
        "ok": True,
        "metrics": {
            "registered_users": len(profiles),
            "sign_ins_today": sum(1 for e in signed if str(e.get("created_at", "")).startswith(today)),
            "voice_sessions_today": sum(1 for e in starts if str(e.get("created_at", "")).startswith(today)),
            "recent_active_users": len(active_ids),
            "recent_errors": len(errors),
        },
        "users": profiles,
        "events": events,
    }
