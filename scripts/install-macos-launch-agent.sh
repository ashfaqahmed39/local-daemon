#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST_PATH="${HOME}/Library/LaunchAgents/io.pixelperfect.local-daemon.plist"
NODE_BIN="$(command -v node || true)"

if [ -z "${NODE_BIN}" ]; then
  echo "node was not found on PATH. Install Node.js first, then rerun this script." >&2
  exit 1
fi

cd "${DAEMON_DIR}"
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${HOME}/Library/Logs/pixel-perfect-ui"

cat > "${PLIST_PATH}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.pixelperfect.local-daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${DAEMON_DIR}/src/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${DAEMON_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PIXEL_PERFECT_DAEMON_HOST</key>
    <string>0.0.0.0</string>
    <key>PIXEL_PERFECT_DAEMON_PORT</key>
    <string>8765</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/Library/Android/sdk/platform-tools:${HOME}/Android/Sdk/platform-tools</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HOME}/Library/Logs/pixel-perfect-ui/local-daemon.out.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/Library/Logs/pixel-perfect-ui/local-daemon.err.log</string>
</dict>
</plist>
PLIST

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"

echo "Pixel Perfect Local Device Helper installed."
echo "Health check: http://127.0.0.1:8765/health"
echo "Logs: ${HOME}/Library/Logs/pixel-perfect-ui/local-daemon.err.log"
