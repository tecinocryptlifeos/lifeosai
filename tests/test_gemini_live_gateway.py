"""Focused tests for the LOSAI Gemini Live token gateway."""

from __future__ import annotations

import importlib.util
import os
import sys
import types as pytypes
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
GATEWAY_PATH = ROOT / "app" / "gemini_live_gateway.py"


def load_gateway():
    name = "lifeos_test_gemini_live_gateway"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, GATEWAY_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class FakeHttpOptions:
    def __init__(self, **kwargs):
        self.kwargs = kwargs


class FakeAuthTokens:
    def __init__(self, capture):
        self.capture = capture

    def create(self, *, config):
        self.capture.append(config)
        return pytypes.SimpleNamespace(name=f"auth_tokens/test-{len(self.capture)}")


class FakeClient:
    captures = []
    clients = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.closed = False
        self.auth_tokens = FakeAuthTokens(self.captures)
        self.clients.append(self)

    def close(self):
        self.closed = True


class GatewayTests(unittest.TestCase):
    def setUp(self):
        FakeClient.captures.clear()
        FakeClient.clients.clear()
        self.environment = mock.patch.dict(
            os.environ,
            {
                "GEMINI_API_KEY": "test-only-key",
                "LIFEOS_GEMINI_LIVE_PRIMARY_MODEL": "gemini-3.1-flash-live-preview",
                "LIFEOS_GEMINI_LIVE_FALLBACK_MODEL": (
                    "gemini-2.5-flash-native-audio-preview-12-2025"
                ),
            },
            clear=False,
        )
        self.environment.start()
        self.gateway = load_gateway()

        google_module = pytypes.ModuleType("google")
        genai_module = pytypes.ModuleType("google.genai")
        types_module = pytypes.ModuleType("google.genai.types")
        genai_module.Client = FakeClient
        genai_module.types = types_module
        types_module.HttpOptions = FakeHttpOptions
        google_module.genai = genai_module

        self.module_patch = mock.patch.dict(
            sys.modules,
            {
                "google": google_module,
                "google.genai": genai_module,
                "google.genai.types": types_module,
            },
        )
        self.module_patch.start()
        self.gateway._LAST_ISSUE_TIME.clear()

    def tearDown(self):
        self.module_patch.stop()
        self.environment.stop()

    def test_primary_and_fallback_tokens_are_constrained_and_separate(self):
        primary = self.gateway.create_gemini_live_token("client", "primary")
        fallback = self.gateway.create_gemini_live_token("client", "fallback")

        self.assertEqual(primary["model"], "gemini-3.1-flash-live-preview")
        self.assertEqual(primary["model_preference"], "primary")
        self.assertEqual(
            fallback["model"],
            "gemini-2.5-flash-native-audio-preview-12-2025",
        )
        self.assertEqual(fallback["model_preference"], "fallback")
        self.assertTrue(primary["fallback_available"])
        self.assertEqual(len(FakeClient.captures), 2)

        primary_config = FakeClient.captures[0]
        fallback_config = FakeClient.captures[1]
        self.assertEqual(
            primary_config["live_connect_constraints"]["model"],
            "gemini-3.1-flash-live-preview",
        )
        self.assertEqual(
            fallback_config["live_connect_constraints"]["model"],
            "gemini-2.5-flash-native-audio-preview-12-2025",
        )
        self.assertEqual(
            primary_config["live_connect_constraints"]["config"]
            ["response_modalities"],
            ["AUDIO"],
        )
        self.assertEqual(
            primary_config["live_connect_constraints"]["config"]
            ["session_resumption"],
            {},
        )
        self.assertEqual(primary_config["lock_additional_fields"], [])
        self.assertTrue(all(client.closed for client in FakeClient.clients))

    def test_same_model_lane_is_rate_limited(self):
        self.gateway.create_gemini_live_token("client", "primary")
        with self.assertRaises(self.gateway.GeminiLiveRateLimit):
            self.gateway.create_gemini_live_token("client", "primary")

    def test_invalid_preference_fails_closed_to_primary(self):
        result = self.gateway.create_gemini_live_token("other", "anything")
        self.assertEqual(result["model_preference"], "primary")
        self.assertEqual(result["model"], "gemini-3.1-flash-live-preview")

    def test_status_reports_truthful_primary_and_fallback_policy(self):
        status = self.gateway.gemini_live_status()
        self.assertEqual(status["version"], "2.0.0")
        self.assertEqual(status["model"], "gemini-3.1-flash-live-preview")
        self.assertEqual(
            status["fallback_model"],
            "gemini-2.5-flash-native-audio-preview-12-2025",
        )
        self.assertTrue(status["fallback_enabled"])
        self.assertEqual(
            status["authentication"],
            "constrained-ephemeral-token",
        )


if __name__ == "__main__":
    unittest.main()
