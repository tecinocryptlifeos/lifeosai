#!/usr/bin/env bash
set -eu

if ! command -v pkg >/dev/null 2>&1; then
  echo "This installer expects Termux's pkg command. Install packages manually on other systems." >&2
  exit 1
fi

echo "Installing read-only diagnostic dependencies (no DNS or hosting changes)..."
pkg update
pkg install -y curl dnsutils openssl coreutils

echo
echo "Setup complete."
echo "Run:"
echo "  bash lifeos-domain-lab.sh doctor"
echo "  bash lifeos-domain-lab.sh report"
echo
echo "The lab only reads public DNS/HTTP/TLS information. It does not register domains,"
echo "modify DNS, deploy a proxy, change production settings, or send email."
