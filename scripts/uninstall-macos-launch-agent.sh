#!/usr/bin/env bash
set -euo pipefail

PLIST_PATH="${HOME}/Library/LaunchAgents/io.pixelperfect.local-daemon.plist"

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
rm -f "${PLIST_PATH}"

echo "Pixel Perfect Local Device Helper uninstalled."
