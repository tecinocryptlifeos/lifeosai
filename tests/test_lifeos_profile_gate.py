import http.client
import json
import threading
import unittest
from datetime import date
from http.server import ThreadingHTTPServer
from unittest import mock

from app import lifeos_auth_analytics as auth
from app import lifeos_voice_server as server


USER = {
    "id": "00000000-0000-4000-8000-000000000001",
    "email": "user@example.com",
    "user_metadata": {"full_name": "Example User"},
}


class ProfileValidationTests(unittest.TestCase):
    def test_required_profile_accepts_adult_and_rejects_child(self):
        with mock.patch.dict("os.environ", {"LIFEOS_MINIMUM_AGE": "13"}, clear=True):
            values = auth._profile_payload({
                "first_name": " Ada ",
                "surname": " Okafor ",
                "date_of_birth": "1990-05-10",
                "country": " Nigeria ",
                "phone": " +2348000000000 ",
                "accept_terms": True,
            })
            self.assertEqual(values["full_name"], "Ada Okafor")
            self.assertEqual(values["country"], "Nigeria")
            self.assertTrue(values["minimum_age_confirmed"])
            current_child_year = date.today().year - 10
            with self.assertRaisesRegex(ValueError, "minimum age"):
                auth._profile_payload({
                    "first_name": "Young",
                    "surname": "User",
                    "date_of_birth": f"{current_child_year}-01-01",
                    "country": "Nigeria",
                    "accept_terms": True,
                })

    def test_profile_complete_requires_every_mandatory_field_and_terms(self):
        complete = {
            "first_name": "Ada",
            "surname": "Okafor",
            "date_of_birth": "1990-05-10",
            "country": "Nigeria",
            "terms_accepted_at": "2026-07-17T00:00:00+00:00",
        }
        self.assertTrue(auth._profile_complete(complete))
        for field in ("first_name", "surname", "date_of_birth", "country", "terms_accepted_at"):
            incomplete = dict(complete)
            incomplete[field] = None
            with self.subTest(field=field):
                self.assertFalse(auth._profile_complete(incomplete))

    def test_profile_update_changes_user_metadata_then_reloads_profile(self):
        updated_user = dict(USER)
        updated_user["user_metadata"] = {
            "first_name": "Ada",
            "surname": "Okafor",
            "full_name": "Ada Okafor",
            "date_of_birth": "1990-05-10",
            "country": "Nigeria",
            "terms_accepted_at": "2026-07-17T00:00:00+00:00",
        }
        complete_result = {"ok": True, "complete": True, "profile": updated_user["user_metadata"]}
        with mock.patch.object(auth, "_auth_admin_request", return_value=(200, updated_user)) as request, \
                mock.patch.object(auth, "account_profile", return_value=complete_result):
            result = auth.update_account_profile(USER, {
                "first_name": "Ada",
                "surname": "Okafor",
                "date_of_birth": "1990-05-10",
                "country": "Nigeria",
                "phone": "",
                "accept_terms": True,
            })
        self.assertTrue(result["complete"])
        payload = request.call_args.kwargs["payload"]["user_metadata"]
        self.assertEqual(payload["full_name"], "Ada Okafor")
        self.assertTrue(payload["minimum_age_confirmed"])


class ProfileRouteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.LifeOSVoiceHandler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.host = "127.0.0.1"
        cls.port = cls.httpd.server_port

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection(self.host, self.port, timeout=3)
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Authorization": "Bearer test-token"}
        if body is not None:
            headers["Content-Type"] = "application/json"
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, data

    def test_incomplete_profile_is_allowed_to_open_profile_endpoint(self):
        result = {"ok": True, "complete": False, "profile": {"email": USER["email"]}}
        with mock.patch.object(server, "verify_user", return_value=(USER, "test-token")), \
                mock.patch.object(server, "account_profile", return_value=result):
            status, data = self.request("GET", "/api/account-profile")
        self.assertEqual(status, 200)
        self.assertFalse(data["complete"])

    def test_incomplete_profile_is_blocked_from_sophia_endpoint(self):
        with mock.patch.object(server, "verify_user", return_value=(USER, "test-token")), \
                mock.patch.object(server, "require_complete_profile", side_effect=PermissionError("Complete your LifeOS profile before using Sophia")):
            status, data = self.request("POST", "/api/gemini-live-token", {})
        self.assertEqual(status, 403)
        self.assertEqual(data["code"], "PROFILE_REQUIRED")

    def test_profile_endpoint_accepts_valid_completion(self):
        result = {"ok": True, "complete": True, "profile": {"first_name": "Ada"}}
        with mock.patch.object(server, "verify_user", return_value=(USER, "test-token")), \
                mock.patch.object(server, "update_account_profile", return_value=result):
            status, data = self.request("POST", "/api/account-profile", {
                "first_name": "Ada",
                "surname": "Okafor",
                "date_of_birth": "1990-05-10",
                "country": "Nigeria",
                "accept_terms": True,
            })
        self.assertEqual(status, 200)
        self.assertTrue(data["complete"])


if __name__ == "__main__":
    unittest.main()
