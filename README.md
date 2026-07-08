# Pixel Perfect Local Daemon

Standalone local device helper for Pixel Perfect App comparison mode.

This repo is only the local helper. It does not need the full `pixel-perfect-ui` repo, frontend, backend, Docker setup, or system Android daemon to run.

## What It Does

The daemon runs on the user's machine and lets the shared frontend connect to local devices for Local capture mode:

- Android Studio emulators on this computer
- USB-connected Android devices on this computer
- iOS simulators on this computer, macOS only

Do not use this helper for Docker/backend-managed System Android devices.

## OS Support

| OS | Android emulator/device | iOS simulator | Background helper |
| --- | --- | --- | --- |
| macOS | Supported | Supported | LaunchAgent |
| Windows | Supported | Not supported | Scheduled Task |
| Linux | Supported | Not supported | systemd user service |

Windows and Linux support Android only. iOS simulator support requires macOS with Xcode command line tools.

## Install

```bash
git clone <local-helper-repo>
cd local-helper-repo
npm install
```

Then install the background helper for your OS.

macOS:

```bash
npm run helper:install:macos
```

Linux:

```bash
npm run helper:install:linux
```

Windows PowerShell:

```powershell
npm run helper:install:windows
```

Then open the shared frontend URL:

```text
http://192.168.9.145:5173
```

Click **Connect** in Local mode.

## Manual Run

For manual development or troubleshooting on any OS:

```bash
npm start
```

Default daemon URL:

```text
http://127.0.0.1:8765
```

Health check:

```bash
curl http://127.0.0.1:8765/health
```

Device check:

```bash
curl "http://127.0.0.1:8765/devices?platform=android"
```

Diagnostics:

```bash
curl http://127.0.0.1:8765/diagnostics
```

## Using With A Shared Frontend IP

If someone gives you a frontend URL like:

```text
http://192.168.11.14:5173
```

you still run this helper on your own machine. The browser should connect to your helper at `http://127.0.0.1:8765` or `http://localhost:8765`; it should not use `/local-daemon` from the shared frontend IP.

Verify on your own machine before clicking Connect:

```bash
adb devices
curl http://127.0.0.1:8765/health
curl "http://127.0.0.1:8765/devices?platform=android"
```

Expected `adb devices` output includes a device in `device` state, for example:

```text
emulator-5554    device
```

On Windows PowerShell, if `curl` is aliased differently, use:

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

When the frontend is opened from another machine using a shared network IP, `127.0.0.1` means the user's own computer. Each user who wants Local mode must run this helper on their own machine so their browser can reach their own emulator, USB device, or simulator.

## Allowed Frontend Origins

For safety, the helper only allows browser requests from trusted frontend origins. By default these are allowed:

```text
https://pixelperfectui.io
https://www.pixelperfectui.io
http://localhost:5173
http://127.0.0.1:5173
```

Production still connects directly from the browser to the user's own helper at `http://127.0.0.1:8765` or `http://localhost:8765`; requests are not proxied through `https://pixelperfectui.io`.

If you need a custom development or staging frontend, set a comma-separated allowlist before starting or installing the helper:

```bash
PIXEL_PERFECT_ALLOWED_ORIGINS="https://pixelperfectui.io,http://192.168.11.14:5173" npm start
```

For production-only hardening, use:

```bash
PIXEL_PERFECT_ALLOWED_ORIGINS="https://pixelperfectui.io,https://www.pixelperfectui.io" npm start
```

For background helpers, set `PIXEL_PERFECT_ALLOWED_ORIGINS` before running the OS installer so the service captures the value.

## macOS Background Helper

Install as a per-user LaunchAgent:

```bash
npm run helper:install:macos
```

Uninstall:

```bash
npm run helper:uninstall:macos
```

Logs:

```text
~/Library/Logs/pixel-perfect-ui/local-daemon.out.log
~/Library/Logs/pixel-perfect-ui/local-daemon.err.log
```

## Linux Background Helper

Install as a per-user systemd service:

```bash
npm run helper:install:linux
```

Uninstall:

```bash
npm run helper:uninstall:linux
```

View logs:

```bash
journalctl --user -u pixel-perfect-local-daemon.service -f
```

The Linux installer requires `systemctl --user`. If your Linux environment does not support user services, use `npm start` manually.

## Windows Background Helper

Install as a per-user Scheduled Task from PowerShell:

```powershell
npm run helper:install:windows
```

Uninstall:

```powershell
npm run helper:uninstall:windows
```

The task name is `PixelPerfectLocalDaemon` and it starts when the user logs in. If Windows Firewall prompts for Node.js, allow access on private networks.

## Requirements

- Node.js and npm
- Android: Android SDK platform tools (`adb`)
- iOS simulator: macOS with Xcode command line tools (`xcrun simctl`)

## ADB Detection

The background helper installer captures the actual `adb` path from your system and saves it as `ADB_PATH` in the per-user service. This is more reliable than depending on the background service inheriting the same `PATH` as your terminal.

Verify `adb` before installing or reinstalling the helper.

macOS/Linux:

```bash
which adb
adb devices
```

Windows PowerShell:

```powershell
where adb
adb devices
```

If `adb` is installed after the helper was installed, rerun the helper installer so it captures the new path.

macOS:

```bash
npm run helper:uninstall:macos
npm run helper:install:macos
```

Linux:

```bash
npm run helper:uninstall:linux
npm run helper:install:linux
```

Windows PowerShell:

```powershell
npm run helper:uninstall:windows
npm run helper:install:windows
```

Confirm which `adb` the daemon is using:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/diagnostics
```

The `/health` response includes `tools.adb.command`. The `/diagnostics` response also includes raw `adb devices` output.

The daemon checks these Android SDK locations automatically:

```text
ANDROID_HOME/platform-tools/adb
ANDROID_SDK_ROOT/platform-tools/adb
~/Library/Android/sdk/platform-tools/adb
~/Android/Sdk/platform-tools/adb
%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe
/opt/android-sdk/platform-tools/adb
```

You can force a custom `adb` path:

macOS/Linux:

```bash
ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb" npm start
```

Windows PowerShell:

```powershell
$env:ADB_PATH="$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"; npm start
```

Android upload/install auto-detects the package name with `aapt` or `apkanalyzer` when available, so you normally do not need to type the package name after uploading an APK.

## Troubleshooting

- If Android devices do not appear, run `adb devices` and confirm the device is listed as `device`.
- If `adb devices` works in the terminal but the app says no Android devices are visible, check `curl http://127.0.0.1:8765/health` and confirm `tools.adb.command` is the same path as `which adb` or `where adb`.
- If the helper captured no `adb` path or a stale path, uninstall and reinstall the helper for your OS, then hard refresh the frontend.
- On Apple Silicon macOS with Homebrew, `adb` is often installed at `/opt/homebrew/bin/adb`. The daemon checks this path directly, but you can also force it with `ADB_PATH=/opt/homebrew/bin/adb npm start` when testing manually.
- If Windows cannot connect, allow Node.js through Windows Firewall for private networks.
- If Linux cannot connect from the browser, check local firewall rules for port `8765`.
- If iOS simulators do not appear on macOS, run `xcrun simctl list devices available`.
