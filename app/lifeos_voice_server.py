import os
import json
import time
import mimetypes
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import unquote

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


class LifeOSVoiceHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        return

    def _path(self):
        return unquote(self.path.split("?", 1)[0])

    def _send_bytes(self, status, body, content_type="text/plain; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self._send_bytes(status, body, "application/json; charset=utf-8")

    def _safe_file(self, root, relative_path):
        root = root.resolve()
        target = (root / relative_path).resolve()

        if not str(target).startswith(str(root)):
            return None

        if not target.exists() or not target.is_file():
            return None

        return target

    def _serve_file(self, file_path):
        if not file_path or not file_path.exists() or not file_path.is_file():
            self._send_bytes(404, b"Not found")
            return

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        self._send_bytes(200, file_path.read_bytes(), content_type)

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self._path()

        # LIFEOS_ROUTE_LOCK_START
        if path in ("/", "/index.html"):
            self._serve_file(WEB_DIR / "index.html")
            return

        if path in ("/chat", "/chat.html"):
            self._serve_file(WEB_DIR / "chat.html")
            return

        if path in ("/home", "/home.html"):
            self.send_response(302)
            self.send_header("Location", "/")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            return
        # LIFEOS_ROUTE_LOCK_END




        if path == "/health":
            self._send_bytes(200, b"OK", "text/plain; charset=utf-8")
            return

        if path in ("/", "/index.html"):
            self._serve_file(WEB_DIR / "chat.html")
            return

        if path in ("/home", "/home.html"):
            self._serve_file(WEB_DIR / "index.html")
            return

        if path in ("/chat", "/chat.html"):
            self._serve_file(WEB_DIR / "chat.html")
            return

        if path in ("/manifest.webmanifest", "/manifest.json"):
            self._serve_file(WEB_DIR / "manifest.webmanifest")
            return

        if path == "/service-worker.js":
            self._serve_file(WEB_DIR / "service-worker.js")
            return

        if path.startswith("/icons/"):
            file_path = self._safe_file(WEB_DIR / "icons", path.replace("/icons/", "", 1))
            self._serve_file(file_path)
            return

        if path.startswith("/assets/"):
            file_path = self._safe_file(WEB_DIR / "assets", path.replace("/assets/", "", 1))
            self._serve_file(file_path)
            return

        if path.startswith("/audio/"):
            file_path = self._safe_file(AUDIO_DIR, path.replace("/audio/", "", 1))
            self._serve_file(file_path)
            return

        self._send_bytes(404, b"Not found")


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
You are Sophia, the LifeOS AI decision intelligence assistant.

The user is continuing one decision conversation.

Latest user message:
{latest_user}

Compact conversation context:
{conversation}

Your job:
Continue the same decision thread clearly.

Rules:
- Do not restart the whole audit unless the user starts a new decision.
- If the user says they do not understand, explain the previous answer in simpler language.
- If the user asks what to do, give one practical next action.
- If the user's latest message is short, use the previous context to understand it.
- Use LifeOS language naturally: future outcome, main risk, hidden cost, better move, next action, final truth.
- Do not use markdown symbols like **.
- Give a complete answer. Never stop mid-word or mid-sentence.
- Keep it direct, clear, and useful.
- Keep it between 70 and 150 words.
"""

            try:
                client = GeminiClient()
                reply = client.generate_text(prompt, timeout=10, retries=1, max_output_tokens=430).strip()
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


    def do_POST(self):
        path = self._path()

        if path == "/api/chat-decision":
            self._handle_chat_decision()
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
    HTTPServer((HOST, PORT), LifeOSVoiceHandler).serve_forever()


if __name__ == "__main__":
    main()
