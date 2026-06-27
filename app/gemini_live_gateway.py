"""Gemini Live ephemeral-token support for LifeOS."""

from __future__ import annotations

import datetime
import importlib.util
import os
import threading
import time


MODEL = os.environ.get(
    "LIFEOS_GEMINI_LIVE_MODEL",
    "gemini-3.1-flash-live-preview",
).strip()

WEBSOCKET_URL = (
    "wss://generativelanguage.googleapis.com/ws/"
    "google.ai.generativelanguage.v1alpha.GenerativeService."
    "BidiGenerateContentConstrained"
)

_RATE_LOCK = threading.Lock()
_LAST_ISSUE_TIME: dict[str, float] = {}


class GeminiLiveRateLimit(RuntimeError):
    def __init__(self, retry_after: int) -> None:
        self.retry_after = max(1, int(retry_after))
        super().__init__("Please wait before starting another Gemini Live session.")


def _sdk_available() -> bool:
    try:
        return importlib.util.find_spec("google.genai") is not None
    except (ImportError, AttributeError, ModuleNotFoundError):
        return False


def gemini_live_status() -> dict[str, object]:
    return {
        "ok": True,
        "gemini_live": True,
        "version": "1.0.0",
        "model": MODEL,
        "transport": "websocket",
        "authentication": "ephemeral-token",
        "gemini_key_configured": bool(
            os.environ.get("GEMINI_API_KEY", "").strip()
        ),
        "google_genai_sdk_available": _sdk_available(),
    }


def create_gemini_live_token(client_id: str = "unknown") -> dict[str, object]:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured on the server.")

    client_id = str(client_id or "unknown")[:120]
    now_monotonic = time.monotonic()

    with _RATE_LOCK:
        previous = _LAST_ISSUE_TIME.get(client_id, 0.0)
        elapsed = now_monotonic - previous
        if elapsed < 5.0:
            raise GeminiLiveRateLimit(5.0 - elapsed)
        _LAST_ISSUE_TIME[client_id] = now_monotonic

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
                "http_options": {"api_version": "v1alpha"},
            }
        )
        token_name = str(getattr(token, "name", "") or "").strip()
        if not token_name:
            raise RuntimeError("Gemini returned an empty ephemeral token.")

        return {
            "ok": True,
            "token": token_name,
            "model": MODEL,
            "websocket_url": WEBSOCKET_URL,
        }
    finally:
        try:
            client.close()
        except Exception:
            pass
