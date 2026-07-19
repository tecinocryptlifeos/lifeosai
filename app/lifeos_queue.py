"""LifeOS Queue scheduling and validation foundation.

Human-facing name: LifeOS Queue
Technical identifier: lifeos_queue

This module does not send email and contains no Gmail credentials.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parseaddr
from typing import Iterable

DISPLAY_NAME = "LifeOS Queue"
TECHNICAL_NAME = "lifeos_queue"
VERSION = "1.0.1"

DEFAULT_SENDER_EMAIL = os.environ.get(
    "LIFEOS_QUEUE_GMAIL_ADDRESS",
    "losaiadminpatric@gmail.com",
).strip()


@dataclass(frozen=True)
class QueuePolicy:
    daily_send_limit: int = 10
    send_interval_minutes: int = 30
    reply_sync_minutes: int = 15
    max_attempts: int = 3

    def validate(self) -> None:
        if not 1 <= self.daily_send_limit <= 100:
            raise ValueError("daily_send_limit must be between 1 and 100")
        if not 1 <= self.send_interval_minutes <= 1440:
            raise ValueError("send_interval_minutes must be between 1 and 1440")
        if not 1 <= self.reply_sync_minutes <= 1440:
            raise ValueError("reply_sync_minutes must be between 1 and 1440")
        if not 1 <= self.max_attempts <= 10:
            raise ValueError("max_attempts must be between 1 and 10")


def normalize_email(value: str) -> str:
    raw = str(value or "").strip()
    _, parsed = parseaddr(raw)

    if (
        not parsed
        or parsed.count("@") != 1
        or parsed.startswith("@")
        or parsed.endswith("@")
        or " " in parsed
    ):
        raise ValueError(f"Invalid recipient email address: {raw!r}")

    local_part, domain = parsed.rsplit("@", 1)
    if not local_part or "." not in domain:
        raise ValueError(f"Invalid recipient email address: {raw!r}")

    return f"{local_part}@{domain.lower()}"


def build_schedule(
    recipients: Iterable[str],
    *,
    start_at: datetime | None = None,
    policy: QueuePolicy | None = None,
) -> list[dict[str, object]]:
    active_policy = policy or QueuePolicy()
    active_policy.validate()

    start = start_at or datetime.now(timezone.utc)
    if start.tzinfo is None:
        raise ValueError("start_at must include timezone information")

    normalized: list[str] = []
    seen: set[str] = set()

    for recipient in recipients:
        address = normalize_email(recipient)
        identity = address.casefold()
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(address)

    if len(normalized) > active_policy.daily_send_limit:
        raise ValueError(
            "Recipient count exceeds the LifeOS Queue daily limit "
            f"of {active_policy.daily_send_limit}"
        )

    return [
        {
            "queue_position": position,
            "recipient_email": recipient,
            "scheduled_at": (
                start
                + timedelta(
                    minutes=(position - 1)
                    * active_policy.send_interval_minutes
                )
            ).isoformat(),
            "status": "scheduled",
        }
        for position, recipient in enumerate(normalized, start=1)
    ]


def status_report() -> dict[str, object]:
    policy = QueuePolicy()
    policy.validate()
    return {
        "display_name": DISPLAY_NAME,
        "technical_name": TECHNICAL_NAME,
        "version": VERSION,
        "sender_email": DEFAULT_SENDER_EMAIL,
        "policy": asdict(policy),
        "gmail_delivery_enabled": False,
        "supabase_migration_applied": False,
        "production_email_sending_enabled": False,
    }


if __name__ == "__main__":
    print(json.dumps(status_report(), indent=2, sort_keys=True))
