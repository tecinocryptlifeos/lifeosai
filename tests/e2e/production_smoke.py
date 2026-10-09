#!/usr/bin/env python3
"""Read-only smoke checks for the deployed LifeOS public site and edge gateway.

This test deliberately avoids account creation, password resets, admin mutations,
provider-quota-heavy calls, and production data changes. Those require dedicated
test credentials and an isolated preview environment.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

SITE = os.environ.get("LIFEOS_SMOKE_SITE", "https://lifeosai.pages.dev").rstrip("/")
API = os.environ.get(
    "LIFEOS_SMOKE_API",
    "https://losai-edge-gateway.lifeostecinoai.workers.dev",
).rstrip("/")
TIMEOUT = 20
failures: list[str] = []


def request(url: str, method: str = "GET", headers: dict[str, str] | None = None,
            body: bytes | None = None) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, data=body, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as response:
            return response.status, response.read(), response.headers.get("content-type", "")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), exc.headers.get("content-type", "")
    except Exception as exc:
        return 0, str(exc).encode(), ""


def check(name: str, ok: bool, detail: str) -> None:
    print(f'{"PASS" if ok else "FAIL"} {name}: {detail}')
    if not ok:
        failures.append(name)


for path in ("/", "/chat", "/voice", "/trading.html"):
    status, body, content_type = request(SITE + path)
    html_ok = status == 200 and b"<html" in body.lower()
    check("site " + path, html_ok, f"HTTP {status}, content-type={content_type}, bytes={len(body)}")

status, body, content_type = request(API + "/health")
try:
    health = json.loads(body)
except Exception:
    health = {}
check("worker health", status == 200 and health.get("ok") is True and health.get("gateway") is True,
      f"HTTP {status}, ok={health.get('ok')}, gateway={health.get('gateway')}")

for path in ("/config", "/api/auth-config"):
    status, body, content_type = request(API + path, headers={"Origin": SITE})
    try:
        payload = json.loads(body)
        valid_json = isinstance(payload, dict)
    except Exception:
        valid_json = False
    check("public config " + path, status == 200 and valid_json,
          f"HTTP {status}, JSON object={valid_json}")

# Unauthenticated access must be rejected; a server error is not accepted as proof.
for path in ("/api/session", "/api/session-status"):
    status, _, _ = request(API + path, headers={"Origin": SITE})
    check("unauthenticated protection " + path, status in (401, 403),
          f"HTTP {status}; expected 401 or 403 without a session token")

headers = {
    "Origin": SITE,
    "Content-Type": "application/json",
    "Idempotency-Key": "lifeos-smoke-check-20261009",
}
for path in ("/api/chat-decision", "/api/gemini-live-token"):
    status, _, _ = request(API + path, method="POST", headers=headers, body=b'{"messages":[{"role":"user","content":"smoke test"}]}')
    check("protected endpoint " + path, status in (401, 403),
          f"HTTP {status}; expected rejection without a session token")

print(f"SMOKE_SUMMARY passed={10 - len(failures)}/10 failures={len(failures)}")
if failures:
    print("FAILED_CHECKS=" + ", ".join(failures))
    sys.exit(1)
