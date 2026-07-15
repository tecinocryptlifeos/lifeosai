import json
import os
import subprocess
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from app import lifeos_auth_analytics as auth
from app.gemini_client import GeminiClient
from app import lifeos_voice_server as server


ROOT = Path(__file__).resolve().parents[1]


class AuthAnalyticsTests(unittest.TestCase):
    def test_public_config_is_mandatory_and_supports_current_key_names(self):
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "publishable-test",
            "SUPABASE_SECRET_KEY": "secret-test",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            config = auth.public_config()
        self.assertTrue(config["configured"])
        self.assertTrue(config["auth_required"])
        self.assertEqual(config["auth_mode"], "mandatory")
        self.assertEqual(config["supabase_anon_key"], "publishable-test")
        self.assertFalse(config["email_enabled"])
        self.assertFalse(config["google_enabled"])
        self.assertNotIn("secret-test", json.dumps(config))

    def test_public_provider_flags_are_explicit_and_email_defaults_off(self):
        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "publishable-test",
            "SUPABASE_SECRET_KEY": "secret-test",
            "LIFEOS_EMAIL_AUTH_ENABLED": "false",
            "LIFEOS_GOOGLE_AUTH_ENABLED": "true",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            config = auth.public_config()
        self.assertFalse(config["email_enabled"])
        self.assertTrue(config["google_enabled"])
        self.assertNotIn("secret-test", json.dumps(config))

    def test_event_audit_does_not_accept_conversation_content(self):
        captured = {}

        def fake_rest(table, method="GET", query="", payload=None, prefer="return=minimal"):
            captured.update(payload or {})
            return 201, {}

        payload = {
            "event_type": "chat_message",
            "metadata": {
                "route": "/chat",
                "transport": "gemini-text",
                "conversation_text": "private user message",
            },
        }
        with mock.patch.object(auth, "_rest", side_effect=fake_rest):
            result = auth.record_event({"id": "user-1", "email": "person@example.com"}, payload)
        self.assertTrue(result["ok"])
        self.assertEqual(captured["metadata"]["route"], "/chat")
        self.assertNotIn("conversation_text", captured["metadata"])
        self.assertNotIn("private user message", json.dumps(captured))

    def test_admin_email_matching_is_case_insensitive(self):
        with mock.patch.dict(os.environ, {"LIFEOS_ADMIN_EMAILS": "Owner@Example.com,second@example.com"}, clear=True):
            self.assertTrue(auth.is_admin({"email": "owner@example.com"}))
            self.assertFalse(auth.is_admin({"email": "visitor@example.com"}))

    def test_new_secret_key_is_not_sent_as_a_bearer_jwt(self):
        captured = {}

        def fake_request(url, method="GET", headers=None, payload=None, timeout=15):
            captured.update(headers or {})
            return 200, []

        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_server-test",
        }
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(auth, "_request", side_effect=fake_request):
            auth._rest("lifeos_events")
        self.assertEqual(captured["apikey"], "sb_secret_server-test")
        self.assertNotIn("Authorization", captured)

    def test_legacy_service_role_key_remains_a_bearer_jwt(self):
        captured = {}

        def fake_request(url, method="GET", headers=None, payload=None, timeout=15):
            captured.update(headers or {})
            return 200, []

        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "legacy-jwt-test",
        }
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(auth, "_request", side_effect=fake_request):
            auth._rest("lifeos_events")
        self.assertEqual(captured["Authorization"], "Bearer legacy-jwt-test")


class ProtectedRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.LifeOSVoiceHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request_status(self, method, path, body=None, headers=None):
        request = urllib.request.Request(
            self.base + path,
            data=body,
            method=method,
            headers=headers or {},
        )
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                return response.status
        except urllib.error.HTTPError as error:
            return error.code

    def test_every_sophia_endpoint_rejects_anonymous_requests(self):
        routes = [
            ("GET", "/api/admin-dashboard", None, {}),
            ("GET", "/audio/not-present.wav", None, {}),
            ("POST", "/api/gemini-live-token", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/realtime-session", b"v=0", {"Content-Type": "application/sdp"}),
            ("POST", "/api/chat-decision", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/voice-read", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/text-audit", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/analytics-event", b"{}", {"Content-Type": "application/json"}),
        ]
        with mock.patch.object(server, "verify_user", side_effect=PermissionError("Sign-in is required")):
            for method, path, body, headers in routes:
                with self.subTest(path=path):
                    self.assertEqual(self.request_status(method, path, body, headers), 401)


class GeminiGroundingTests(unittest.TestCase):
    def test_grounded_chat_enables_search_thinking_and_safe_sources(self):
        captured = {}
        response_payload = {
            "candidates": [{
                "content": {"parts": [{"text": "Nke a bụ azịza doro anya."}]},
                "groundingMetadata": {
                    "groundingChunks": [
                        {"web": {"title": "Trusted source", "uri": "https://example.com/fact#part"}},
                        {"web": {"title": "Unsafe", "uri": "javascript:alert(1)"}},
                    ]
                },
            }]
        }

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(response_payload).encode("utf-8")

        def fake_urlopen(request, timeout=0):
            captured["body"] = json.loads(request.data.decode("utf-8"))
            captured["url"] = request.full_url
            captured["timeout"] = timeout
            return FakeResponse()

        with mock.patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = GeminiClient(api_key="test-key").generate_grounded_text("Kọwaa nke a")

        self.assertEqual(captured["body"]["tools"], [{"google_search": {}}])
        self.assertEqual(captured["body"]["generationConfig"]["thinkingConfig"]["thinkingBudget"], 1024)
        self.assertIn("gemini-2.5-flash", captured["url"])
        self.assertEqual(result["text"], "Nke a bụ azịza doro anya.")
        self.assertTrue(result["grounded"])
        self.assertEqual(result["sources"], [{"title": "Trusted source", "url": "https://example.com/fact"}])


class InterfaceContractTests(unittest.TestCase):
    def test_release_diagnostic_identifies_v2_0_5_and_preserves_v2_0_4_features(self):
        application = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        self.assertIn("lifeos-cost-free-growth-readiness-v2.0.5-20260715", application)
        self.assertIn('"premium_igbo_priority": True', application)
        self.assertIn('"premium_voice_output": True', application)
        self.assertIn('"live_google_search": True', application)
        self.assertIn('"reasoning_level": "medium"', application)
        self.assertIn('"live_session_resumption": True', application)
        self.assertIn('"connected_audio_cue": True', application)
        self.assertIn('"grounded_chat_search": True', application)
        self.assertIn('"premium_multilingual_chat": True', application)
        self.assertIn('"public_mobile_pwa": True', application)
        self.assertIn('"branded_black_gold_icon": True', application)

    def test_chat_has_premium_igbo_search_and_source_display(self):
        application = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        page = (ROOT / "web/lifeos_voice/chat.html").read_text(encoding="utf-8")
        self.assertIn("fluent contemporary Standard Igbo", application)
        self.assertIn("use Google Search", application)
        self.assertIn("generate_grounded_text", application)
        self.assertIn("Web sources", page)
        self.assertIn('rel = "noopener noreferrer"', page)
        self.assertNotIn("● Online", page)

    def test_public_mobile_manifest_uses_black_branded_png_icons(self):
        manifest = json.loads((ROOT / "web/lifeos_voice/manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["id"], "/")
        self.assertEqual(manifest["background_color"], "#000000")
        self.assertEqual(manifest["theme_color"], "#000000")
        self.assertFalse(manifest["prefer_related_applications"])
        self.assertEqual({item["sizes"] for item in manifest["icons"]}, {"192x192", "512x512"})
        self.assertTrue(any(item["purpose"] == "maskable" for item in manifest["icons"]))
        self.assertEqual({item["short_name"] for item in manifest["shortcuts"]}, {"Chat", "Voice"})

        for name, size in (
            ("lifeos-icon-192.png", 192),
            ("lifeos-icon-512.png", 512),
            ("lifeos-icon-maskable-512.png", 512),
        ):
            data = (ROOT / "web/lifeos_voice/icons" / name).read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            self.assertEqual(int.from_bytes(data[16:20], "big"), size)
            self.assertEqual(int.from_bytes(data[20:24], "big"), size)

    def test_public_mobile_chat_and_voice_still_fail_closed(self):
        for relative in ("web/lifeos_voice/chat.html", "web/lifeos_voice/gemini_live.html"):
            page = (ROOT / relative).read_text(encoding="utf-8")
            self.assertIn("data-lifeos-auth-gate", page)
            self.assertIn("data-lifeos-protected", page)
            self.assertIn("Continue with Google", page)

    def test_email_sign_in_is_hidden_unless_explicitly_enabled(self):
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_auth_v1.js").read_text(encoding="utf-8")
        self.assertIn('show(email, emailEnabled)', controller)
        self.assertIn('show(emailButton, emailEnabled)', controller)
        self.assertIn('!state.config?.email_enabled', controller)

    def test_multilingual_policy_and_despina_remain_in_live_controller(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        self.assertIn("LIFEOS_MULTILINGUAL_VOICE_INTELLIGENCE_V2", controller)
        self.assertIn("Automatically detect the language or language mixture", controller)
        self.assertIn('voiceName:"Despina"', controller)
        self.assertIn('model:"models/"+payload.model', controller)

    def test_live_controller_renews_goaway_connections_and_preserves_context(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        self.assertIn("message.sessionResumptionUpdate", controller)
        self.assertIn("message.goAway", controller)
        self.assertIn('sourceSocket.close(1000,"Gemini GoAway acknowledged")', controller)
        self.assertIn("sessionResumption:sessionResumeHandle?{handle:sessionResumeHandle}:{}", controller)
        self.assertIn("contextWindowCompression:{slidingWindow:{}}", controller)
        self.assertIn("handleMessage(event,nextSocket,resuming)", controller)
        self.assertIn('version:"2.8.0"', controller)

    def test_premium_igbo_policy_is_explicit_and_does_not_guess(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        self.assertIn("PREMIUM IGBO PRIORITY", controller)
        self.assertIn("Igbo Izugbe", controller)
        self.assertIn("formulate the answer directly in Igbo", controller)
        self.assertIn("Never fabricate an Igbo proverb", controller)
        self.assertIn("ask one short clarification in Igbo instead of guessing", controller)

    def test_live_google_search_and_balanced_reasoning_are_enabled(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        voice_page = (ROOT / "web/lifeos_voice/gemini_live.html").read_text(encoding="utf-8")
        self.assertIn("tools:[{googleSearch:{}}]", controller)
        self.assertIn('thinkingConfig:{thinkingLevel:"medium"}', controller)
        self.assertIn("ACCURACY AND LIVE INTERNET POLICY", controller)
        self.assertIn("REASONING AND FORESIGHT POLICY", controller)
        self.assertIn("Never claim access to private accounts", controller)
        self.assertIn("never claim human consciousness", controller)
        self.assertIn("appendSearchAttribution(content.groundingMetadata", controller)
        self.assertIn("Web sources", controller)
        self.assertIn('id="searchAttribution"', voice_page)

    def test_premium_voice_output_is_louder_and_limiter_protected(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        self.assertIn("const PREMIUM_OUTPUT_LEVEL=1.2", controller)
        self.assertIn("outputMakeup.gain.value=2.05", controller)
        self.assertIn("outputLimiter.threshold.value=-1", controller)
        self.assertIn("outputLimiter.ratio.value=20", controller)
        self.assertIn("const targetRms=.23", controller)
        self.assertIn("Math.min(3.2,rmsGain,peakGain)", controller)

    def test_live_search_has_a_public_privacy_disclosure(self):
        privacy = (ROOT / "web/lifeos_voice/privacy.html").read_text(encoding="utf-8")
        self.assertIn("Live web search", privacy)
        self.assertIn("Google Search grounding", privacy)
        self.assertIn("does not give Sophia access to private accounts", privacy)
        self.assertIn("Last updated: 15 July 2026", privacy)

    def test_live_goaway_runtime_renewal(self):
        result = subprocess.run(
            ["node", str(ROOT / "tests/test_gemini_live_session_renewal.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("GoAway renewal simulation passed", result.stdout)

    def test_voice_connection_cue_is_audible_and_status_is_explicit(self):
        controller = (ROOT / "web/lifeos_voice/assets/gemini_live_v1.js").read_text(encoding="utf-8")
        self.assertIn("Sophia is connecting to LifeOS Synthetic Intelligence", controller)
        self.assertIn("scheduleCueTone(523.25,now,.16,.072", controller)
        self.assertIn("await playConnectionCue()", controller)

    def test_initial_oauth_session_is_audited_once(self):
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_auth_v1.js").read_text(encoding="utf-8")
        self.assertIn("async function auditSignInOnce()", controller)
        self.assertIn("user.last_sign_in_at", controller)
        self.assertGreaterEqual(controller.count("void auditSignInOnce()"), 2)
        self.assertIn("localStorage.setItem(SIGN_IN_AUDIT_KEY, fingerprint)", controller)

    def test_voice_chat_and_admin_interfaces_fail_closed(self):
        for relative in (
            "web/lifeos_voice/gemini_live.html",
            "web/lifeos_voice/chat.html",
            "web/lifeos_voice/admin.html",
        ):
            page = (ROOT / relative).read_text(encoding="utf-8")
            with self.subTest(relative=relative):
                self.assertIn("data-lifeos-auth-gate", page)
                self.assertIn("data-lifeos-protected", page)
                self.assertIn("lifeos_auth_v1.js?v=2.0.2", page)


if __name__ == "__main__":
    unittest.main()
