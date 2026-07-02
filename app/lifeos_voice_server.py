import os
import json
import time
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote
import uuid


# LIFEOS_GEMINI_LIVE_V1_IMPORT_START
try:
    from gemini_live_gateway import (
        GeminiLiveRateLimit,
        create_gemini_live_token,
        gemini_live_status,
    )
except ImportError:
    from app.gemini_live_gateway import (
        GeminiLiveRateLimit,
        create_gemini_live_token,
        gemini_live_status,
    )
# LIFEOS_GEMINI_LIVE_V1_IMPORT_END

try:
    from gemini_client import GeminiClient
except ImportError:
    from app.gemini_client import GeminiClient

try:
    from lifeos_public_tts import generate_lifeos_voice_wav
except ImportError:
    from app.lifeos_public_tts import generate_lifeos_voice_wav


BASE_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = BASE_DIR / "web" / "lifeos_voice"
WEB_FILE = WEB_DIR / "index.html"
AUDIO_DIR = WEB_DIR / "audio"

HOST = os.environ.get("LIFEOS_HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT") or os.environ.get("LIFEOS_PORT") or "8787")

AUDIO_DIR.mkdir(parents=True, exist_ok=True)


SYSTEM_STYLE = """
You are LifeOS AI, a premium synthetic decision-intelligence assistant.

Analyze the user's decision with strong practical judgement.
Be direct, useful, and future-facing.

Return a concise decision audit using this structure:

Verdict:
Reality Check:
Main Risk:
Better Move:
Next Action:
Final Truth:

Keep it sharp, serious, premium, and practical.
"""


TONE_MAP = {
    "london": (
        "Use calm London English wording. Sound like a composed British female executive advisor. "
        "Measured, elegant, intelligent, and human. Avoid robotic phrasing."
    ),
    "executive": (
        "Use a boardroom-level executive tone. Concise, premium, strategic, and decisive."
    ),
    "calm": (
        "Use a calm reassuring female advisor tone. Gentle, mature, clear, and emotionally steady."
    ),
    "direct": (
        "Use a direct truth-teller tone. Clear, firm, no fluff, no sugarcoating."
    ),
}


# LIFEOS_VOICE_CONVERSATION_REPAIR_V13
# LIFEOS_VOICE_CONVERSATION_REPAIR_V14
# LIFEOS_REALTIME_GATEWAY_V1
def lifeos_realtime_json(handler, status, payload):
    import json

    body = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")

    handler.send_response(status)
    handler.send_header(
        "Content-Type",
        "application/json; charset=utf-8",
    )
    handler.send_header(
        "Content-Length",
        str(len(body)),
    )
    handler.send_header(
        "Cache-Control",
        "no-store",
    )
    handler.send_header(
        "X-LifeOS-Realtime-Gateway",
        "1",
    )
    handler.end_headers()
    handler.wfile.write(body)


def lifeos_handle_realtime_session(handler):
    import hashlib
    import json
    import os
    import secrets
    import time
    import urllib.error
    import urllib.request

    content_type = (
        handler.headers.get("Content-Type", "")
        .split(";", 1)[0]
        .strip()
        .lower()
    )

    if content_type not in {
        "application/sdp",
        "text/plain",
    }:
        return lifeos_realtime_json(
            handler,
            415,
            {
                "error": "unsupported_media_type",
                "expected": "application/sdp",
            },
        )

    try:
        content_length = int(
            handler.headers.get(
                "Content-Length",
                "",
            )
        )
    except (TypeError, ValueError):
        return lifeos_realtime_json(
            handler,
            411,
            {
                "error": "content_length_required",
            },
        )

    if (
        content_length < 1
        or content_length > 131072
    ):
        return lifeos_realtime_json(
            handler,
            413,
            {
                "error": "invalid_sdp_size",
            },
        )

    offer = handler.rfile.read(
        content_length
    )

    if not offer.strip():
        return lifeos_realtime_json(
            handler,
            400,
            {
                "error": "empty_sdp_offer",
            },
        )

    origin = (
        handler.headers
        .get("Origin", "")
        .rstrip("/")
    )

    allowed_origins = {
        item.strip().rstrip("/")
        for item in os.environ.get(
            "LIFEOS_ALLOWED_ORIGINS",
            (
                "https://"
                "lifeos-ai-voice-app.onrender.com"
            ),
        ).split(",")
        if item.strip()
    }

    if (
        origin
        and origin not in allowed_origins
    ):
        return lifeos_realtime_json(
            handler,
            403,
            {
                "error": "origin_not_allowed",
            },
        )

    enabled = (
        os.environ.get(
            "LIFEOS_REALTIME_ENABLED",
            "false",
        )
        .strip()
        .lower()
        in {
            "1",
            "true",
            "yes",
            "on",
        }
    )

    if not enabled:
        return lifeos_realtime_json(
            handler,
            503,
            {
                "error": "realtime_disabled",
            },
        )

    client_ip = (
        handler.client_address[0]
        if getattr(
            handler,
            "client_address",
            None,
        )
        else "unknown"
    )

    now = time.monotonic()

    rate_store = getattr(
        type(handler),
        "_lifeos_realtime_rate",
        {},
    )

    recent = [
        moment
        for moment in rate_store.get(
            client_ip,
            [],
        )
        if now - moment < 60
    ]

    if len(recent) >= 5:
        return lifeos_realtime_json(
            handler,
            429,
            {
                "error":
                    "realtime_rate_limited",
            },
        )

    recent.append(now)
    rate_store[client_ip] = recent

    setattr(
        type(handler),
        "_lifeos_realtime_rate",
        rate_store,
    )

    api_key = (
        os.environ.get(
            "OPENAI_API_KEY",
            "",
        )
        .strip()
    )

    if not api_key:
        return lifeos_realtime_json(
            handler,
            503,
            {
                "error": "openai_key_missing",
            },
        )

    session = {
        "type": "realtime",
        "model": os.environ.get(
            "LIFEOS_REALTIME_MODEL",
            "gpt-realtime-2",
        ).strip(),
        "instructions": os.environ.get(
            "LIFEOS_REALTIME_INSTRUCTIONS",
            (
                "You are Sophia, the LifeOS "
                "decision-intelligence voice "
                "assistant. Listen carefully, "
                "respond naturally, preserve "
                "context, and give clear "
                "practical guidance."
            ),
        ).strip(),
        "audio": {
            "input": {
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 500,
                }
            },
            "output": {
                "voice": os.environ.get(
                    "LIFEOS_REALTIME_VOICE",
                    "marin",
                ).strip()
            },
        },
    }

    boundary = (
        "----LifeOSRealtime"
        + secrets.token_hex(16)
    )

    boundary_bytes = boundary.encode(
        "ascii"
    )

    upstream_body = b"".join(
        [
            b"--"
            + boundary_bytes
            + b"\r\n",
            (
                b"Content-Disposition: "
                b'form-data; name="sdp"\r\n'
            ),
            (
                b"Content-Type: "
                b"application/sdp\r\n\r\n"
            ),
            offer,
            b"\r\n",
            b"--"
            + boundary_bytes
            + b"\r\n",
            (
                b"Content-Disposition: "
                b'form-data; name="session"\r\n'
            ),
            (
                b"Content-Type: "
                b"application/json\r\n\r\n"
            ),
            json.dumps(
                session,
                ensure_ascii=False,
                separators=(",", ":"),
            ).encode("utf-8"),
            b"\r\n",
            b"--"
            + boundary_bytes
            + b"--\r\n",
        ]
    )

    safety_seed = (
        os.environ.get(
            "LIFEOS_SAFETY_SALT",
            "lifeos-realtime-v1",
        )
        + "|"
        + client_ip
        + "|"
        + handler.headers.get(
            "User-Agent",
            "",
        )
    )

    safety_identifier = hashlib.sha256(
        safety_seed.encode("utf-8")
    ).hexdigest()

    request = urllib.request.Request(
        (
            "https://api.openai.com/"
            "v1/realtime/calls"
        ),
        data=upstream_body,
        method="POST",
        headers={
            "Authorization":
                f"Bearer {api_key}",
            "Content-Type": (
                "multipart/form-data; "
                f"boundary={boundary}"
            ),
            "OpenAI-Safety-Identifier":
                safety_identifier,
            "User-Agent":
                "LifeOS-Realtime-Gateway/1.0",
        },
    )

    try:
        with urllib.request.urlopen(
            request,
            timeout=35,
        ) as response:
            answer = response.read(
                1048576
            )
            upstream_status = (
                response.getcode()
            )

    except urllib.error.HTTPError as error:
        return lifeos_realtime_json(
            handler,
            502,
            {
                "error":
                    "realtime_upstream_error",
                "upstream_status":
                    error.code,
            },
        )

    except Exception:
        return lifeos_realtime_json(
            handler,
            502,
            {
                "error":
                    "realtime_connection_failed",
            },
        )

    if (
        upstream_status != 200
        or not answer.strip()
    ):
        return lifeos_realtime_json(
            handler,
            502,
            {
                "error":
                    "invalid_realtime_response",
            },
        )

    handler.send_response(200)
    handler.send_header(
        "Content-Type",
        "application/sdp",
    )
    handler.send_header(
        "Content-Length",
        str(len(answer)),
    )
    handler.send_header(
        "Cache-Control",
        "no-store",
    )
    handler.send_header(
        "X-LifeOS-Realtime-Gateway",
        "1",
    )
    handler.end_headers()
    handler.wfile.write(answer)


class LifeOSVoiceHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _path(self):
        return unquote(self.path.split("?", 1)[0])

    # LIFEOS_ARCHITECTURE_FINALIZER_V1_HEADERS
    def _send_bytes(self, status, body, content_type="text/plain; charset=utf-8", extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("CDN-Cache-Control", "no-store")
        self.send_header("Surrogate-Control", "no-store")
        self.send_header("X-LifeOS-Release", "lifeos-architecture-v1-20260701")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(
            status,
            body,
            "application/json; charset=utf-8",
            {"X-Robots-Tag": "noindex, nofollow, noarchive"},
        )

    def _safe_file(self, root, relative_path):
        root = root.resolve()
        target = (root / relative_path).resolve()

        if not str(target).startswith(str(root)):
            return None

        if not target.exists() or not target.is_file():
            return None

        return target

    def _serve_file(self, file_path, extra_headers=None):
        if not file_path or not file_path.exists() or not file_path.is_file():
            self._send_bytes(404, b"Not found")
            return
        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self._send_bytes(200, file_path.read_bytes(), content_type, extra_headers)

    def _redirect(self, location, status=301):
        self._send_bytes(
            status,
            ("Redirecting to " + location).encode("utf-8"),
            "text/plain; charset=utf-8",
            {
                "Location": location,
                "X-Robots-Tag": "noindex, nofollow, noarchive",
            },
        )

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self._path()

        # LIFEOS_ARCHITECTURE_FINALIZER_V1_ROUTES
        public_pages = {
            "/": "index.html",
            "/about": "about.html",
            "/how-it-works": "how_it_works.html",
            "/decision-intelligence": "decision_intelligence.html",
            "/community": "community.html",
            "/guides": "guides.html",
            "/contact": "contact.html",
            "/projects": "projects.html",
            "/privacy": "privacy.html",
            "/terms": "terms.html",
            "/disclaimer": "disclaimer.html",
            "/robots.txt": "robots.txt",
            "/sitemap.xml": "sitemap.xml",
        }
        redirects = {
            "/index.html": "/",
            "/home": "/",
            "/home.html": "/",
            "/about.html": "/about",
            "/how-it-works.html": "/how-it-works",
            "/decision-intelligence.html": "/decision-intelligence",
            "/community.html": "/community",
            "/guides.html": "/guides",
            "/contact.html": "/contact",
            "/projects.html": "/projects",
            "/privacy.html": "/privacy",
            "/terms.html": "/terms",
            "/disclaimer.html": "/disclaimer",
            "/chat.html": "/chat",
            "/voice.html": "/voice",
            "/gemini-live": "/voice",
            "/gemini-live.html": "/voice",
            "/manifest.json": "/manifest.webmanifest",
        }

        if path in redirects:
            self._redirect(redirects[path])
            return
        if path in public_pages:
            self._serve_file(WEB_DIR / public_pages[path])
            return

        private_headers = {
            "X-Robots-Tag": "noindex, nofollow, noarchive",
        }
        if path == "/chat":
            self._serve_file(WEB_DIR / "chat.html", private_headers)
            return
        if path == "/voice":
            self._serve_file(WEB_DIR / "gemini_live.html", private_headers)
            return
        if path == "/health":
            self._send_bytes(200, b"OK", "text/plain; charset=utf-8", private_headers)
            return
        if path == "/api/gemini-live-status":
            self._send_json(200, gemini_live_status())
            return
        if path == "/api/realtime-status":
            self._handle_realtime_status_v3()
            return
        if path == "/manifest.webmanifest":
            self._serve_file(WEB_DIR / "manifest.webmanifest")
            return
        if path == "/service-worker.js":
            self._serve_file(
                WEB_DIR / "service-worker.js",
                {"Service-Worker-Allowed": "/"},
            )
            return
        if path.startswith("/icons/"):
            self._serve_file(
                self._safe_file(WEB_DIR / "icons", path.replace("/icons/", "", 1))
            )
            return
        if path.startswith("/assets/"):
            self._serve_file(
                self._safe_file(WEB_DIR / "assets", path.replace("/assets/", "", 1))
            )
            return
        if path.startswith("/audio/"):
            self._serve_file(
                self._safe_file(AUDIO_DIR, path.replace("/audio/", "", 1)),
                private_headers,
            )
            return

        self._send_bytes(
            404,
            b"Not found",
            "text/plain; charset=utf-8",
            private_headers,
        )


    # LIFEOS_REALTIME_GATEWAY_V3_START
    def _handle_realtime_status_v3(self):
        self._send_json(
            200,
            {
                "ok": True,
                "realtime_gateway": True,
                "openai_key_configured": bool(
                    os.environ.get("OPENAI_API_KEY", "").strip()
                ),
                "model": os.environ.get(
                    "LIFEOS_REALTIME_MODEL",
                    "gpt-realtime-2",
                ),
                "voice": os.environ.get(
                    "LIFEOS_REALTIME_VOICE",
                    "marin",
                ),
            },
        )


    def _handle_realtime_session_v3(self):
        try:
            api_key = os.environ.get("OPENAI_API_KEY", "").strip()
            if not api_key:
                self._send_json(
                    503,
                    {
                        "ok": False,
                        "error": "OPENAI_API_KEY is not configured on the server.",
                    },
                )
                return

            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("application/sdp"):
                self._send_json(
                    415,
                    {
                        "ok": False,
                        "error": "Content-Type must be application/sdp.",
                    },
                )
                return

            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0:
                raise ValueError("SDP offer is required.")
            if length > 250000:
                raise ValueError("SDP offer is too large.")

            offer_sdp = self.rfile.read(length).decode(
                "utf-8",
                errors="strict",
            ).strip()
            if not offer_sdp.startswith("v=0") or "m=audio" not in offer_sdp:
                raise ValueError("Invalid WebRTC SDP offer.")

            model = os.environ.get(
                "LIFEOS_REALTIME_MODEL",
                "gpt-realtime-2",
            ).strip() or "gpt-realtime-2"
            voice = os.environ.get(
                "LIFEOS_REALTIME_VOICE",
                "marin",
            ).strip() or "marin"

            session_config = {
                "type": "realtime",
                "model": model,
                "instructions": (
                    "You are Sophia, the LifeOS realtime decision-intelligence "
                    "assistant. Speak in natural contemporary London English "
                    "with warm, clear articulation, varied intonation and "
                    "measured pacing. Sound human and conversational, never "
                    "robotic or like a walkie-talkie. The visitor may interrupt "
                    "at any moment; stop immediately, listen fully, and answer "
                    "the latest words. Give direct future-outcome guidance, the "
                    "main risk, the better move, and one practical next action."
                ),
                "audio": {
                    "input": {
                        "noise_reduction": {"type": "near_field"},
                        "turn_detection": {
                            "type": "server_vad",
                            "threshold": 0.5,
                            "prefix_padding_ms": 300,
                            "silence_duration_ms": 500,
                            "create_response": True,
                            "interrupt_response": True,
                        },
                    },
                    "output": {"voice": voice},
                },
            }

            boundary = "----LifeOSRealtime" + uuid.uuid4().hex
            chunks = []

            def add_part(name, value, part_type):
                chunks.extend(
                    [
                        f"--{boundary}\r\n".encode("utf-8"),
                        (
                            f'Content-Disposition: form-data; name="{name}"\r\n'
                        ).encode("utf-8"),
                        f"Content-Type: {part_type}\r\n\r\n".encode("utf-8"),
                        value.encode("utf-8"),
                        b"\r\n",
                    ]
                )

            add_part("sdp", offer_sdp, "application/sdp")
            add_part(
                "session",
                json.dumps(session_config, separators=(",", ":")),
                "application/json",
            )
            chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
            request_body = b"".join(chunks)

            forwarded = self.headers.get("X-Forwarded-For", "")
            client_ip = forwarded.split(",", 1)[0].strip()
            if not client_ip and getattr(self, "client_address", None):
                client_ip = str(self.client_address[0])
            user_agent = self.headers.get("User-Agent", "")[:160]
            safety_id = hashlib.sha256(
                ("lifeos-realtime:" + client_ip + ":" + user_agent).encode("utf-8")
            ).hexdigest()

            request = urllib.request.Request(
                "https://api.openai.com/v1/realtime/calls",
                data=request_body,
                method="POST",
                headers={
                    "Authorization": "Bearer " + api_key,
                    "Content-Type": "multipart/form-data; boundary=" + boundary,
                    "Accept": "application/sdp, text/plain",
                    "OpenAI-Safety-Identifier": safety_id,
                    "User-Agent": "LifeOS-Realtime-Gateway/3",
                },
            )

            with urllib.request.urlopen(request, timeout=35) as response:
                answer_sdp = response.read()
                upstream_type = response.headers.get(
                    "Content-Type",
                    "application/sdp",
                )
                upstream_status = int(getattr(response, "status", 200))

            if not answer_sdp.lstrip().startswith(b"v=0"):
                raise RuntimeError("OpenAI returned an invalid SDP answer.")

            self._send_bytes(
                upstream_status,
                answer_sdp,
                upstream_type,
            )
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:1000]
            self._send_json(
                502,
                {
                    "ok": False,
                    "error": "OpenAI Realtime session request failed.",
                    "upstream_status": error.code,
                    "detail": detail,
                },
            )
        except Exception as error:
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": f"{type(error).__name__}: {error}",
                },
            )
    # LIFEOS_REALTIME_GATEWAY_V3_END

    def _handle_chat_decision(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length <= 0:
                raise ValueError("Request body is required")

            if length > 60000:
                raise ValueError("Request body is too large")

            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))

            messages = data.get("messages") or []
            if not isinstance(messages, list):
                raise ValueError("Messages must be a list")

            cleaned = []
            for item in messages[-8:]:
                role = str(item.get("role", "")).strip().lower()
                content = str(item.get("content", "")).strip()

                if role not in ("user", "assistant"):
                    continue

                if not content:
                    continue

                # Do not send old system failure messages back into the next prompt.
                if "could not complete the continuation" in content.lower():
                    continue
                if "under high demand" in content.lower():
                    continue
                if "reviewing the decision thread" in content.lower():
                    continue

                limit = 900 if role == "user" else 700
                cleaned.append((role, content[:limit]))

            if not cleaned:
                raise ValueError("Message is required")

            latest_user = ""
            for role, content in reversed(cleaned):
                if role == "user":
                    latest_user = content
                    break

            conversation = "\n".join(
                f"{role.upper()}: {content}" for role, content in cleaned
            )

            prompt = f"""
You are Sophia, the LifeOS AI decision-intelligence assistant.

The user is continuing one decision conversation.

Latest user message:
{latest_user}

Compact conversation context:
{conversation}

Your job:
Complete the user's decision analysis and answer the exact condition being asked.

Mandatory decision-clarity rules:
- Begin with "Future outcome:" and state the most likely practical outcome of the exact action or inaction the user described.
- Distinguish likely outcome, possible outcome, and unknown outcome. Never claim an uncertain event is guaranteed.
- Explain what is likely to happen if the person continues the present path and what is likely to change if the person takes the safer or better path.
- Include the short-term consequence, longer-term consequence, main risk, hidden cost or opportunity cost, better move, and one immediate next action.
- For substance misuse or dangerous behaviour, explain increased risk without declaring that a specific accident, illness, or death must happen.
- For investments such as Bitcoin, explain possible missed upside, possible avoided loss, volatility, timing risk, liquidity, and a risk-controlled alternative. Never promise profit or a guaranteed price.
- Continue the existing thread instead of restarting it.
- Use natural spoken English without markdown symbols.
- Deliver the full answer in 90 to 145 words.
- End with a complete final sentence. Never stop mid-sentence or leave the future outcome unfinished.
"""

            try:
                client = GeminiClient()
                reply = client.generate_text(prompt, timeout=12, retries=1, max_output_tokens=520).strip()
            except Exception as e:
                err = f"{type(e).__name__}: {e}"
                reply = (
                    "LifeOS AI received your follow-up, but the intelligence engine could not complete the continuation at this moment. "
                    "The decision thread is still kept on this page. Wait briefly, then send the same follow-up again. "
                    "Do not restart the decision unless you want a fresh audit."
                )

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "reply": reply,
                        "audio_url": None,
                        "tts_error": err,
                    },
                )
                return

            self._send_json(
                200,
                {
                    "ok": True,
                    "reply": reply,
                    "audio_url": None,
                    "tts_error": None,
                },
            )

        except Exception as e:
            self._send_json(
                200,
                {
                    "ok": True,
                    "reply": "LifeOS AI could not read that message properly. Please type the question again.",
                    "audio_url": None,
                    "tts_error": f"{type(e).__name__}: {e}",
                },
            )


    def _handle_voice_read(self):
        try:
            length = int(
                self.headers.get("Content-Length", "0")
            )

            if length <= 0:
                raise ValueError("Request body is required")

            if length > 12000:
                raise ValueError("Request body is too large")

            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))

            text = " ".join(
                str(data.get("text") or "").split()
            )

            if not text:
                raise ValueError("Voice text is required")

            text = text[:2400]
            now = time.time()

            for old_file in AUDIO_DIR.glob(
                "lifeos_voice_*.wav"
            ):
                try:
                    if now - old_file.stat().st_mtime > 3600:
                        old_file.unlink()
                except OSError:
                    pass

            filename = (
                f"lifeos_voice_{int(time.time() * 1000)}_"
                f"{os.getpid()}.wav"
            )

            output_path = AUDIO_DIR / filename

            generate_lifeos_voice_wav(
                text,
                output_path,
                timeout=42,
            )

            self._send_json(
                200,
                {
                    "ok": True,
                    "audio_url": f"/audio/{filename}",
                    "tts_error": None,
                },
            )

        except Exception as error:
            self._send_json(
                200,
                {
                    "ok": False,
                    "audio_url": None,
                    "tts_error": (
                        f"{type(error).__name__}: {error}"
                    ),
                },
            )



    # LIFEOS_GEMINI_LIVE_V1_HANDLER_START
    def _handle_gemini_live_token_v1(self):
        try:
            client_id = (
                self.headers.get("X-Forwarded-For", "")
                .split(",", 1)[0]
                .strip()
            )
            if not client_id:
                client_id = str(
                    self.client_address[0]
                    if self.client_address
                    else "unknown"
                )
            self._send_json(
                200,
                create_gemini_live_token(client_id),
            )
        except GeminiLiveRateLimit as error:
            self._send_json(
                429,
                {
                    "ok": False,
                    "error": str(error),
                    "retry_after": error.retry_after,
                },
            )
        except Exception as error:
            self._send_json(
                502,
                {
                    "ok": False,
                    "error": f"{type(error).__name__}: {error}"[:500],
                },
            )
    # LIFEOS_GEMINI_LIVE_V1_HANDLER_END

    def do_POST(self):
        # LIFEOS_REALTIME_ROUTE_V1
        if self.path.split("?", 1)[0] == "/api/realtime-session":
            return lifeos_handle_realtime_session(self)

        path = self._path()


        # LIFEOS_GEMINI_LIVE_V1_POST_ROUTE_START
        if path == "/api/gemini-live-token":
            self._handle_gemini_live_token_v1()
            return
        # LIFEOS_GEMINI_LIVE_V1_POST_ROUTE_END
        # LIFEOS_REALTIME_SESSION_ROUTE_V3
        if path == "/api/realtime-session":
            self._handle_realtime_session_v3()
            return

        if path == "/api/chat-decision":
            self._handle_chat_decision()
            return
        if path == "/api/voice-read":
            self._handle_voice_read()
            return

        if path != "/api/text-audit":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))

            if length <= 0:
                raise ValueError("Request body is required")

            if length > 50000:
                raise ValueError("Request body is too large")

            raw = self.rfile.read(length)
            data = json.loads(raw.decode("utf-8"))

            user_text = (data.get("text") or "").strip()
            tone = (data.get("tone") or "london").strip().lower()

            if not user_text:
                raise ValueError("Text is required")

            tone_instruction = TONE_MAP.get(tone, TONE_MAP["london"])

            client = GeminiClient()

            audit_prompt = f"{SYSTEM_STYLE}\n\nUser decision:\n{user_text}"

            try:
                audit = client.generate_text(
                    audit_prompt,
                    timeout=45,
                    retries=3,
                )
            except Exception as e:
                error_text = str(e)
                if "503" in error_text or "UNAVAILABLE" in error_text or "high demand" in error_text:
                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "reply": "LifeOS AI is temporarily experiencing high demand from the intelligence engine. Please try again in a moment. Your decision was received, but the future outcome audit could not be completed right now.",
                            "voice": "LifeOS AI is temporarily experiencing high demand from the intelligence engine. Please try again in a moment.",
                            "audit": "",
                            "tone": tone,
                            "audio_url": None,
                            "tts_error": "Gemini model high demand: 503 UNAVAILABLE",
                        },
                    )
                    return
                raise

            voice_prompt = f"""
Rewrite the audit below as the exact public response to show on screen.

Requirements:
- Speak as Sophia, the LifeOS AI premium voice.
- {tone_instruction}
- Do not read labels like Verdict, Main Risk, Better Move, Next Action, or Final Truth.
- Do not mention markdown.
- Keep it under 85 words.
- Make it sound natural, premium, and human.
- The final text must be suitable to display on screen.
- End with a complete sentence. Never stop mid-word, mid-line, or mid-thought.

Audit:
{audit}
"""

            try:
                voice = client.generate_text(
                    voice_prompt,
                    timeout=35,
                    retries=2,
                ).strip()
            except Exception:
                voice = audit.strip()

            audio_url = None
            tts_error = "Server voice temporarily disabled to keep AI response fast and stable."

            self._send_json(
                200,
                {
                    "ok": True,
                    "reply": voice,
                    "voice": voice,
                    "audit": audit,
                    "tone": tone,
                    "audio_url": audio_url,
                    "tts_error": tts_error,
                },
            )

        except Exception as e:
            error_text = f"{type(e).__name__}: {e}"
            self._send_json(
                200,
                {
                    "ok": True,
                    "reply": "LifeOS AI received your decision, but the intelligence engine could not complete the future outcome audit at this moment. Please try again shortly.",
                    "voice": "LifeOS AI received your decision, but the intelligence engine could not complete the future outcome audit at this moment.",
                    "audit": "",
                    "tone": "system",
                    "audio_url": None,
                    "tts_error": error_text,
                },
            )


def main():
    if not os.environ.get("GEMINI_API_KEY"):
        print("❌ GEMINI_API_KEY is missing.")
        raise SystemExit(1)

    print(f"✅ LifeOS AI Voice server running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), LifeOSVoiceHandler).serve_forever()


if __name__ == "__main__":
    main()
