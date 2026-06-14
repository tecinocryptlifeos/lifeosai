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

        if path == "/health":
            self._send_bytes(200, b"OK", "text/plain; charset=utf-8")
            return

        if path in ("/", "/index.html"):
            self._serve_file(WEB_FILE)
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

    def do_POST(self):
        path = self._path()

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

            audit = client.generate_text(
                audit_prompt,
                timeout=75,
                retries=3,
            )

            voice_prompt = f"""
Rewrite the audit below as the exact public response to show and speak.

Requirements:
- Speak as Sophia, the LifeOS AI premium voice.
- {tone_instruction}
- Do not read labels like Verdict, Main Risk, Better Move, Next Action, or Final Truth.
- Do not mention markdown.
- Keep it under 85 words.
- Make it sound natural, premium, and human.
- The final text must be suitable to display on screen and read aloud exactly.

Audit:
{audit}
"""

            voice = client.generate_text(
                voice_prompt,
                timeout=60,
                retries=2,
            ).strip()

            audio_url = None
            tts_error = None

            try:
                audio_name = f"lifeos_voice_{int(time.time() * 1000)}.wav"
                audio_path = AUDIO_DIR / audio_name
                generate_lifeos_voice_wav(voice, audio_path)
                audio_url = f"/audio/{audio_name}"
            except Exception as e:
                tts_error = f"{type(e).__name__}: {e}"

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
            self._send_json(
                500,
                {
                    "ok": False,
                    "error": f"{type(e).__name__}: {e}",
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
