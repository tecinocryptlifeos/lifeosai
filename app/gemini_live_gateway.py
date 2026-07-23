"""Gemini Live ephemeral-token support for LifeOS.

This gateway keeps the long-lived Gemini API key on the server, issues
short-lived constrained tokens to authenticated LOSAI users, and exposes a
primary/fallback model policy for resilient browser-side Live API sessions.
"""

from __future__ import annotations

import datetime
import importlib.util
import os
import threading
import time


PRIMARY_MODEL = os.environ.get(
    "LIFEOS_GEMINI_LIVE_PRIMARY_MODEL",
    "gemini-3.1-flash-live-preview",
).strip()

# The former LIFEOS_GEMINI_LIVE_MODEL variable is intentionally treated as a
# compatibility fallback. Existing Render deployments that were temporarily
# pinned to Gemini 2.5 therefore gain Gemini 3.1 as primary without losing the
# proven 2.5 recovery path.
FALLBACK_MODEL = os.environ.get(
    "LIFEOS_GEMINI_LIVE_FALLBACK_MODEL",
    os.environ.get(
        "LIFEOS_GEMINI_LIVE_MODEL",
        "gemini-2.5-flash-native-audio-preview-12-2025",
    ),
).strip()

MODEL = PRIMARY_MODEL
WEBSOCKET_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService."
    "BidiGenerateContentConstrained"
)

_RATE_LOCK = threading.Lock()
_LAST_ISSUE_TIME: dict[str, float] = {}
_TOKEN_COOLDOWN_SECONDS = 5.0


class GeminiLiveRateLimit(RuntimeError):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, int(retry_after))
        super().__init__("Please wait before starting another Gemini Live session.")


def _sdk_available() -> bool:
    try:
        return importlib.util.find_spec("google.genai") is not None
    except (ImportError, AttributeError, ModuleNotFoundError, ValueError):
        return False


def _normalise_model_preference(model_preference: str | None) -> str:
    preference = str(model_preference or "primary").strip().lower()
    if preference not in {"primary", "fallback"}:
        return "primary"
    if preference == "fallback" and not FALLBACK_MODEL:
        return "primary"
    return preference


def _model_for_preference(model_preference: str | None) -> tuple[str, str]:
    preference = _normalise_model_preference(model_preference)
    model = FALLBACK_MODEL if preference == "fallback" else PRIMARY_MODEL
    if not model:
        raise RuntimeError("The selected Gemini Live model is not configured.")
    return preference, model


def gemini_live_status() -> dict[str, object]:
    fallback_enabled = bool(FALLBACK_MODEL and FALLBACK_MODEL != PRIMARY_MODEL)
    return {
        "ok": True,
        "gemini_live": True,
        "version": "2.0.0",
        "model": PRIMARY_MODEL,
        "primary_model": PRIMARY_MODEL,
        "fallback_model": FALLBACK_MODEL if fallback_enabled else None,
        "fallback_enabled": fallback_enabled,
        "capacity_profile": "primary-with-automatic-fallback",
        "thinking_level": "medium",
        "transport": "websocket",
        "authentication": "constrained-ephemeral-token",
        "gemini_key_configured": bool(
            os.environ.get("GEMINI_API_KEY", "").strip()
        ),
        "google_genai_sdk_available": _sdk_available(),
    }


def create_gemini_live_token(
    client_id: str = "unknown",
    model_preference: str = "primary",
) -> dict[str, object]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server.")

    preference, selected_model = _model_for_preference(model_preference)
    client_id = str(client_id or "unknown")[:120]
    rate_key = f"{client_id}:{preference}"
    now_monotonic = time.monotonic()

    with _RATE_LOCK:
        previous = _LAST_ISSUE_TIME.get(rate_key, 0.0)
        elapsed = now_monotonic - previous
        if elapsed < _TOKEN_COOLDOWN_SECONDS:
            raise GeminiLiveRateLimit(_TOKEN_COOLDOWN_SECONDS - elapsed)
        _LAST_ISSUE_TIME[rate_key] = now_monotonic

    try:
        from google import genai
        from google.genai import types
    except ImportError as error:
        raise RuntimeError("google-genai is not installed on the server.") from error

    now = datetime.datetime.now(datetime.timezone.utc)
    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(api_version="v1alpha"),
    )

    try:
        token = client.auth_tokens.create(
            config={
                "uses": 1,
                "expire_time": now + datetime.timedelta(minutes=30),
                "new_session_expire_time": now + datetime.timedelta(minutes=1),
                # Lock the ephemeral token to the selected model and the audio
                # session contract while allowing the authenticated client to
                # add LOSAI's system instruction, voice, tools and VAD settings.
                "live_connect_constraints": {
                    "model": selected_model,
                    "config": {
                        "session_resumption": {},
                        "response_modalities": ["AUDIO"],
                    },
                },
                "lock_additional_fields": [],
                "http_options": {"api_version": "v1alpha"},
            }
        )
        token_name = str(getattr(token, "name", "") or "").strip()
        if not token_name:
            raise RuntimeError("Gemini returned an empty ephemeral token.")

        fallback_enabled = bool(
            FALLBACK_MODEL and FALLBACK_MODEL != PRIMARY_MODEL
        )
        return {
            "ok": True,
            "token": token_name,
            "model": selected_model,
            "model_preference": preference,
            "primary_model": PRIMARY_MODEL,
            "fallback_model": FALLBACK_MODEL if fallback_enabled else None,
            "fallback_available": fallback_enabled,
            "thinking_level": "medium",
            "websocket_url": WEBSOCKET_URL,
            "gateway_version": "2.0.0",
        }
    finally:
        try:
            client.close()
        except Exception:
            pass
