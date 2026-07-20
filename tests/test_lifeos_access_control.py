import json
import os
import base64
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

    def test_error_audit_stores_only_classified_technical_detail(self):
        captured = {}

        def fake_rest(table, method="GET", query="", payload=None, prefer="return=minimal"):
            captured.update(payload or {})
            return 201, {}

        with mock.patch.object(auth, "_rest", side_effect=fake_rest):
            auth.record_event(
                {"id": "user-1", "email": "person@example.com"},
                {
                    "event_type": "voice_error",
                    "error_code": "1008",
                    "error_message": "private conversation words followed by GoAway",
                },
            )
        self.assertEqual(captured["error_code"], "1008")
        self.assertEqual(captured["error_message"], "Gemini Live connection closed with code 1008.")
        self.assertNotIn("private conversation", json.dumps(captured))

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

    def test_new_secret_key_is_not_sent_as_bearer_to_auth_admin(self):
        captured = {}

        def fake_request(url, method="GET", headers=None, payload=None, timeout=15):
            captured.update(headers or {})
            return 200, {"users": []}

        environment = {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "sb_secret_server-test",
        }
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(auth, "_request", side_effect=fake_request):
            auth._auth_users()
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

    def test_blocked_and_admin_revoked_tokens_fail_closed(self):
        with self.assertRaisesRegex(PermissionError, "blocked"):
            auth._enforce_lifeos_access(
                {"app_metadata": {"lifeos_access_blocked": True}},
                "header.payload.signature",
            )

        claims = base64.urlsafe_b64encode(json.dumps({"iat": 100}).encode()).decode().rstrip("=")
        with self.assertRaisesRegex(PermissionError, "signed out"):
            auth._enforce_lifeos_access(
                {"app_metadata": {"lifeos_session_not_before": 100}},
                "header." + claims + ".signature",
            )

    def test_admin_can_block_a_non_admin_without_exposing_conversation_data(self):
        target_id = "00000000-0000-4000-8000-000000000002"
        target = {
            "id": target_id,
            "email": "visitor@example.com",
            "app_metadata": {},
        }
        captured = {}

        def fake_admin(path, method="GET", payload=None):
            captured.update({"path": path, "method": method, "payload": payload})
            return 200, {**target, **(payload or {})}

        with mock.patch.dict(os.environ, {"LIFEOS_ADMIN_EMAILS": "owner@example.com"}, clear=True), \
                mock.patch.object(auth, "_auth_user", return_value=target), \
                mock.patch.object(auth, "_auth_admin_request", side_effect=fake_admin), \
                mock.patch.object(auth, "record_event") as record:
            result = auth.manage_user(
                {"id": "00000000-0000-4000-8000-000000000001", "email": "owner@example.com"},
                {"action": "block", "user_id": target_id, "conversation_text": "must never be stored"},
            )

        self.assertTrue(result["ok"])
        self.assertEqual(captured["method"], "PUT")
        self.assertEqual(captured["payload"]["ban_duration"], "876000h")
        self.assertTrue(captured["payload"]["app_metadata"]["lifeos_access_blocked"])
        self.assertNotIn("conversation_text", json.dumps(captured))
        self.assertEqual(record.call_args.args[1]["event_type"], "admin_block")

    def test_admin_cannot_manage_self_or_another_admin(self):
        actor = {
            "id": "00000000-0000-4000-8000-000000000001",
            "email": "owner@example.com",
        }
        with mock.patch.dict(os.environ, {"LIFEOS_ADMIN_EMAILS": "owner@example.com"}, clear=True), \
                mock.patch.object(auth, "_auth_user", return_value=actor):
            with self.assertRaisesRegex(PermissionError, "own access"):
                auth.manage_user(actor, {"action": "block", "user_id": actor["id"]})

    def test_error_drilldown_explains_gemini_goaway(self):
        insight = auth._error_insight({
            "id": "error-1",
            "event_type": "voice_error",
            "error_code": "1008",
            "error_message": "GoAway signal received",
            "metadata": {"route": "/voice"},
        })
        self.assertIn("session handover", insight["explanation"])
        self.assertIn("automatic renewal", insight["recommended_action"])
        self.assertEqual(insight["route"], "/voice")


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
            ("GET", "/api/session-status", None, {}),
            ("GET", "/api/lifeos-queue/status", None, {}),
            ("GET", "/audio/not-present.wav", None, {}),
            ("POST", "/api/lifeos-queue/run", b'{"mode":"verify"}', {"Content-Type": "application/json"}),
            ("POST", "/api/gemini-live-token", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/realtime-session", b"v=0", {"Content-Type": "application/sdp"}),
            ("POST", "/api/chat-decision", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/voice-read", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/text-audit", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/analytics-event", b"{}", {"Content-Type": "application/json"}),
            ("POST", "/api/admin-user-action", b"{}", {"Content-Type": "application/json"}),
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
    def test_release_diagnostic_identifies_v2_1_0_and_preserves_v2_0_6_features(self):
        application = (ROOT / "app/lifeos_voice_server.py").read_text(encoding="utf-8")
        self.assertIn("lifeos-account-registration-completion-v2.1.0-20260717", application)
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
        self.assertIn('"admin_error_drilldown": True', application)
        self.assertIn('"responsive_chat_layout": "mobile-and-desktop"', application)
        self.assertIn('"incremental_chat_delivery": True', application)
        self.assertIn('"voice_volume_control": True', application)
        self.assertIn('"profile_completion_gate": True', application)
        self.assertIn('"server_enforced_profile": True', application)

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

    def test_email_password_and_registration_are_feature_gated(self):
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_auth_v1.js").read_text(encoding="utf-8")
        self.assertIn('all("[data-lifeos-email-auth]")', controller)
        self.assertIn('all("[data-lifeos-registration]")', controller)
        self.assertIn('state.config?.registration_enabled', controller)
        self.assertIn('emailPasswordSignIn', controller)
        self.assertIn('emailSignUp', controller)

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
        self.assertIn('version:"2.9.0"', controller)

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
        self.assertIn("const PREMIUM_OUTPUT_LEVEL=1.25", controller)
        self.assertIn("DEFAULT_OUTPUT_VOLUME_PERCENT=130", controller)
        self.assertIn("outputMakeup.gain.value=2.05", controller)
        self.assertIn("outputLimiter.threshold.value=-1", controller)
        self.assertIn("outputLimiter.ratio.value=20", controller)
        self.assertIn("const targetRms=.27", controller)
        self.assertIn("Math.min(3.4,rmsGain,peakGain)", controller)
        self.assertIn('id="volumeControl"', (ROOT / "web/lifeos_voice/gemini_live.html").read_text(encoding="utf-8"))

    def test_live_search_has_a_public_privacy_disclosure(self):
        privacy = (ROOT / "web/lifeos_voice/privacy.html").read_text(encoding="utf-8")
        self.assertIn("Live web search", privacy)
        self.assertIn("Google Search grounding", privacy)
        self.assertIn("does not give Sophia access to private accounts", privacy)
        self.assertIn("Last updated: 17 July 2026", privacy)

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
        self.assertIn("scheduleCueTone(523.25,now,.16,.22", controller)
        self.assertIn("envelope.connect(outputLimiter)", controller)
        self.assertIn("await playConnectingCue()", controller)
        self.assertIn("await playConnectionCue()", controller)

    def test_chat_has_separate_mobile_desktop_layout_and_incremental_reveal(self):
        page = (ROOT / "web/lifeos_voice/chat.html").read_text(encoding="utf-8")
        delivery = (ROOT / "web/lifeos_voice/assets/lifeos_chat_delivery_v2.js").read_text(encoding="utf-8")
        self.assertIn("@media (max-width:767px)", page)
        self.assertIn("@media (min-width:1100px)", page)
        self.assertIn("grid-template-columns:minmax(280px,340px) minmax(0,1fr)", page)
        self.assertIn("LifeOSChatDelivery.reveal", page)
        self.assertIn("splitForReveal", delivery)
        self.assertIn('node.textContent += piece', delivery)

    def test_incremental_chat_delivery_runtime(self):
        result = subprocess.run(
            ["node", str(ROOT / "tests/test_chat_delivery.js")],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("incremental chat delivery simulation passed", result.stdout)

    def test_admin_interface_has_error_drilldown_and_safe_user_controls(self):
        page = (ROOT / "web/lifeos_voice/admin.html").read_text(encoding="utf-8")
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_admin_v1.js").read_text(encoding="utf-8")
        self.assertIn('id="errorsPanel"', page)
        self.assertIn('id="errorDialog"', page)
        self.assertIn('id="usersPanel"', page)
        self.assertIn("/api/admin-user-action", controller)
        self.assertIn('requestUserAction(user, "sign_out")', controller)
        self.assertIn('requestUserAction(user, "block")', controller)
        self.assertIn('requestUserAction(user, "unblock")', controller)
        self.assertNotIn("innerHTML", controller)

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
                self.assertIn("lifeos_auth_v1.js?v=2.1.0", page)


if __name__ == "__main__":
    unittest.main()
