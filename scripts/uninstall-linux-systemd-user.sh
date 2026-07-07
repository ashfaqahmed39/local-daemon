#!/usr/bin/env bash
set -euo pipefail

SERVICE_PATH="${HOME}/.config/systemd/user/pixel-perfect-local-daemon.service"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now pixel-perfect-local-daemon.service >/dev/null 2>&1 || true
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

rm -f "${SERVICE_PATH}"

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

echo "Pixel Perfect Local Device Helper uninstalled."
