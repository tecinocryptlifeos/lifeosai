import json
import subprocess
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


class IdCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if values.get("id"):
            self.ids.append(values["id"])


class AccountCompletionTests(unittest.TestCase):
    def test_public_config_reports_registration_policy(self):
        from app import lifeos_auth_analytics as auth
        with mock.patch.dict("os.environ", {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "publishable-test",
            "SUPABASE_SECRET_KEY": "secret-test",
            "LIFEOS_EMAIL_AUTH_ENABLED": "true",
            "LIFEOS_REGISTRATION_ENABLED": "true",
            "LIFEOS_GOOGLE_AUTH_ENABLED": "true",
            "LIFEOS_MINIMUM_AGE": "13",
            "LIFEOS_PASSWORD_MIN_LENGTH": "10",
        }, clear=True):
            config = auth.public_config()
        self.assertTrue(config["configured"])
        self.assertTrue(config["email_enabled"])
        self.assertTrue(config["registration_enabled"])
        self.assertTrue(config["google_enabled"])
        self.assertEqual(config["minimum_age"], 13)
        self.assertEqual(config["password_min_length"], 10)

    def test_registration_cannot_be_enabled_without_email_auth(self):
        from app import lifeos_auth_analytics as auth
        with mock.patch.dict("os.environ", {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "publishable-test",
            "SUPABASE_SECRET_KEY": "secret-test",
            "LIFEOS_EMAIL_AUTH_ENABLED": "false",
            "LIFEOS_REGISTRATION_ENABLED": "true",
        }, clear=True):
            config = auth.public_config()
        self.assertFalse(config["registration_enabled"])

    def test_account_module_uses_supabase_password_apis(self):
        source = (ROOT / "web/lifeos_voice/assets/lifeos_account_v1.js").read_text()
        for marker in (
            "auth.signUp", "auth.signInWithPassword", "auth.resetPasswordForEmail",
            "auth.updateUser", "minimum_age_confirmed", "terms_accepted_at",
        ):
            self.assertIn(marker, source)
        self.assertNotIn("signInWithOtp", source)

    def test_protected_surfaces_have_complete_account_controls_and_unique_ids(self):
        required = {
            "chat.html": {"authTabSignIn", "authTabSignUp", "emailPasswordSignIn", "emailSignUp", "forgotPassword", "googleSignIn", "profileCompletionPanel", "saveProfile", "profileSignOut"},
            "gemini_live.html": {"authTabSignIn", "authTabSignUp", "emailPasswordSignIn", "emailSignUp", "forgotPassword", "googleSignIn", "profileCompletionPanel", "saveProfile", "profileSignOut"},
            "admin.html": {"emailPasswordSignIn", "forgotPassword", "googleSignIn", "profileCompletionPanel", "saveProfile", "profileSignOut"},
        }
        for filename, expected in required.items():
            page = (ROOT / "web/lifeos_voice" / filename).read_text()
            parser = IdCollector(); parser.feed(page)
            self.assertEqual(len(parser.ids), len(set(parser.ids)), f"duplicate id in {filename}")
            self.assertTrue(expected.issubset(set(parser.ids)), filename)
            self.assertIn("lifeos_account_v1.js", page)
            self.assertIn("lifeos_auth_v1.js?v=2.1.0", page)

    def test_reset_password_page_is_noindex_and_uses_update_user(self):
        page = (ROOT / "web/lifeos_voice/reset_password.html").read_text()
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_reset_password_v1.js").read_text()
        self.assertIn('content="noindex,nofollow,noarchive"', page)
        self.assertIn("LifeOSAccount.updatePassword", controller)
        server = (ROOT / "app/lifeos_voice_server.py").read_text()
        self.assertIn('path in {"/reset-password", "/reset-password/"}', server)

    def test_profile_migration_contains_required_fields_and_age_gate(self):
        sql = (ROOT / "supabase_account_upgrade_v2_1.sql").read_text()
        for marker in ("first_name", "surname", "date_of_birth", "country", "phone", "terms_accepted_at"):
            self.assertIn(marker, sql)
        self.assertIn("minimum age of 13", sql)
        self.assertIn("on conflict(user_id) do update", sql.lower())
        self.assertNotIn("update auth.users set updated_at = updated_at", sql.lower())

    def test_profile_completion_is_server_enforced(self):
        server = (ROOT / "app/lifeos_voice_server.py").read_text()
        auth = (ROOT / "app/lifeos_auth_analytics.py").read_text()
        controller = (ROOT / "web/lifeos_voice/assets/lifeos_auth_v1.js").read_text()
        self.assertIn("require_complete_profile(user)", server)
        self.assertIn('path == "/api/account-profile"', server)
        self.assertIn("PROFILE_REQUIRED", server)
        self.assertIn("def require_complete_profile(user):", auth)
        self.assertIn('fetch("/api/account-profile"', controller)
        self.assertIn('data-lifeos-profile-completion', controller)

    def test_privacy_and_terms_disclose_account_fields_and_age(self):
        privacy = (ROOT / "web/lifeos_voice/privacy.html").read_text()
        terms = (ROOT / "web/lifeos_voice/terms.html").read_text()
        self.assertIn("first name, surname, date of birth, country, optional phone number", privacy)
        self.assertIn("Public account registration requires the user to confirm an age of at least 13", privacy)
        self.assertIn("Accounts and minimum age", terms)

    def test_account_node_simulation(self):
        result = subprocess.run(
            ["node", "tests/test_lifeos_account_flows.js"], cwd=ROOT,
            capture_output=True, text=True, timeout=10, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("LifeOS account flow simulation passed", result.stdout)


if __name__ == "__main__":
    unittest.main()
