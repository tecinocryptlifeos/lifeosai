"""Static server contract tests for the Gemini Live v3 upgrade."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class GeminiLiveServerContractTests(unittest.TestCase):
    def test_token_route_passes_authenticated_user_and_preference(self):
        source = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        self.assertIn('user = self._require_user()', source)
        self.assertIn('self._handle_gemini_live_token_v1(user)', source)
        self.assertIn('payload.get("model_preference", "primary")', source)
        self.assertIn('create_gemini_live_token(client_id, model_preference)', source)
        self.assertIn('client_id = f"user:{user_id}"', source)

    def test_request_body_is_bounded_and_invalid_json_is_rejected(self):
        source = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        self.assertIn('length < 0 or length > 4096', source)
        self.assertIn('"The token request body is too large."', source)
        self.assertIn('except (UnicodeDecodeError, json.JSONDecodeError):', source)
        self.assertIn('"The token request body is invalid."', source)

    def test_release_and_frontend_cache_version_match(self):
        server = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        page = (ROOT / "web/lifeos_voice/gemini_live.html").read_text(encoding="utf-8")
        controller = (
            ROOT / "web/lifeos_voice/assets/gemini_live_v1.js"
        ).read_text(encoding="utf-8")
        self.assertIn("lifeos-gemini31-resilient-live-v3.0.0-20260723", server)
        self.assertIn("gemini_live_v1.js?v=3.0.0", page)
        self.assertIn('version:"3.0.0"', controller)


if __name__ == "__main__":
    unittest.main()
