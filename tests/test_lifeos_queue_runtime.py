import base64
import json
import os
import time
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from pathlib import Path
from unittest import mock

from app import lifeos_queue_runtime as queue


ROOT = Path(__file__).resolve().parents[1]


def runtime_config(**overrides):
    values = {
        "gmail_address": "losaiadminpatric@gmail.com",
        "google_client_id": "client.apps.googleusercontent.com",
        "google_client_secret": "client-secret-private",
        "google_refresh_token": "refresh-token-private",
        "supabase_url": "https://example.supabase.co",
        "supabase_secret_key": "sb_secret_private",
        "internal_secret": "internal-secret-private",
        "worker_enabled": True,
        "poll_seconds": 60,
        "reply_sync_seconds": 900,
    }
    values.update(overrides)
    return queue.QueueRuntimeConfig(**values)


class FakeStore:
    def __init__(self):
        self.settings_value = {
            "enabled": True,
            "sender_email": "losaiadminpatric@gmail.com",
            "daily_send_limit": 10,
            "send_interval_minutes": 30,
        }
        self.latest = None
        self.claimed = {
            "id": "00000000-0000-4000-8000-000000000010",
            "sender_email": "losaiadminpatric@gmail.com",
            "recipient_email": "member@example.com",
            "recipient_name": "Member",
            "subject": "Welcome to LifeOS",
            "body_text": "Welcome.",
            "body_html": "",
            "metadata": {},
        }
        self.marked_sent = []
        self.marked_failed = []
        self.runs = []
        self.parents = []
        self.inbound = set()
        self.replies = []
        self.enqueued = []
        self.recent = []

    def settings(self):
        return dict(self.settings_value)

    def latest_sent_at(self):
        return self.latest

    def enqueue_invitation(self, payload, idempotency_key):
        self.enqueued.append((dict(payload), idempotency_key))
        return {
            "id": "00000000-0000-4000-8000-000000000020",
            **payload,
            "attempts": 0,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }, True

    def recent_messages(self, limit=30):
        return list(self.recent[:limit])

    def claim_next(self, worker_id):
        return dict(self.claimed) if self.claimed else None

    def mark_sent(self, *args):
        self.marked_sent.append(args)
        return True

    def mark_failed(self, *args):
        self.marked_failed.append(args)
        return True

    def record_run(self, **values):
        self.runs.append(values)

    def reply_candidates(self, limit=50):
        return list(self.parents)

    def inbound_exists(self, gmail_message_id):
        return gmail_message_id in self.inbound

    def record_reply(self, parent, message, **values):
        self.inbound.add(message["id"])
        self.replies.append((parent, message, values))


class FakeGmail:
    def __init__(self):
        self.profile_calls = 0
        self.send_calls = []
        self.sent_result = {
            "id": "gmail-message-1",
            "threadId": "gmail-thread-1",
            "deduplicated": False,
        }
        self.threads = {}

    def verified_profile(self, force=False):
        self.profile_calls += 1
        return "losaiadminpatric@gmail.com"

    def send(self, message):
        self.send_calls.append(message)
        return dict(self.sent_result)

    def thread_metadata(self, thread_id):
        return self.threads[thread_id]


class QueueConfigurationTests(unittest.TestCase):
    def test_production_claim_migration_has_spacing_and_concurrency_guards(self):
        migration = (
            ROOT
            / "supabase"
            / "migrations"
            / "20260720172432_lifeos_queue_runtime_v1_1_0.sql"
        )
        source = migration.read_text(encoding="utf-8")
        self.assertIn("pg_advisory_xact_lock", source)
        self.assertIn("v_send_interval", source)
        self.assertIn("v_active_claims", source)
        self.assertIn("revoke all on function", source.lower())

    def test_default_runtime_is_disabled_and_never_exposes_secret_values(self):
        environment = {
            "LIFEOS_QUEUE_GOOGLE_CLIENT_ID": "client.apps.googleusercontent.com",
            "LIFEOS_QUEUE_GOOGLE_CLIENT_SECRET": "secret-must-not-leak",
            "LIFEOS_QUEUE_GOOGLE_REFRESH_TOKEN": "refresh-must-not-leak",
            "LIFEOS_QUEUE_INTERNAL_SECRET": "internal-must-not-leak",
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_SECRET_KEY": "supabase-must-not-leak",
        }
        with mock.patch.dict(os.environ, environment, clear=True):
            config = queue.QueueRuntimeConfig.from_env()
            report = config.safe_status()
        self.assertFalse(config.worker_enabled)
        self.assertTrue(report["delivery_configuration_complete"])
        rendered = str(report)
        for secret in (
            "secret-must-not-leak",
            "refresh-must-not-leak",
            "internal-must-not-leak",
            "supabase-must-not-leak",
        ):
            self.assertNotIn(secret, rendered)

    def test_internal_route_secret_is_required(self):
        with mock.patch.dict(
            os.environ,
            {"LIFEOS_QUEUE_INTERNAL_SECRET": "correct-secret"},
            clear=True,
        ):
            self.assertTrue(
                queue.queue_internal_authorized(
                    {"X-LifeOS-Queue-Secret": "correct-secret"}
                )
            )
            self.assertFalse(
                queue.queue_internal_authorized(
                    {"X-LifeOS-Queue-Secret": "wrong-secret"}
                )
            )
            self.assertFalse(queue.queue_internal_authorized({}))


class GmailMessageTests(unittest.TestCase):
    def test_sent_deduplication_search_uses_rfc822_id_without_brackets(self):
        captured = {}

        def transport(url, **_kwargs):
            captured["url"] = url
            return 200, {"messages": []}

        client = queue.GmailQueueClient(runtime_config(), transport=transport)
        client._access_token = "access-token"
        client._access_token_expires_at = time.monotonic() + 3600
        self.assertIsNone(client.find_sent("<lifeos-queue-message@gmail.com>"))
        decoded_url = urllib.parse.unquote(captured["url"])
        self.assertIn("rfc822msgid:lifeos-queue-message@gmail.com", decoded_url)
        self.assertNotIn("rfc822msgid:<", decoded_url)

    def test_mime_message_uses_verified_sender_and_deterministic_id(self):
        client = queue.GmailQueueClient(runtime_config())
        row = {
            "id": "00000000-0000-4000-8000-000000000010",
            "sender_email": "losaiadminpatric@gmail.com",
            "recipient_email": "Member@Example.com",
            "recipient_name": "Test Member",
            "subject": "LifeOS invitation",
            "body_text": "Welcome to LifeOS.",
            "body_html": "<p>Welcome to LifeOS.</p>",
        }
        rfc822_id, raw = client._mime_message(row)
        parsed = BytesParser(policy=policy.default).parsebytes(
            base64.urlsafe_b64decode(raw)
        )
        self.assertEqual(parsed["Reply-To"], "losaiadminpatric@gmail.com")
        self.assertIn("losaiadminpatric@gmail.com", parsed["From"])
        self.assertIn("member@example.com", parsed["To"].lower())
        self.assertEqual(parsed["Message-ID"], rfc822_id)
        self.assertIn(row["id"], rfc822_id)
        self.assertNotIn("client-secret-private", raw)
        self.assertNotIn("refresh-token-private", raw)

    def test_mime_message_rejects_sender_mismatch(self):
        client = queue.GmailQueueClient(runtime_config())
        with self.assertRaisesRegex(ValueError, "does not match"):
            client._mime_message(
                {
                    "id": "message-1",
                    "sender_email": "lifeostecinoai@gmail.com",
                    "recipient_email": "member@example.com",
                    "subject": "Subject",
                    "body_text": "Body",
                }
            )


class QueueInvitationTests(unittest.TestCase):
    actor_id = "00000000-0000-4000-8000-000000000001"
    request_id = "00000000-0000-4000-8000-000000000002"

    def values(self, **overrides):
        values = {
            "request_id": self.request_id,
            "approved": True,
            "recipient_name": "Test Member",
            "recipient_email": "Member@Example.com",
            "subject": "You're invited to explore LifeOS",
            "body_text": "Hello,\n\nYou are invited to explore the LifeOS public interface.",
            "invitation_url": "https://losai.onrender.com",
        }
        values.update(overrides)
        return values

    def test_admin_invitation_uses_fixed_sender_and_canonical_link(self):
        payload, key = queue._invitation_payload(
            runtime_config(),
            self.values(body_text="Hello, this is the approved LifeOS invitation message."),
            created_by=self.actor_id,
        )
        self.assertEqual(payload["sender_email"], "losaiadminpatric@gmail.com")
        self.assertEqual(payload["recipient_email"], "Member@example.com")
        self.assertEqual(payload["message_type"], "invitation")
        self.assertEqual(payload["status"], "queued")
        self.assertIn("https://losai.onrender.com", payload["body_text"])
        self.assertEqual(payload["created_by"], self.actor_id)
        self.assertEqual(
            key,
            f"lifeos-admin-invitation:{self.actor_id}:{self.request_id}",
        )
        self.assertNotIn("client-secret-private", json.dumps(payload))

    def test_invitation_rejects_unapproved_sender_override_and_external_url(self):
        with self.assertRaisesRegex(ValueError, "approve"):
            queue._invitation_payload(
                runtime_config(),
                self.values(approved=False),
                created_by=self.actor_id,
            )
        with self.assertRaisesRegex(ValueError, "sender is fixed"):
            queue._invitation_payload(
                runtime_config(),
                self.values(sender_email="lifeostecinoai@gmail.com"),
                created_by=self.actor_id,
            )
        with self.assertRaisesRegex(ValueError, "losai.onrender.com"):
            queue._invitation_payload(
                runtime_config(),
                self.values(invitation_url="https://example.com/invite"),
                created_by=self.actor_id,
            )

    def test_runtime_queues_once_without_bypassing_database_gate(self):
        store = FakeStore()
        store.settings_value["enabled"] = False
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=FakeGmail(),
            worker_id="worker-test",
        )
        result = runtime.enqueue_invitation(
            self.values(),
            created_by=self.actor_id,
        )
        self.assertTrue(result["created"])
        self.assertFalse(result["delivery_gate_enabled"])
        self.assertEqual(len(store.enqueued), 1)
        self.assertEqual(store.enqueued[0][0]["max_attempts"], 3)
        self.assertEqual(result["message"]["status"], "queued")

    def test_store_returns_existing_row_for_a_duplicate_request(self):
        calls = []
        existing = {
            "id": "00000000-0000-4000-8000-000000000020",
            "direction": "outbound",
            "message_type": "invitation",
            "status": "queued",
            "recipient_email": "member@example.com",
            "subject": "LifeOS invitation",
            "body_text": "Approved invitation",
        }

        def transport(url, **kwargs):
            calls.append((url, kwargs))
            return (201, []) if kwargs["method"] == "POST" else (200, [existing])

        store = queue.SupabaseQueueStore(runtime_config(), transport=transport)
        row, created = store.enqueue_invitation(
            {"idempotency_key": "same-request"},
            "same-request",
        )
        self.assertFalse(created)
        self.assertEqual(row["id"], existing["id"])
        self.assertEqual(len(calls), 2)
        self.assertIn("on_conflict=idempotency_key", calls[0][0])
        self.assertIn("resolution=ignore-duplicates", calls[0][1]["headers"]["Prefer"])

    def test_admin_snapshot_exposes_message_preview_but_no_credentials(self):
        store = FakeStore()
        store.recent = [{
            "id": "message-1",
            "direction": "inbound",
            "message_type": "reply",
            "status": "replied",
            "sender_email": "member@example.com",
            "recipient_email": "losaiadminpatric@gmail.com",
            "subject": "Re: LifeOS invitation",
            "body_text": "Thank you. I received the invitation.",
            "gmail_message_id": "private-gmail-id",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }]
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=FakeGmail(),
            worker_id="worker-test",
        )
        result = runtime.admin_snapshot()
        rendered = json.dumps(result)
        self.assertIn("Thank you. I received the invitation.", rendered)
        self.assertNotIn("private-gmail-id", rendered)
        self.assertNotIn("client-secret-private", rendered)
        self.assertFalse(result["automatic_reply_enabled"])


class QueueDispatchTests(unittest.TestCase):
    def test_worker_flag_blocks_every_delivery_action(self):
        store = FakeStore()
        gmail = FakeGmail()
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(worker_enabled=False),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        result = runtime.dispatch_once()
        self.assertEqual(result, {"status": "skipped", "reason": "worker_disabled"})
        self.assertEqual(gmail.profile_calls, 0)
        self.assertEqual(gmail.send_calls, [])
        self.assertEqual(store.marked_sent, [])

    def test_database_flag_blocks_delivery_before_gmail_access(self):
        store = FakeStore()
        store.settings_value["enabled"] = False
        gmail = FakeGmail()
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        result = runtime.dispatch_once()
        self.assertEqual(result["reason"], "database_queue_disabled")
        self.assertEqual(gmail.profile_calls, 0)
        self.assertEqual(gmail.send_calls, [])

    def test_send_interval_blocks_early_claim(self):
        store = FakeStore()
        store.latest = datetime.now(timezone.utc) - timedelta(minutes=5)
        gmail = FakeGmail()
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        result = runtime.dispatch_once()
        self.assertEqual(result["reason"], "send_interval_active")
        self.assertGreater(result["retry_after_seconds"], 0)
        self.assertEqual(gmail.send_calls, [])

    def test_successful_dispatch_verifies_gmail_and_marks_supabase(self):
        store = FakeStore()
        gmail = FakeGmail()
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        result = runtime.dispatch_once()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["sent"], 1)
        self.assertEqual(gmail.profile_calls, 1)
        self.assertEqual(len(gmail.send_calls), 1)
        self.assertEqual(
            store.marked_sent[0],
            (
                store.claimed["id"],
                "worker-test",
                "gmail-message-1",
                "gmail-thread-1",
            ),
        )
        self.assertEqual(store.runs[0]["status"], "completed")

    def test_send_failure_releases_claim_without_leaking_secret(self):
        store = FakeStore()
        gmail = FakeGmail()
        gmail.send = mock.Mock(side_effect=RuntimeError("failed client-secret-private"))
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        with self.assertRaises(RuntimeError):
            runtime.dispatch_once()
        self.assertEqual(len(store.marked_failed), 1)
        self.assertNotIn("client-secret-private", store.marked_failed[0][2])
        self.assertIn("[REDACTED]", store.marked_failed[0][2])


class QueueReplySyncTests(unittest.TestCase):
    def test_reply_sync_records_only_external_messages_after_send(self):
        store = FakeStore()
        sent_at = datetime.now(timezone.utc) - timedelta(minutes=10)
        store.parents = [
            {
                "id": "parent-1",
                "recipient_email": "member@example.com",
                "sent_at": sent_at.isoformat(),
                "gmail_message_id": "gmail-outbound",
                "gmail_thread_id": "thread-1",
                "status": "sent",
            }
        ]
        gmail = FakeGmail()
        gmail.threads["thread-1"] = {
            "messages": [
                {
                    "id": "gmail-outbound",
                    "threadId": "thread-1",
                    "internalDate": str(int(sent_at.timestamp() * 1000)),
                    "payload": {
                        "headers": [
                            {"name": "From", "value": "LifeOS Queue <losaiadminpatric@gmail.com>"}
                        ]
                    },
                },
                {
                    "id": "gmail-inbound",
                    "threadId": "thread-1",
                    "internalDate": str(int(datetime.now(timezone.utc).timestamp() * 1000)),
                    "snippet": "Short preview only.",
                    "payload": {
                        "mimeType": "text/plain",
                        "body": {
                            "data": base64.urlsafe_b64encode(
                                b"Thank you for the invitation. This is the full reply."
                            ).decode("ascii").rstrip("=")
                        },
                        "headers": [
                            {"name": "From", "value": "Member <member@example.com>"},
                            {"name": "Subject", "value": "Re: LifeOS invitation"},
                        ]
                    },
                },
            ]
        }
        runtime = queue.LifeOSQueueRuntime(
            runtime_config(),
            store=store,
            gmail=gmail,
            worker_id="worker-test",
        )
        result = runtime.sync_replies_once()
        self.assertEqual(result["replies_recorded"], 1)
        self.assertEqual(len(store.replies), 1)
        self.assertEqual(store.replies[0][2]["sender_email"], "member@example.com")
        self.assertEqual(
            queue._gmail_body_text(store.replies[0][1]),
            "Thank you for the invitation. This is the full reply.",
        )


if __name__ == "__main__":
    unittest.main()
