#!/usr/bin/env python3
"""Render a secret-free Wrangler configuration from validated Cloudflare values."""

from __future__ import annotations

import os
import re
from pathlib import Path
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "wrangler.toml.template"
OUTPUT = HERE / "wrangler.toml"
REQUIRED = (
    "LIFEOS_ALLOWED_ORIGINS",
    "LIFEOS_PUBLIC_SITE_ORIGIN",
    "LIFEOS_API_ORIGIN",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "ORIGIN_STATE_KV_ID",
    "RATE_LIMIT_NAMESPACE_ID",
)


def origin(value: str, name: str) -> str:
    candidate = value.strip().rstrip("/")
    parsed = urlsplit(candidate)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
        or parsed.port not in (None, 443)
    ):
        raise SystemExit(f"{name} must be an exact HTTPS origin")
    return f"https://{parsed.hostname.lower()}"


def main() -> None:
    values = {name: os.environ.get(name, "").strip() for name in REQUIRED}
    missing = [name for name in REQUIRED if not values[name]]
    if missing:
        raise SystemExit("Missing required public configuration: " + ", ".join(missing))

    for name in (
        "LIFEOS_PUBLIC_SITE_ORIGIN", "LIFEOS_API_ORIGIN", "SUPABASE_URL",
    ):
        values[name] = origin(values[name], name)
    values["LIFEOS_ALLOWED_ORIGINS"] = ",".join(
        origin(item, "LIFEOS_ALLOWED_ORIGINS")
        for item in values["LIFEOS_ALLOWED_ORIGINS"].split(",")
        if item.strip()
    )
    if not re.fullmatch(r"[0-9a-fA-F]{32}", values["ORIGIN_STATE_KV_ID"]):
        raise SystemExit("ORIGIN_STATE_KV_ID must be a 32-character hexadecimal ID")
    if not re.fullmatch(r"[1-9][0-9]*", values["RATE_LIMIT_NAMESPACE_ID"]):
        raise SystemExit("RATE_LIMIT_NAMESPACE_ID must be a positive integer")
    if not re.fullmatch(r"[A-Za-z0-9._-]{8,500}", values["SUPABASE_PUBLISHABLE_KEY"]):
        raise SystemExit("SUPABASE_PUBLISHABLE_KEY has an unexpected format")

    rendered = TEMPLATE.read_text(encoding="utf-8")
    for name, value in values.items():
        rendered = rendered.replace(f"__{name}__", value)
    if re.search(r"__[A-Z0-9_]+__", rendered):
        raise SystemExit("The Wrangler template still contains placeholders")
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"WRANGLER_CONFIG=PASS output={OUTPUT}")


if __name__ == "__main__":
    main()
