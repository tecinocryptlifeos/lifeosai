#!/usr/bin/env python3
"""Build the Cloudflare Pages artifact without changing the legacy Render tree."""

from __future__ import annotations

import argparse
import os
import re
import shutil
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "web" / "lifeos_voice"
ACCOUNT = ROOT / "apps" / "web" / "account" / "index.html"
PUBLIC_CONFIG = ROOT / "apps" / "web" / "public"
DEFAULT_OUTPUT = ROOT / "dist" / "pages"
FINAL_SITE_ORIGIN = "https://lifeosai.pages.dev"
FINAL_API_ORIGIN = "https://losai-edge-gateway.lifeostecinoai.workers.dev"
LEGACY_SITE_ORIGIN = "https://losai.onrender.com"

ROUTES = {
    "": "index.html",
    "about": "about.html",
    "how-it-works": "how_it_works.html",
    "decision-intelligence": "decision_intelligence.html",
    "synthetic-intelligence": "synthetic_intelligence.html",
    "community": "community.html",
    "guides": "guides.html",
    "contact": "contact.html",
    "projects": "projects.html",
    "what-lifeos-does": "what_lifeos_does.html",
    "understand-the-situation": "understand_the_situation.html",
    "examine-consequences": "examine_consequences.html",
    "guided-reflection": "guided_reflection.html",
    "responsible-action": "responsible_action.html",
    "decision-clarification": "decision_clarification.html",
    "risk-identification": "risk_identification.html",
    "trade-off-comparison": "trade_off_comparison.html",
    "consequence-mapping": "consequence_mapping.html",
    "action-planning": "action_planning.html",
    "privacy": "privacy.html",
    "terms": "terms.html",
    "disclaimer": "disclaimer.html",
    "chat": "chat.html",
    "voice": "gemini_live.html",
    "admin": "admin.html",
    "reset-password": "reset_password.html",
}
PRIVATE_ROUTES = {"chat", "voice", "account", "admin", "reset-password"}


def https_origin(name: str, default: str) -> str:
    value = os.environ.get(name, default).strip().rstrip("/")
    parsed = urlsplit(value)
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
        raise SystemExit(f"{name} must be an HTTPS origin without a path")
    return f"https://{parsed.hostname.lower()}"


def inject_before_head_end(markup: str, addition: str) -> str:
    if not addition or addition in markup:
        return markup
    if "</head>" not in markup:
        raise SystemExit("An HTML page is missing </head>")
    return markup.replace("</head>", addition + "\n</head>", 1)


def analytics_markup(measurement_id: str) -> str:
    if not re.fullmatch(r"G-[A-Z0-9]{4,20}", measurement_id):
        return ""
    return (
        f'<script async src="https://www.googletagmanager.com/gtag/js?id={measurement_id}"></script>\n'
        "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};"
        f"gtag('js',new Date());gtag('config','{measurement_id}');</script>"
    )


def adsense_markup(publisher_id: str) -> str:
    value = publisher_id.lower().removeprefix("ca-")
    if not re.fullmatch(r"pub-[0-9]{16}", value):
        return ""
    client = "ca-" + value
    return (
        f'<meta name="google-adsense-account" content="{client}">\n'
        '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client='
        f'{client}" crossorigin="anonymous"></script>'
    )


def build(output: Path) -> None:
    site_origin = https_origin("LIFEOS_PUBLIC_SITE_ORIGIN", FINAL_SITE_ORIGIN)
    api_origin = https_origin("LIFEOS_API_ORIGIN", FINAL_API_ORIGIN)
    preview = os.environ.get("LIFEOS_PAGES_PREVIEW", "").strip().lower() in {
        "1", "true", "yes", "on"
    }
    measurement = os.environ.get("LIFEOS_GA_MEASUREMENT_ID", "").strip().upper()
    publisher = os.environ.get("LIFEOS_ADSENSE_PUBLISHER_ID", "").strip().lower()

    if output.exists():
        shutil.rmtree(output)
    shutil.copytree(SOURCE, output)
    shutil.copy2(PUBLIC_CONFIG / "_redirects", output / "_redirects")
    headers = (PUBLIC_CONFIG / "_headers").read_text(encoding="utf-8")
    headers = headers.replace("__LIFEOS_API_ORIGIN__", api_origin)
    if preview:
        headers += "\n/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n"
    (output / "_headers").write_text(headers, encoding="utf-8")

    public_analytics = analytics_markup(measurement)
    public_ads = adsense_markup(publisher)
    api_meta = f'<meta name="lifeos-api-origin" content="{api_origin}">'
    canonical = lambda route: f'<link rel="canonical" href="{site_origin}{route}">'

    for route, filename in ROUTES.items():
        source_file = output / filename
        markup = source_file.read_text(encoding="utf-8")
        markup = markup.replace(LEGACY_SITE_ORIGIN, site_origin)
        canonical_path = "/" if not route else "/" + route
        markup = inject_before_head_end(markup, canonical(canonical_path))
        markup = inject_before_head_end(markup, api_meta)
        if route not in PRIVATE_ROUTES:
            markup = inject_before_head_end(markup, public_analytics)
            markup = inject_before_head_end(markup, public_ads)
        source_file.write_text(markup, encoding="utf-8")
        if route:
            destination = output / route / "index.html"
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(markup, encoding="utf-8")

    account_markup = ACCOUNT.read_text(encoding="utf-8").replace(
        LEGACY_SITE_ORIGIN, site_origin
    )
    account_markup = inject_before_head_end(account_markup, api_meta)
    account_destination = output / "account" / "index.html"
    account_destination.parent.mkdir(parents=True, exist_ok=True)
    account_destination.write_text(account_markup, encoding="utf-8")

    for relative in ("robots.txt", "sitemap.xml"):
        path = output / relative
        path.write_text(
            path.read_text(encoding="utf-8").replace(LEGACY_SITE_ORIGIN, site_origin),
            encoding="utf-8",
        )
    if preview:
        (output / "robots.txt").write_text(
            "User-agent: *\nDisallow: /\n", encoding="utf-8"
        )

    value = publisher.removeprefix("ca-")
    ads_path = output / "ads.txt"
    if re.fullmatch(r"pub-[0-9]{16}", value):
        ads_path.write_text(
            f"google.com, {value}, DIRECT, f08c47fec0942fa0\n", encoding="utf-8"
        )
    elif ads_path.exists():
        ads_path.unlink()

    if site_origin == LEGACY_SITE_ORIGIN:
        site_origin = "https://lifeosai.pages.dev"
    if api_origin == LEGACY_SITE_ORIGIN:
        api_origin = "https://losai-edge-gateway.lifeostecinoai.workers.dev"
    legacy_hits = []
    for path in output.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".html", ".js", ".xml", ".txt"}:
            if LEGACY_SITE_ORIGIN in path.read_text(encoding="utf-8", errors="replace"):
                legacy_hits.append(str(path.relative_to(output)))
    if legacy_hits:
        raise SystemExit("Legacy public origin remains in: " + ", ".join(legacy_hits))

    print(f"PAGES_BUILD=PASS output={output} routes={len(ROUTES) + 1} preview={str(preview).lower()}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    build(arguments.output.resolve())


if __name__ == "__main__":
    main()
