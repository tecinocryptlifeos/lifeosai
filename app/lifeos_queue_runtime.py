"""Production runtime for the LifeOS Queue.

The runtime keeps Gmail OAuth and Supabase credentials on the server, claims
at most one due message per cycle, and remains disabled until both the Render
worker flag and the database setting are explicitly enabled.
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formataddr, format_datetime, parseaddr
from typing import Any, Callable

try:
    from lifeos_queue import normalize_email
except ImportError:
    from app.lifeos_queue import normalize_email


RUNTIME_VERSION = "1.1.0"
DEFAULT_GMAIL_ADDRESS = "losaiadminpatric@gmail.com"
DEFAULT_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
DEFAULT_GMAIL_API_ROOT = "https://gmail.googleapis.com/gmail/v1"
TRUE_VALUES = {"1", "true", "yes", "on"}


class QueueRuntimeError(RuntimeError):
    """Base error for queue runtime failures."""


class QueueRemoteError(QueueRuntimeError):
    """A sanitized upstream HTTP failure."""

    def __init__(self, service: str, status: int, code: str, detail: str):
        self.service = service
        self.status = int(status)
        self.code = str(code or "upstream_error")[:100]
        self.detail = " ".join(str(detail or "Request failed").split())[:500]
        super().__init__(
            f"{self.service} request failed ({self.status}): "
            f"{self.code}: {self.detail}"
        )


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _enabled(name: str, default: bool = False) -> bool:
    value = _env(name)
    if not value:
        return default
    return value.lower() in TRUE_VALUES


def _integer(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(_env(name) or default)
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_header(value: Any, maximum: int = 998) -> str:
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())[:maximum]


def _error_parts(payload: Any) -> tuple[str, str]:
    if not isinstance(payload, dict):
        return "upstream_error", "The upstream service rejected the request."
    error = payload.get("error")
    if isinstance(error, dict):
        code = error.get("status") or error.get("code") or "upstream_error"
        detail = error.get("message") or "The upstream service rejected the request."
        return str(code), str(detail)
    code = error or payload.get("code") or "upstream_error"
    detail = payload.get("error_description") or payload.get("message") or "Request failed."
    return str(code), str(detail)


def _request_json(
    url: str,
    *,
    service: str,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    json_body: Any = None,
    form_body: dict[str, str] | None = None,
    timeout: int = 25,
) -> tuple[int, Any]:
    body = None
    request_headers = dict(headers or {})
    if json_body is not None:
        body = json.dumps(json_body, separators=(",", ":")).encode("utf-8")
        request_headers.setdefault("Content-Type", "application/json")
    elif form_body is not None:
        body = urllib.parse.urlencode(form_body).encode("utf-8")
        request_headers.setdefault(
            "Content-Type",
            "application/x-www-form-urlencoded",
        )

    request = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
            if not raw:
                return int(response.status), None
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise QueueRemoteError(
                    service,
                    int(response.status),
                    "invalid_json",
                    str(error),
                ) from error
            return int(response.status), payload
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"error": "http_error", "message": raw[:500]}
        code, detail = _error_parts(payload)
        raise QueueRemoteError(service, error.code, code, detail) from error
    except urllib.error.URLError as error:
        raise QueueRemoteError(service, 503, "connection_failed", str(error.reason)) from error


@dataclass(frozen=True)
class QueueRuntimeConfig:
    gmail_address: str
    google_client_id: str
    google_client_secret: str
    google_refresh_token: str
    supabase_url: str
    supabase_secret_key: str
    internal_secret: str
    worker_enabled: bool
    poll_seconds: int
    reply_sync_seconds: int
    token_endpoint: str = DEFAULT_TOKEN_ENDPOINT
    gmail_api_root: str = DEFAULT_GMAIL_API_ROOT

    @classmethod
    def from_env(cls) -> "QueueRuntimeConfig":
        return cls(
            gmail_address=_env("LIFEOS_QUEUE_GMAIL_ADDRESS") or DEFAULT_GMAIL_ADDRESS,
            google_client_id=_env("LIFEOS_QUEUE_GOOGLE_CLIENT_ID"),
            google_client_secret=_env("LIFEOS_QUEUE_GOOGLE_CLIENT_SECRET"),
            google_refresh_token=_env("LIFEOS_QUEUE_GOOGLE_REFRESH_TOKEN"),
            supabase_url=_env("SUPABASE_URL").rstrip("/"),
            supabase_secret_key=(
                _env("SUPABASE_SECRET_KEY") or _env("SUPABASE_SERVICE_ROLE_KEY")
            ),
            internal_secret=_env("LIFEOS_QUEUE_INTERNAL_SECRET"),
            worker_enabled=_enabled("LIFEOS_QUEUE_WORKER_ENABLED", False),
            poll_seconds=_integer("LIFEOS_QUEUE_POLL_SECONDS", 60, 30, 3600),
            reply_sync_seconds=_integer(
                "LIFEOS_QUEUE_REPLY_SYNC_SECONDS",
                900,
                300,
                86400,
            ),
            token_endpoint=_env("LIFEOS_QUEUE_TOKEN_ENDPOINT") or DEFAULT_TOKEN_ENDPOINT,
            gmail_api_root=(
                _env("LIFEOS_QUEUE_GMAIL_API_ROOT") or DEFAULT_GMAIL_API_ROOT
            ).rstrip("/"),
        )

    def missing_delivery_settings(self) -> list[str]:
        values = {
            "LIFEOS_QUEUE_GMAIL_ADDRESS": self.gmail_address,
            "LIFEOS_QUEUE_GOOGLE_CLIENT_ID": self.google_client_id,
            "LIFEOS_QUEUE_GOOGLE_CLIENT_SECRET": self.google_client_secret,
            "LIFEOS_QUEUE_GOOGLE_REFRESH_TOKEN": self.google_refresh_token,
            "SUPABASE_URL": self.supabase_url,
            "SUPABASE_SECRET_KEY": self.supabase_secret_key,
        }
        return [name for name, value in values.items() if not value]

    def safe_status(self) -> dict[str, Any]:
        missing = self.missing_delivery_settings()
        return {
            "runtime_version": RUNTIME_VERSION,
            "expected_gmail": self.gmail_address,
            "worker_enabled": self.worker_enabled,
            "delivery_configuration_complete": not missing,
            "internal_auth_configured": bool(self.internal_secret),
            "missing_settings": missing,
            "poll_seconds": self.poll_seconds,
            "reply_sync_seconds": self.reply_sync_seconds,
        }


Transport = Callable[..., tuple[int, Any]]


class GmailQueueClient:
    def __init__(
        self,
        config: QueueRuntimeConfig,
        *,
        transport: Transport = _request_json,
    ):
        self.config = config
        self.transport = transport
        self._access_token = ""
        self._access_token_expires_at = 0.0
        self._profile_email = ""
        self._profile_checked_at = 0.0
        self._lock = threading.Lock()

    def _token(self, *, force: bool = False) -> str:
        with self._lock:
            now = time.monotonic()
            if (
                not force
                and self._access_token
                and now < self._access_token_expires_at - 60
            ):
                return self._access_token
            _, payload = self.transport(
                self.config.token_endpoint,
                service="google_oauth",
                method="POST",
                form_body={
                    "client_id": self.config.google_client_id,
                    "client_secret": self.config.google_client_secret,
                    "refresh_token": self.config.google_refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            if not isinstance(payload, dict) or not payload.get("access_token"):
                raise QueueRuntimeError("Google OAuth returned no access token.")
            try:
                expires_in = max(120, int(payload.get("expires_in") or 3600))
            except (TypeError, ValueError):
                expires_in = 3600
            self._access_token = str(payload["access_token"])
            self._access_token_expires_at = now + expires_in
            return self._access_token

    def _request(
        self,
        path: str,
        *,
        method: str = "GET",
        query: list[tuple[str, str]] | dict[str, str] | None = None,
        payload: Any = None,
        retry_auth: bool = True,
    ) -> Any:
        url = self.config.gmail_api_root + "/users/me/" + path.lstrip("/")
        if query:
            url += "?" + urllib.parse.urlencode(query, doseq=True)
        token = self._token()
        try:
            _, result = self.transport(
                url,
                service="gmail_api",
                method=method,
                headers={
                    "Authorization": "Bearer " + token,
                    "Accept": "application/json",
                },
                json_body=payload,
            )
            return result
        except QueueRemoteError as error:
            if error.status != 401 or not retry_auth:
                raise
            self._token(force=True)
            return self._request(
                path,
                method=method,
                query=query,
                payload=payload,
                retry_auth=False,
            )

    def verified_profile(self, *, force: bool = False) -> str:
        now = time.monotonic()
        if (
            not force
            and self._profile_email
            and now - self._profile_checked_at < 900
        ):
            return self._profile_email
        payload = self._request("profile")
        address = str((payload or {}).get("emailAddress") or "").strip().lower()
        expected = self.config.gmail_address.lower()
        if not address:
            raise QueueRuntimeError("Gmail profile returned no email address.")
        if address != expected:
            raise QueueRuntimeError(
                f"Gmail OAuth belongs to {address}, not {expected}."
            )
        self._profile_email = address
        self._profile_checked_at = now
        return address

    def rfc822_message_id(self, queue_message_id: Any) -> str:
        clean_id = re.sub(r"[^A-Za-z0-9-]", "", str(queue_message_id or ""))
        if not clean_id:
            raise ValueError("Queue message ID is required.")
        domain = self.config.gmail_address.rsplit("@", 1)[-1]
        return f"<lifeos-queue-{clean_id}@{domain}>"

    def _mime_message(self, row: dict[str, Any]) -> tuple[str, str]:
        recipient = normalize_email(str(row.get("recipient_email") or ""))
        sender = normalize_email(str(row.get("sender_email") or self.config.gmail_address))
        if sender.lower() != self.config.gmail_address.lower():
            raise ValueError(
                f"Queue sender {sender} does not match {self.config.gmail_address}."
            )
        subject = _safe_header(row.get("subject"), 998)
        if not subject:
            raise ValueError("Queue message subject is required.")
        body_text = str(row.get("body_text") or "")
        if not body_text.strip():
            raise ValueError("Queue message body is required.")
        invitation_url = str(row.get("invitation_url") or "").strip()
        if invitation_url and invitation_url not in body_text:
            body_text = body_text.rstrip() + "\n\n" + invitation_url

        message = EmailMessage()
        message["From"] = formataddr(("LifeOS Queue", self.config.gmail_address))
        recipient_name = _safe_header(row.get("recipient_name"), 160)
        message["To"] = (
            formataddr((recipient_name, recipient)) if recipient_name else recipient
        )
        message["Reply-To"] = self.config.gmail_address
        message["Subject"] = subject
        message["Date"] = format_datetime(_utc_now())
        message_id = self.rfc822_message_id(row.get("id"))
        message["Message-ID"] = message_id
        message["X-LifeOS-Queue-ID"] = _safe_header(row.get("id"), 100)
        message.set_content(body_text)
        body_html = str(row.get("body_html") or "").strip()
        if body_html:
            message.add_alternative(body_html, subtype="html")

        raw = base64.urlsafe_b64encode(
            message.as_bytes(policy=SMTP)
        ).decode("ascii")
        return message_id, raw

    def find_sent(self, message_id: str) -> dict[str, Any] | None:
        search_id = message_id.strip().strip("<>")
        payload = self._request(
            "messages",
            query={
                "q": f"in:sent rfc822msgid:{search_id}",
                "maxResults": "1",
            },
        )
        messages = (payload or {}).get("messages") or []
        return dict(messages[0]) if messages else None

    def send(self, row: dict[str, Any]) -> dict[str, Any]:
        message_id, raw = self._mime_message(row)
        existing = self.find_sent(message_id)
        if existing:
            return {
                "id": existing.get("id"),
                "threadId": existing.get("threadId"),
                "deduplicated": True,
                "rfc822_message_id": message_id,
            }
        payload: dict[str, Any] = {"raw": raw}
        metadata = row.get("metadata")
        if isinstance(metadata, dict) and metadata.get("gmail_thread_id"):
            payload["threadId"] = str(metadata["gmail_thread_id"])
        result = self._request("messages/send", method="POST", payload=payload)
        if not isinstance(result, dict) or not result.get("id"):
            raise QueueRuntimeError("Gmail send returned no message ID.")
        return {
            "id": result.get("id"),
            "threadId": result.get("threadId"),
            "deduplicated": False,
            "rfc822_message_id": message_id,
        }

    def thread_metadata(self, thread_id: str) -> dict[str, Any]:
        return self._request(
            "threads/" + urllib.parse.quote(str(thread_id), safe=""),
            query=[
                ("format", "metadata"),
                ("metadataHeaders", "From"),
                ("metadataHeaders", "To"),
                ("metadataHeaders", "Subject"),
                ("metadataHeaders", "Date"),
                ("metadataHeaders", "Message-ID"),
            ],
        )


class SupabaseQueueStore:
    def __init__(
        self,
        config: QueueRuntimeConfig,
        *,
        transport: Transport = _request_json,
    ):
        self.config = config
        self.transport = transport

    def _headers(self, prefer: str = "") -> dict[str, str]:
        key = self.config.supabase_secret_key
        headers = {"apikey": key, "Accept": "application/json"}
        if not key.startswith("sb_secret_"):
            headers["Authorization"] = "Bearer " + key
        if prefer:
            headers["Prefer"] = prefer
        return headers

    def _request(
        self,
        resource: str,
        *,
        method: str = "GET",
        query: dict[str, str] | None = None,
        payload: Any = None,
        prefer: str = "",
    ) -> Any:
        url = self.config.supabase_url + "/rest/v1/" + resource.lstrip("/")
        if query:
            url += "?" + urllib.parse.urlencode(query)
        _, result = self.transport(
            url,
            service="supabase_queue",
            method=method,
            headers=self._headers(prefer),
            json_body=payload,
        )
        return result

    def settings(self) -> dict[str, Any]:
        rows = self._request(
            "lifeos_queue_settings",
            query={
                "select": "enabled,sender_email,daily_send_limit,send_interval_minutes,reply_sync_minutes,lock_timeout_minutes,updated_at",
                "singleton_id": "eq.true",
                "limit": "1",
            },
        )
        if not isinstance(rows, list) or not rows:
            raise QueueRuntimeError("LifeOS Queue settings row is missing.")
        return dict(rows[0])

    def latest_sent_at(self) -> datetime | None:
        rows = self._request(
            "lifeos_queue_messages",
            query={
                "select": "sent_at",
                "direction": "eq.outbound",
                "sent_at": "not.is.null",
                "order": "sent_at.desc",
                "limit": "1",
            },
        )
        if not isinstance(rows, list) or not rows:
            return None
        return _parse_datetime(rows[0].get("sent_at"))

    def claim_next(self, worker_id: str) -> dict[str, Any] | None:
        rows = self._request(
            "rpc/lifeos_queue_claim_next",
            method="POST",
            payload={"p_worker_id": worker_id},
        )
        if not isinstance(rows, list) or not rows:
            return None
        return dict(rows[0])

    def mark_sent(
        self,
        message_id: str,
        worker_id: str,
        gmail_message_id: str,
        gmail_thread_id: str,
    ) -> bool:
        result = self._request(
            "rpc/lifeos_queue_mark_sent",
            method="POST",
            payload={
                "p_message_id": message_id,
                "p_worker_id": worker_id,
                "p_gmail_message_id": gmail_message_id,
                "p_gmail_thread_id": gmail_thread_id,
            },
        )
        return result is True

    def mark_failed(self, message_id: str, worker_id: str, error: str) -> bool:
        result = self._request(
            "rpc/lifeos_queue_mark_failed",
            method="POST",
            payload={
                "p_message_id": message_id,
                "p_worker_id": worker_id,
                "p_error": _safe_header(error, 2000),
            },
        )
        return result is True

    def record_run(
        self,
        *,
        run_type: str,
        worker_id: str,
        status: str,
        processed: int,
        succeeded: int,
        failed: int,
        details: dict[str, Any] | None = None,
    ) -> None:
        self._request(
            "lifeos_queue_runs",
            method="POST",
            payload={
                "run_type": run_type,
                "worker_id": worker_id,
                "status": status,
                "processed_count": processed,
                "success_count": succeeded,
                "failed_count": failed,
                "details": details or {},
                "completed_at": _utc_now().isoformat(),
            },
            prefer="return=minimal",
        )

    def reply_candidates(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._request(
            "lifeos_queue_messages",
            query={
                "select": "id,recipient_email,sent_at,gmail_message_id,gmail_thread_id,status",
                "direction": "eq.outbound",
                "status": "in.(sent,delivered,replied)",
                "gmail_thread_id": "not.is.null",
                "order": "sent_at.desc",
                "limit": str(max(1, min(100, limit))),
            },
        )
        return [dict(row) for row in rows] if isinstance(rows, list) else []

    def inbound_exists(self, gmail_message_id: str) -> bool:
        rows = self._request(
            "lifeos_queue_messages",
            query={
                "select": "id",
                "direction": "eq.inbound",
                "gmail_message_id": "eq." + gmail_message_id,
                "limit": "1",
            },
        )
        return bool(isinstance(rows, list) and rows)

    def record_reply(
        self,
        parent: dict[str, Any],
        gmail_message: dict[str, Any],
        *,
        sender_email: str,
        sender_name: str,
        subject: str,
        received_at: datetime,
    ) -> None:
        gmail_message_id = str(gmail_message.get("id") or "")
        if not gmail_message_id:
            raise ValueError("Inbound Gmail message ID is missing.")
        self._request(
            "lifeos_queue_messages",
            method="POST",
            payload={
                "direction": "inbound",
                "message_type": "reply",
                "status": "replied",
                "sender_email": sender_email,
                "recipient_email": self.config.gmail_address,
                "recipient_name": sender_name or None,
                "subject": subject or "(no subject)",
                "body_text": str(gmail_message.get("snippet") or "")[:500],
                "scheduled_at": received_at.isoformat(),
                "sent_at": received_at.isoformat(),
                "delivered_at": received_at.isoformat(),
                "replied_at": received_at.isoformat(),
                "gmail_message_id": gmail_message_id,
                "gmail_thread_id": str(gmail_message.get("threadId") or ""),
                "parent_message_id": parent.get("id"),
                "idempotency_key": "gmail-reply:" + gmail_message_id,
                "metadata": {
                    "source": "gmail_api",
                    "gmail_internal_date": str(gmail_message.get("internalDate") or ""),
                },
            },
            prefer="return=minimal",
        )
        self._request(
            "lifeos_queue_messages",
            method="PATCH",
            query={"id": "eq." + str(parent.get("id")), "direction": "eq.outbound"},
            payload={"status": "replied", "replied_at": received_at.isoformat()},
            prefer="return=minimal",
        )


def _gmail_headers(message: dict[str, Any]) -> dict[str, str]:
    headers = ((message.get("payload") or {}).get("headers") or [])
    return {
        str(item.get("name") or "").lower(): str(item.get("value") or "")
        for item in headers
        if isinstance(item, dict) and item.get("name")
    }


class LifeOSQueueRuntime:
    def __init__(
        self,
        config: QueueRuntimeConfig | None = None,
        *,
        store: SupabaseQueueStore | None = None,
        gmail: GmailQueueClient | None = None,
        worker_id: str = "",
    ):
        self.config = config or QueueRuntimeConfig.from_env()
        self.store = store or SupabaseQueueStore(self.config)
        self.gmail = gmail or GmailQueueClient(self.config)
        self.worker_id = worker_id or (
            f"{socket.gethostname()}-{os.getpid()}-{RUNTIME_VERSION}"
        )
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._state_lock = threading.Lock()
        self._state: dict[str, Any] = {
            "last_dispatch_at": None,
            "last_dispatch_result": None,
            "last_reply_sync_at": None,
            "last_reply_sync_result": None,
            "last_error": None,
        }

    def _safe_error(self, error: BaseException) -> str:
        message = _safe_header(f"{type(error).__name__}: {error}", 1000)
        for secret in (
            self.config.google_client_secret,
            self.config.google_refresh_token,
            self.config.supabase_secret_key,
            self.config.internal_secret,
        ):
            if secret:
                message = message.replace(secret, "[REDACTED]")
        return message

    def _remember(self, **values: Any) -> None:
        with self._state_lock:
            self._state.update(values)

    def status(self, *, check_remote: bool = False) -> dict[str, Any]:
        result = {
            "ok": True,
            "display_name": "LifeOS Queue",
            "technical_name": "lifeos_queue",
            **self.config.safe_status(),
            "background_worker_alive": bool(
                self._thread and self._thread.is_alive()
            ),
        }
        with self._state_lock:
            result.update(self._state)
        if not check_remote:
            return result
        if self.config.missing_delivery_settings():
            result["ok"] = False
            result["remote_check"] = "skipped_missing_configuration"
            return result
        try:
            settings = self.store.settings()
            result.update(
                {
                    "database_reachable": True,
                    "database_queue_enabled": bool(settings.get("enabled")),
                    "database_sender": settings.get("sender_email"),
                    "daily_send_limit": settings.get("daily_send_limit"),
                    "send_interval_minutes": settings.get("send_interval_minutes"),
                    "gmail_profile_verified": self.gmail.verified_profile(force=True),
                    "remote_check": "passed",
                }
            )
        except Exception as error:
            result["ok"] = False
            result["remote_check"] = "failed"
            result["last_error"] = self._safe_error(error)
        return result

    def dispatch_once(self) -> dict[str, Any]:
        now = _utc_now()
        if not self.config.worker_enabled:
            return {"status": "skipped", "reason": "worker_disabled"}
        missing = self.config.missing_delivery_settings()
        if missing:
            return {
                "status": "skipped",
                "reason": "missing_configuration",
                "missing_settings": missing,
            }
        settings = self.store.settings()
        if not settings.get("enabled"):
            return {"status": "skipped", "reason": "database_queue_disabled"}
        database_sender = str(settings.get("sender_email") or "").strip().lower()
        if database_sender != self.config.gmail_address.lower():
            raise QueueRuntimeError(
                "Database sender does not match the verified Gmail account."
            )
        latest = self.store.latest_sent_at()
        interval = max(1, int(settings.get("send_interval_minutes") or 30))
        if latest and now < latest + timedelta(minutes=interval):
            remaining = int((latest + timedelta(minutes=interval) - now).total_seconds())
            return {
                "status": "skipped",
                "reason": "send_interval_active",
                "retry_after_seconds": max(1, remaining),
            }

        self.gmail.verified_profile()
        message = self.store.claim_next(self.worker_id)
        if not message:
            return {"status": "skipped", "reason": "no_due_message"}

        queue_id = str(message.get("id") or "")
        try:
            sent = self.gmail.send(message)
            if not self.store.mark_sent(
                queue_id,
                self.worker_id,
                str(sent.get("id") or ""),
                str(sent.get("threadId") or ""),
            ):
                raise QueueRuntimeError("The claimed message could not be marked sent.")
            result = {
                "status": "completed",
                "processed": 1,
                "sent": 1,
                "deduplicated": bool(sent.get("deduplicated")),
                "queue_message_id": queue_id,
            }
            try:
                self.store.record_run(
                    run_type="send_dispatch",
                    worker_id=self.worker_id,
                    status="completed",
                    processed=1,
                    succeeded=1,
                    failed=0,
                    details={
                        "queue_message_id": queue_id,
                        "deduplicated": result["deduplicated"],
                    },
                )
            except Exception:
                pass
            return result
        except Exception as error:
            safe_error = self._safe_error(error)
            try:
                self.store.mark_failed(queue_id, self.worker_id, safe_error)
                self.store.record_run(
                    run_type="send_dispatch",
                    worker_id=self.worker_id,
                    status="failed",
                    processed=1,
                    succeeded=0,
                    failed=1,
                    details={"queue_message_id": queue_id, "error": safe_error},
                )
            except Exception:
                pass
            raise

    def sync_replies_once(self) -> dict[str, Any]:
        if not self.config.worker_enabled:
            return {"status": "skipped", "reason": "worker_disabled"}
        missing = self.config.missing_delivery_settings()
        if missing:
            return {
                "status": "skipped",
                "reason": "missing_configuration",
                "missing_settings": missing,
            }
        self.gmail.verified_profile()
        parents_by_thread: dict[str, dict[str, Any]] = {}
        for parent in self.store.reply_candidates():
            thread_id = str(parent.get("gmail_thread_id") or "")
            if thread_id and thread_id not in parents_by_thread:
                parents_by_thread[thread_id] = parent

        inserted = 0
        for thread_id, parent in parents_by_thread.items():
            thread = self.gmail.thread_metadata(thread_id)
            sent_at = _parse_datetime(parent.get("sent_at"))
            for message in (thread or {}).get("messages") or []:
                if not isinstance(message, dict):
                    continue
                gmail_id = str(message.get("id") or "")
                if not gmail_id or gmail_id == str(parent.get("gmail_message_id") or ""):
                    continue
                headers = _gmail_headers(message)
                sender_name, sender_email = parseaddr(headers.get("from", ""))
                try:
                    sender_email = normalize_email(sender_email)
                except ValueError:
                    continue
                if sender_email.lower() == self.config.gmail_address.lower():
                    continue
                internal_date = str(message.get("internalDate") or "")
                try:
                    received_at = datetime.fromtimestamp(
                        int(internal_date) / 1000,
                        tz=timezone.utc,
                    )
                except (TypeError, ValueError, OSError):
                    received_at = _utc_now()
                if sent_at and received_at < sent_at:
                    continue
                if self.store.inbound_exists(gmail_id):
                    continue
                self.store.record_reply(
                    parent,
                    message,
                    sender_email=sender_email,
                    sender_name=_safe_header(sender_name, 160),
                    subject=_safe_header(headers.get("subject"), 998),
                    received_at=received_at,
                )
                inserted += 1

        result = {
            "status": "completed",
            "threads_checked": len(parents_by_thread),
            "replies_recorded": inserted,
        }
        if parents_by_thread or inserted:
            try:
                self.store.record_run(
                    run_type="reply_sync",
                    worker_id=self.worker_id,
                    status="completed",
                    processed=len(parents_by_thread),
                    succeeded=inserted,
                    failed=0,
                    details={"replies_recorded": inserted},
                )
            except Exception:
                pass
        return result

    def run(self, mode: str) -> dict[str, Any]:
        mode = str(mode or "verify").strip().lower()
        if mode == "verify":
            return self.status(check_remote=True)
        if mode == "dispatch":
            return self.dispatch_once()
        if mode == "reply_sync":
            return self.sync_replies_once()
        raise ValueError("Mode must be verify, dispatch, or reply_sync.")

    def _loop(self) -> None:
        next_reply_sync = 0.0
        while not self._stop.is_set():
            try:
                dispatch_result = self.dispatch_once()
                self._remember(
                    last_dispatch_at=_utc_now().isoformat(),
                    last_dispatch_result=dispatch_result,
                    last_error=None,
                )
            except Exception as error:
                self._remember(
                    last_dispatch_at=_utc_now().isoformat(),
                    last_dispatch_result={"status": "failed"},
                    last_error=self._safe_error(error),
                )

            if time.monotonic() >= next_reply_sync:
                try:
                    reply_result = self.sync_replies_once()
                    self._remember(
                        last_reply_sync_at=_utc_now().isoformat(),
                        last_reply_sync_result=reply_result,
                    )
                except Exception as error:
                    self._remember(
                        last_reply_sync_at=_utc_now().isoformat(),
                        last_reply_sync_result={"status": "failed"},
                        last_error=self._safe_error(error),
                    )
                next_reply_sync = time.monotonic() + self.config.reply_sync_seconds

            self._stop.wait(self.config.poll_seconds)

    def start(self) -> bool:
        if not self.config.worker_enabled:
            return False
        if self._thread and self._thread.is_alive():
            return True
        self._thread = threading.Thread(
            target=self._loop,
            name="lifeos-queue-worker",
            daemon=True,
        )
        self._thread.start()
        return True

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)


_RUNTIME: LifeOSQueueRuntime | None = None
_RUNTIME_LOCK = threading.Lock()


def get_queue_runtime() -> LifeOSQueueRuntime:
    global _RUNTIME
    with _RUNTIME_LOCK:
        if _RUNTIME is None:
            _RUNTIME = LifeOSQueueRuntime()
        return _RUNTIME


def start_queue_worker() -> dict[str, Any]:
    runtime = get_queue_runtime()
    runtime.start()
    return runtime.status(check_remote=False)


def queue_status(*, check_remote: bool = False) -> dict[str, Any]:
    return get_queue_runtime().status(check_remote=check_remote)


def run_queue_mode(mode: str) -> dict[str, Any]:
    runtime = get_queue_runtime()
    try:
        return runtime.run(mode)
    except ValueError:
        raise
    except Exception as error:
        return {
            "ok": False,
            "status": "failed",
            "error": runtime._safe_error(error),
        }


def queue_internal_authorized(headers: Any) -> bool:
    expected = QueueRuntimeConfig.from_env().internal_secret
    supplied = str(headers.get("X-LifeOS-Queue-Secret") or "")
    return bool(expected and supplied and hmac.compare_digest(expected, supplied))
