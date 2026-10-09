# LifeOS Domain Lab (Termux)

A read-only diagnostic lab for evaluating legitimate free namespaces and attaching one to the existing LifeOS deployment. It **does not** edit DNS, register domains, change GitHub/hosting settings, create mailboxes, or modify production.

## What it tests

- Current origin HTTP response status, redirect destination, remote IP, and curl's TLS verification result.
- DNS records (A, AAAA, CNAME, NS, MX, TXT) for any hostname you specify.
- TLS handshake status, certificate-chain verification, and hostname verification for HTTPS hosts (where supported by the device's OpenSSL).
- Email DNS basics: MX, SPF TXT, and DMARC TXT.
- DNS/TLS observations for candidate names. DNS absence is **not proof** a name is available or can be registered.

## Install on Termux

Use a current Termux release (the old Google Play build is unsupported). In Termux:

```bash
pkg update
pkg install -y git curl dnsutils openssl coreutils
git clone https://github.com/tecinocryptlifeos/lifeosai.git
cd lifeosai
git checkout feat/lifeos-termux-domain-lab-20261009
cd tools/lifeos-domain-lab
bash install-termux.sh
bash lifeos-domain-lab.sh doctor
```

If you already have the repository cloned, use `git fetch origin` and check out the branch instead of cloning again.

## Commands

```bash
# Inspect the existing deployment
bash lifeos-domain-lab.sh probe lifeos-trade-system.pages.dev
bash lifeos-domain-lab.sh dns lifeos-trade-system.pages.dev
bash lifeos-domain-lab.sh tls lifeos-trade-system.pages.dev

# Inspect a candidate namespace after you submit/receive it
bash lifeos-domain-lab.sh dns trade.lifeos.is-a.dev
bash lifeos-domain-lab.sh probe trade.lifeos.is-a.dev
bash lifeos-domain-lab.sh tls trade.lifeos.is-a.dev

# Check email DNS for the exact domain after an email provider gives you records
bash lifeos-domain-lab.sh email lifeos.example

# Capture a timestamped report under $HOME/lifeos-domain-lab-reports
bash lifeos-domain-lab.sh report lifeos-trade-system.pages.dev
```

Set a different origin or report directory without editing the script:

```bash
LIFEOS_ORIGIN=https://lifeos-trade-system.pages.dev LIFEOS_LAB_REPORT_DIR="$HOME/lifeos-reports" bash lifeos-domain-lab.sh report
```

## Candidate namespaces and policy checks

1. **FreeDNS (afraid.org shared domains):** the service advertises five free hostnames and multiple DNS record types. Choose a shared parent domain only after reviewing its owner/terms and checking whether it supports CNAME records and HTTPS for your use case. Its documented “cloaking” option uses a hidden frame; this is not a reverse proxy and can break app routing, login, cookies, and browser behavior. Avoid cloaking for the LifeOS trading application.
2. **EU.org:** a free delegated subdomain is possible only after application/approval and satisfying the operator's current requirements. Check the current official rules and use a DNS provider you can manage.
3. **is-a.dev:** supports nested subdomains in its registration-file structure, but its published eligibility says personal or non-commercial software-development projects and allows refusal of commercial projects. LifeOS must not use it unless the actual project qualifies and the maintainers approve it. A nested name also requires control/approval of its parent entry.
4. **Hosting-provided names:** a stable `*.pages.dev`, `*.netlify.app`, `*.vercel.app`, `*.github.io`, or `*.workers.dev` host can be used without owning another domain, subject to the provider's terms. This is the least complex fallback.
5. **Email:** MX forwarding services require control of the relevant domain's DNS. A free hostname does not automatically mean its operator permits user-managed MX records or a usable mail identity. Verify that both the namespace operator and mail provider permit the intended use before configuring anything.

Official starting points:

- Termux: https://termux.dev/en/index.html
- Termux package management: https://github.com/termux/termux-packages/wiki/Package-Management
- FreeDNS feature list: https://freedns.afraid.org/signup/features/
- FreeDNS URL-cloaking explanation: https://freedns.afraid.org/faq/help.php?help_id=2
- EU.org: https://nic.eu.org/
- is-a.dev eligibility: https://docs.is-a.dev/quickstart/
- is-a.dev nested DNS structure: https://docs.is-a.dev/domain-structure/
- GitHub Pages domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains
- ImprovMX current limits: https://improvmx.com/pricing/

## Important DNS boundary

The lab can check `lifeos.ai.trade.com`, but cannot create it. The `trade.com` administrator must control or explicitly delegate `ai.trade.com`. The same applies to `trade.ai@lifeos.com`: it needs authorization to configure mail for `lifeos.com`. A proxy, URL cloaking, CNAME, TLS certificate, or Termux script does not grant authority over a parent namespace.

The $0 objective remains valid: find a namespace that **actually delegates a hostname to you**, then configure the hosting endpoint and TLS within that authorization. No ownership bypass is part of this lab.

## Safety and scope

- All commands are diagnostic; no DNS writes, PR submissions, registrar changes, email sending, or production deployment.
- Reports include public hostnames and HTTP/TLS outcomes. Review a report before publishing it.
- Never paste API tokens, passwords, mail credentials, or private keys into reports.
- DNS query results are snapshots and may differ by resolver/region; registration eligibility and provider rules require manual confirmation.
