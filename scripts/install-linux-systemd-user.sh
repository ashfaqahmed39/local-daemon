#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SERVICE_DIR="${HOME}/.config/systemd/user"
SERVICE_PATH="${SERVICE_DIR}/pixel-perfect-local-daemon.service"
NODE_BIN="$(command -v node || true)"
ADB_BIN="$(command -v adb || true)"
ALLOWED_ORIGINS_ENV=""

if [ -z "${NODE_BIN}" ]; then
  echo "node was not found on PATH. Install Node.js first, then rerun this script." >&2
  exit 1
fi

if [ -z "${ADB_BIN}" ]; then
  cat >&2 <<'ERROR'
adb was not found.

Install Android platform tools:

Ubuntu/Debian:
sudo apt install android-tools-adb

Fedora:
sudo dnf install android-tools

Arch:
sudo pacman -S android-tools

Then rerun:
npm run helper:install:linux
ERROR
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl was not found. Use npm start for manual mode on this Linux system." >&2
  exit 1
fi

if [ -n "${PIXEL_PERFECT_ALLOWED_ORIGINS:-}" ]; then
  ALLOWED_ORIGINS_ENV="Environment=PIXEL_PERFECT_ALLOWED_ORIGINS=${PIXEL_PERFECT_ALLOWED_ORIGINS}"
fi

cd "${DAEMON_DIR}"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
npm run appium:install-driver

mkdir -p "${SERVICE_DIR}"

cat > "${SERVICE_PATH}" <<SERVICE
[Unit]
Description=Pixel Perfect Local Device Helper
After=network.target

[Service]
Type=simple
WorkingDirectory="${DAEMON_DIR}"
ExecStart="${NODE_BIN}" "${DAEMON_DIR}/src/server.js"
Restart=always
RestartSec=3
Environment=PIXEL_PERFECT_DAEMON_HOST=0.0.0.0
Environment=PIXEL_PERFECT_DAEMON_PORT=8765
Environment=ADB_PATH=${ADB_BIN}
Environment=PIXEL_PERFECT_APPIUM_HOME=${HOME}/.pixel-perfect-appium
${ALLOWED_ORIGINS_ENV}
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${HOME}/Android/Sdk/platform-tools:/opt/android-sdk/platform-tools

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now pixel-perfect-local-daemon.service

echo "Pixel Perfect Local Device Helper installed."
echo "ADB path: ${ADB_BIN}"
if [ -n "${PIXEL_PERFECT_ALLOWED_ORIGINS:-}" ]; then
  echo "Allowed origins: ${PIXEL_PERFECT_ALLOWED_ORIGINS}"
fi
echo "Health check: http://127.0.0.1:8765/health"
echo "Logs: journalctl --user -u pixel-perfect-local-daemon.service -f"
