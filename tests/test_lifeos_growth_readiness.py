import http.client
import json
import os
import threading
import unittest
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from app import lifeos_voice_server as server


ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web" / "lifeos_voice"
FINAL_ORIGIN = "https://losai.onrender.com"
OLD_ORIGIN = "https://lifeos-ai-voice-app.onrender.com"
PUBLISHER_ID = "pub-1234567890123456"


class GrowthReadinessStaticTests(unittest.TestCase):
    def test_public_documents_use_the_final_cost_free_origin(self):
        public_documents = [
            path
            for path in WEB.glob("*.html")
            if path.name not in {"admin.html", "chat.html", "gemini_live.html"}
        ]
        self.assertGreaterEqual(len(public_documents), 20)
        for document in public_documents:
            page = document.read_text(encoding="utf-8")
            with self.subTest(document=document.name):
                self.assertNotIn(OLD_ORIGIN, page)
                self.assertIn('rel="canonical" href="' + FINAL_ORIGIN, page)

    def test_sitemap_is_valid_complete_and_excludes_private_surfaces(self):
        sitemap_path = WEB / "sitemap.xml"
        sitemap = sitemap_path.read_text(encoding="utf-8")
        root = ET.fromstring(sitemap)
        locations = {
            item.text
            for item in root.findall("{http://www.sitemaps.org/schemas/sitemap/0.9}url/{http://www.sitemaps.org/schemas/sitemap/0.9}loc")
        }
        self.assertEqual(len(locations), 22)
        self.assertIn(FINAL_ORIGIN + "/", locations)
        self.assertIn(FINAL_ORIGIN + "/privacy", locations)
        self.assertFalse(any(OLD_ORIGIN in location for location in locations))
        for private_path in ("/chat", "/voice", "/admin", "/api/"):
            self.assertFalse(any(private_path in location for location in locations))

    def test_robots_uses_final_sitemap_and_blocks_private_surfaces(self):
        robots = (WEB / "robots.txt").read_text(encoding="utf-8")
        self.assertIn("Sitemap: " + FINAL_ORIGIN + "/sitemap.xml", robots)
        self.assertNotIn(OLD_ORIGIN, robots)
        for private_path in ("/chat", "/voice", "/admin", "/api/"):
            self.assertIn("Disallow: " + private_path, robots)

    def test_privacy_contains_google_advertising_disclosures_and_choices(self):
        privacy = (WEB / "privacy.html").read_text(encoding="utf-8")
        self.assertIn("Google’s advertising cookies", privacy)
        self.assertIn("https://myadcenter.google.com/personalizationoff", privacy)
        self.assertIn("https://www.aboutads.info/choices/", privacy)
        self.assertIn("https://policies.google.com/technologies/partner-sites", privacy)
        self.assertIn("Advertising is restricted to public content pages", privacy)
        self.assertIn("Last updated: 15 July 2026", privacy)

    def test_github_actions_is_release_ci_not_a_hosting_keepalive(self):
        workflow = (ROOT / ".github/workflows/lifeos-release-tests.yml").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("schedule:", workflow)
        self.assertIn("push:", workflow)
        self.assertIn("pull_request:", workflow)
        self.assertIn("workflow_dispatch", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn("python -m unittest discover -s tests -v", workflow)

    def test_render_blueprint_matches_the_final_service(self):
        blueprint = (ROOT / "render.yaml").read_text(encoding="utf-8")
        self.assertIn("name: losai", blueprint)
        self.assertIn("value: " + FINAL_ORIGIN, blueprint)
        self.assertIn("LIFEOS_ADSENSE_PUBLISHER_ID", blueprint)
        self.assertIn("LIFEOS_GOOGLE_AUTH_ENABLED\n        value: true", blueprint)

    def test_private_interface_files_never_embed_advertising_code(self):
        for name in ("admin.html", "chat.html", "gemini_live.html"):
            page = (WEB / name).read_text(encoding="utf-8")
            with self.subTest(name=name):
                self.assertNotIn("pagead2.googlesyndication.com", page)
                self.assertNotIn("google-adsense-account", page)


class GrowthReadinessRuntimeTests(unittest.TestCase):
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

    def test_publisher_id_is_fail_closed_and_format_validated(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(server.adsense_publisher_id(), "")
        with mock.patch.dict(
            os.environ,
            {"LIFEOS_ADSENSE_PUBLISHER_ID": "not-a-real-id"},
            clear=True,
        ):
            self.assertEqual(server.adsense_publisher_id(), "")
        for value in (PUBLISHER_ID, "ca-" + PUBLISHER_ID):
            with self.subTest(value=value), mock.patch.dict(
                os.environ,
                {"LIFEOS_ADSENSE_PUBLISHER_ID": value},
                clear=True,
            ):
                self.assertEqual(server.adsense_publisher_id(), PUBLISHER_ID)
                self.assertEqual(server.adsense_client_id(), "ca-" + PUBLISHER_ID)

    def test_adsense_is_injected_only_into_public_content(self):
        with mock.patch.dict(
            os.environ,
            {"LIFEOS_ADSENSE_PUBLISHER_ID": PUBLISHER_ID},
            clear=False,
        ):
            with urllib.request.urlopen(self.base + "/", timeout=2) as response:
                public_page = response.read().decode("utf-8")
                self.assertEqual(response.headers["X-LifeOS-Monetization"], "public-enabled")
            with urllib.request.urlopen(self.base + "/chat", timeout=2) as response:
                private_page = response.read().decode("utf-8")
            with urllib.request.urlopen(self.base + "/ads.txt", timeout=2) as response:
                ads_txt = response.read().decode("utf-8")

        self.assertIn('content="ca-' + PUBLISHER_ID + '"', public_page)
        self.assertIn("pagead2.googlesyndication.com", public_page)
        self.assertNotIn("pagead2.googlesyndication.com", private_page)
        self.assertNotIn("google-adsense-account", private_page)
        self.assertEqual(
            ads_txt,
            "google.com, " + PUBLISHER_ID + ", DIRECT, f08c47fec0942fa0\n",
        )

    def test_ads_txt_is_absent_until_a_real_publisher_id_exists(self):
        with mock.patch.dict(
            os.environ,
            {"LIFEOS_ADSENSE_PUBLISHER_ID": ""},
            clear=False,
        ):
            with self.assertRaises(urllib.error.HTTPError) as context:
                urllib.request.urlopen(self.base + "/ads.txt", timeout=2)
        self.assertEqual(context.exception.code, 404)

    def test_legacy_host_redirect_preserves_path_and_query(self):
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.httpd.server_port,
            timeout=2,
        )
        connection.request(
            "GET",
            "/about?source=legacy",
            headers={"Host": "lifeos-ai-voice-app.onrender.com"},
        )
        response = connection.getresponse()
        response.read()
        connection.close()
        self.assertEqual(response.status, 308)
        self.assertEqual(
            response.getheader("Location"),
            FINAL_ORIGIN + "/about?source=legacy",
        )

    def test_release_diagnostic_reports_cost_free_growth_controls(self):
        with mock.patch.dict(
            os.environ,
            {"LIFEOS_ADSENSE_PUBLISHER_ID": ""},
            clear=False,
        ):
            with urllib.request.urlopen(self.base + "/api/release", timeout=2) as response:
                payload = json.loads(response.read().decode("utf-8"))
        self.assertEqual(
            payload["release"],
            "lifeos-admin-chat-voice-control-v2.0.6-20260715",
        )
        self.assertEqual(payload["final_public_origin"], FINAL_ORIGIN)
        self.assertTrue(payload["cost_free_warmup_ready"])
        self.assertEqual(payload["cost_free_warmup"], "external-monitor-required")
        self.assertEqual(payload["external_health_probe"], FINAL_ORIGIN + "/health")
        self.assertTrue(payload["adsense_readiness"])
        self.assertFalse(payload["adsense_configured"])
        self.assertIn("/voice", payload["private_surfaces_ad_free"])

    def test_health_probe_is_uncached_and_monitor_ready(self):
        with urllib.request.urlopen(self.base + "/health", timeout=2) as response:
            body = response.read().decode("utf-8")
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertEqual(
                response.headers["X-LifeOS-Health"],
                "external-monitor-ready",
            )
        self.assertEqual(body, "OK")


if __name__ == "__main__":
    unittest.main()
