#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "app" / "lifeos_queue.py"

spec = importlib.util.spec_from_file_location("lifeos_queue", MODULE_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("ABORT: LifeOS Queue module could not be loaded")

module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

assert module.DISPLAY_NAME == "LifeOS Queue"
assert module.TECHNICAL_NAME == "lifeos_queue"

policy = module.QueuePolicy()
policy.validate()
assert policy.daily_send_limit == 10
assert policy.send_interval_minutes == 30
assert policy.reply_sync_minutes == 15
assert policy.max_attempts == 3

start = datetime(2026, 7, 19, 8, 0, tzinfo=timezone.utc)
recipients = [f"member{number}@example.com" for number in range(1, 11)]
schedule = module.build_schedule(recipients, start_at=start, policy=policy)

assert len(schedule) == 10
assert schedule[0]["scheduled_at"] == "2026-07-19T08:00:00+00:00"
assert schedule[1]["scheduled_at"] == "2026-07-19T08:30:00+00:00"
assert schedule[9]["scheduled_at"] == "2026-07-19T12:30:00+00:00"

duplicates = module.build_schedule(
    ["Member1@example.com", "member1@EXAMPLE.COM", "member2@example.com"],
    start_at=start,
    policy=policy,
)
assert len(duplicates) == 2

try:
    module.build_schedule(
        [f"member{number}@example.com" for number in range(1, 12)],
        start_at=start,
        policy=policy,
    )
except ValueError:
    pass
else:
    raise AssertionError("Daily limit validation did not activate")

try:
    module.normalize_email("not-an-email")
except ValueError:
    pass
else:
    raise AssertionError("Invalid email validation did not activate")

report = module.status_report()
assert report["gmail_delivery_enabled"] is False
assert report["production_email_sending_enabled"] is False

print("LIFEOS_QUEUE_DISPLAY_NAME: passed")
print("LIFEOS_QUEUE_TECHNICAL_NAME: passed")
print("DAILY_SEND_LIMIT_10: passed")
print("SEND_INTERVAL_30_MINUTES: passed")
print("REPLY_SYNC_INTERVAL_15_MINUTES: passed")
print("DUPLICATE_RECIPIENT_PROTECTION: passed")
print("INVALID_EMAIL_PROTECTION: passed")
print("PRODUCTION_SENDING_DISABLED_BY_DEFAULT: passed")
print("LIFEOS_QUEUE_FOUNDATION_TEST: passed")
