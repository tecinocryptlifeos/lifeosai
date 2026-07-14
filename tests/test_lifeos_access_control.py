import json
import os
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from app import lifeos_auth_analytics as auth
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


class InterfaceContractTests(unittest.TestCase):
    def test_release_diagnostic_identifies_v2_0_1(self):
        application = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        self.assertIn("lifeos-multilingual-auth-admin-v2.0.1-20260714", application)

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
                self.assertIn("lifeos_auth_v1.js?v=2.0.1", page)


if __name__ == "__main__":
    unittest.main()
