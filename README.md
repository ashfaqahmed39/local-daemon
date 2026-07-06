# Pixel Perfect Local Daemon

Standalone local device helper for Pixel Perfect App comparison mode.

This repo is only the local helper. It does not need the full `pixel-perfect-ui` repo, frontend, backend, Docker setup, or system Android daemon to run.

## What It Does

The daemon runs on the user's machine and lets the shared frontend connect to local devices for Local capture mode:

- Android Studio emulators on this computer
- USB-connected Android devices on this computer
- iOS simulators on this computer

Do not use this helper for Docker/backend-managed System Android devices.

## Install

```bash
git clone <local-helper-repo>
cd local-helper-repo
npm install
npm run helper:install:macos
```

Then open the shared frontend URL:

```text
http://192.168.9.145:5173
```

Click **Connect** in Local mode.

## macOS Background Helper

Install as a per-user LaunchAgent:

```bash
npm run helper:install:macos
```

Uninstall:

```bash
npm run helper:uninstall:macos
```

The LaunchAgent starts automatically when the user logs in and binds to `0.0.0.0:8765`.

Health check:

```bash
curl http://127.0.0.1:8765/health
```

Logs:

```text
~/Library/Logs/pixel-perfect-ui/local-daemon.out.log
~/Library/Logs/pixel-perfect-ui/local-daemon.err.log
```

## Manual Run

For manual development or troubleshooting:

```bash
npm start
```

Default daemon URL:

```text
http://127.0.0.1:8765
```

When the frontend is opened from another machine using a shared network IP, `127.0.0.1` means the user's own computer. Each user who wants Local mode must run this helper on their own machine so their browser can reach their own emulator, USB device, or simulator.

## Requirements

- Node.js and npm
- Android: Android SDK platform tools (`adb`)
- iOS simulator: macOS with Xcode command line tools (`xcrun simctl`)

If Android Studio installed `adb` but it is not on `PATH`, the daemon also checks:

```text
~/Library/Android/sdk/platform-tools/adb
~/Android/Sdk/platform-tools/adb
```

You can force a custom `adb` path:

```bash
ADB_PATH="$HOME/Library/Android/sdk/platform-tools/adb" npm start
```

Android upload/install auto-detects the package name with `aapt` or `apkanalyzer` when available, so you normally do not need to type the package name after uploading an APK.
