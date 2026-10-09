#!/usr/bin/env bash
# LifeOS Domain Lab: read-only DNS/HTTPS/email diagnostics for Termux.
# It never writes DNS, changes hosting, submits registrations, or sends email.
set -uo pipefail

DEFAULT_ORIGIN="https://lifeos-trade-system.pages.dev"
ORIGIN="${LIFEOS_ORIGIN:-$DEFAULT_ORIGIN}"
REPORT_DIR="${LIFEOS_LAB_REPORT_DIR:-$HOME/lifeos-domain-lab-reports}"

usage() {
  cat <<'USAGE'
LifeOS Domain Lab (read-only)

Usage:
  bash lifeos-domain-lab.sh doctor
  bash lifeos-domain-lab.sh probe [URL-or-host]
  bash lifeos-domain-lab.sh dns [HOST]
  bash lifeos-domain-lab.sh tls [HOST]
  bash lifeos-domain-lab.sh email [DOMAIN]
  bash lifeos-domain-lab.sh candidates
  bash lifeos-domain-lab.sh report [HOST]

Environment:
  LIFEOS_ORIGIN             Origin URL (default: https://lifeos-trade-system.pages.dev)
  LIFEOS_LAB_REPORT_DIR     Report directory (default: ~/lifeos-domain-lab-reports)

All checks are observational. DNS absence is not proof that a name is available.
USAGE
}

has() { command -v "$1" >/dev/null 2>&1; }

normalize_host() {
  local value="${1:-}"
  value="${value#https://}"
  value="${value#http://}"
  value="${value%%/*}"
  value="${value%%:*}"
  value="${value,,}"
  if [[ -z "$value" || ! "$value" =~ ^[a-z0-9.-]+$ || "$value" == .* || "$value" == *. || "$value" == *..* ]]; then
    printf 'ERROR: invalid hostname: %s\n' "${1:-<empty>}" >&2
    return 2
  fi
  printf '%s\n' "$value"
}

need_dns() {
  if ! has dig && ! has nslookup; then
    echo "Missing DNS tool. On Termux run: pkg install dnsutils" >&2
    return 1
  fi
}

dns_one() {
  local host="$1" type="$2" result=""
  if has dig; then
    result="$(dig +time=3 +tries=1 +noall +answer "$host" "$type" 2>/dev/null || true)"
  elif has nslookup; then
    result="$(nslookup "-type=$type" "$host" 2>/dev/null || true)"
  fi
  if [[ -n "$result" ]]; then
    printf '%s\n' "$result"
  else
    printf '(no %s answer observed; this does not establish availability)\n' "$type"
  fi
}

doctor() {
  echo "LifeOS Domain Lab — environment check"
  echo "Date: $(date -Is 2>/dev/null || date)"
  if [[ -n "${TERMUX_VERSION:-}" || "${PREFIX:-}" == *com.termux* ]]; then
    echo "Environment: Termux detected"
  else
    echo "Environment: not positively identified as Termux (script may still run on Bash/Linux)"
  fi
  local missing=0 tool
  for tool in bash curl dig openssl; do
    if has "$tool"; then
      printf 'OK      %s: %s\n' "$tool" "$(command -v "$tool")"
    else
      printf 'MISSING %s\n' "$tool"
      missing=1
    fi
  done
  if has timeout; then echo "OK      timeout available"; else echo "INFO    timeout not found (TLS check may need manual interruption)"; fi
  if (( missing )); then
    echo "Install on Termux: pkg install -y curl dnsutils openssl coreutils"
    return 1
  fi
  echo "No DNS or production settings have been changed."
}

probe() {
  local input="${1:-$ORIGIN}" url
  if [[ "$input" == http://* || "$input" == https://* ]]; then
    url="$input"
  else
    local host
    host="$(normalize_host "$input")" || return $?
    url="https://$host"
  fi
  if ! has curl; then
    echo "Missing curl. On Termux run: pkg install curl" >&2
    return 1
  fi
  echo "HTTP probe: $url"
  echo "Uses a HEAD request; some hosts do not support HEAD, so an HTTP error is not conclusive."
  curl --silent --show-error --location --head \
    --connect-timeout 8 --max-time 25 --max-redirs 6 \
    --output /dev/null \
    --write-out $'HTTP_CODE=%{http_code}\nFINAL_URL=%{url_effective}\nREMOTE_IP=%{remote_ip}\nTLS_VERIFY_RESULT=%{ssl_verify_result}\n' \
    "$url"
  local rc=$?
  if (( rc != 0 )); then
    printf 'CURL_EXIT=%s\n' "$rc"
    return "$rc"
  fi
}

dns() {
  local host
  host="$(normalize_host "${1:-lifeos-trade-pages.dev}")" || return $?
  need_dns || return 1
  echo "DNS records observed for $host"
  local type
  for type in A AAAA CNAME NS MX TXT; do
    echo "--- $type ---"
    dns_one "$host" "$type"
  done
  echo "DNS data is a point-in-time observation from the device's configured resolver."
}

tls() {
  local host
  host="$(normalize_host "${1:-lifeos-trade-pages.dev}")" || return $?
  if ! has openssl; then
    echo "Missing openssl. On Termux run: pkg install openssl" >&2
    return 1
  fi
  echo "TLS certificate check for $host:443 (SNI + hostname verification)"
  local cert_output="" rc=0
  if has timeout; then
    cert_output="$(timeout 15 openssl s_client -connect "$host:443" -servername "$host" \
      -verify_hostname "$host" -verify_return_error -brief </dev/null 2>&1)" || rc=$?
  else
    cert_output="$(openssl s_client -connect "$host:443" -servername "$host" \
      -verify_hostname "$host" -verify_return_error -brief </dev/null 2>&1)" || rc=$?
  fi
  printf '%s\n' "$cert_output" | grep -Ei 'protocol|ciphersuite|verification:|verify return code|verify error|error|connection|peer certificate' || true
  if printf '%s\n' "$cert_output" | grep -Eqi 'Verification: OK|Verify return code: 0 \(ok\)'; then
    echo "TLS_RESULT=PASS (chain and hostname reported valid by OpenSSL)"
  else
    echo "TLS_RESULT=CHECK (could be a network failure, unsupported OpenSSL option, missing CA bundle, or a real certificate problem)"
    echo "OpenSSL exit code: $rc"
    echo "For fuller diagnostics, run: openssl s_client -connect $host:443 -servername $host -verify_hostname $host -verify_return_error </dev/null"
    return 1
  fi
}

email() {
  local domain
  domain="$(normalize_host "${1:-}")" || {
    echo "Usage: bash lifeos-domain-lab.sh email DOMAIN" >&2
    return 2
  }
  need_dns || return 1
  echo "Email DNS preflight for @$domain (does not send or receive mail)"
  echo "--- MX records ---"
  dns_one "$domain" MX
  echo "--- SPF TXT records at domain ---"
  local txt=""
  if has dig; then txt="$(dig +time=3 +tries=1 +short TXT "$domain" 2>/dev/null || true)"; fi
  if printf '%s\n' "$txt" | grep -qi 'v=spf1'; then
    printf '%s\n' "$txt" | grep -i 'v=spf1' || true
    echo "SPF_RESULT=record observed; validate it against the actual sending provider"
  else
    echo "${txt:-(no TXT answer observed)}"
    echo "SPF_RESULT=no SPF TXT observed by this resolver"
  fi
  echo "--- DMARC TXT records at _dmarc.$domain ---"
  local dmarc=""
  if has dig; then dmarc="$(dig +time=3 +tries=1 +short TXT "_dmarc.$domain" 2>/dev/null || true)"; fi
  if printf '%s\n' "$dmarc" | grep -qi 'v=DMARC1'; then
    printf '%s\n' "$dmarc"
    echo "DMARC_RESULT=record observed; review the policy before relying on it"
  else
    echo "${dmarc:-(no TXT answer observed)}"
    echo "DMARC_RESULT=no DMARC TXT observed by this resolver"
  fi
  echo "Note: valid MX/SPF/DMARC records do not prove that a namespace operator permits mailbox use."
}

candidates() {
  need_dns || return 1
  echo "Candidate DNS observations only — not a registration or availability checker."
  echo "Review the operator's current eligibility and terms before applying."
  local host type
  for host in lifeos.is-a.dev trade.lifeos.is-a.dev lifeos.eu.org; do
    echo
    echo "===== $host ====="
    for type in A AAAA CNAME NS MX; do
      printf '%s: ' "$type"
      local result=""
      if has dig; then result="$(dig +time=2 +tries=1 +short "$host" "$type" 2>/dev/null || true)"; fi
      if [[ -n "$result" ]]; then printf '%s\n' "$result"; else echo "(no answer observed)"; fi
    done
  done
  cat <<'NOTE'

Interpretation:
- No DNS answer does not prove a name is available; it may be reserved, pending, or blocked.
- is-a.dev supports nested names only when the parent entry is yours/approved and its rules permit the project. Its published quickstart excludes commercial projects.
- EU.org requires its own application/approval process.
- FreeDNS shared-domain names depend on the selected shared parent and its terms.
NOTE
}

report() {
  local input="${1:-$ORIGIN}" host stamp out
  host="$(normalize_host "$input")" || return $?
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$REPORT_DIR" || return 1
  out="$REPORT_DIR/lifeos-domain-report-$stamp.txt"
  {
    echo "LifeOS Domain Lab Report"
    echo "Timestamp: $(date -Is 2>/dev/null || date)"
    echo "Origin/input: $input"
    echo "Host checked: $host"
    echo "Mode: read-only diagnostics; no DNS/hosting changes"
    echo
    doctor || true
    echo
    probe "$input" || true
    echo
    dns "$host" || true
    echo
    tls "$host" || true
    echo
    candidates || true
  } 2>&1 | tee "$out"
  local rc=${PIPESTATUS[0]:-0}
  echo
  echo "REPORT_PATH=$out"
  echo "Review the report before sharing it; it contains public network observations."
  return "$rc"
}

command="${1:-help}"
shift || true
case "$command" in
  doctor) doctor ;;
  probe) probe "${1:-$ORIGIN}" ;;
  dns) dns "${1:-lifeos-trade-pages.dev}" ;;
  tls) tls "${1:-lifeos-trade-pages.dev}" ;;
  email) email "${1:-}" ;;
  candidates) candidates ;;
  report) report "${1:-$ORIGIN}" ;;
  help|-h|--help) usage ;;
  *) echo "Unknown command: $command" >&2; usage >&2; exit 2 ;;
esac
