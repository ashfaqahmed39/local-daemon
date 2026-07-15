# Pixel Perfect Local Daemon

Standalone local device helper for Pixel Perfect App comparison mode.

This repo is only the local helper. It does not need the full `pixel-perfect-ui` repo, frontend, backend, Docker setup, or system Android daemon to run.

## What It Does

The daemon runs on the user's machine and lets the shared frontend connect to local devices for Local capture mode:

- Android Studio emulators on this computer
- USB-connected Android devices on this computer
- iOS simulators on this computer, macOS only
- Android APK install, launch, and screenshot capture
- Android full-page scrolling screenshots using Appium UiAutomator2
- iOS simulator `.app` bundle install, launch, and normal screenshot capture for any simulator runtime available to the installed Xcode
- iOS 18 or newer simulator full-page scrolling screenshots using Appium XCUITest

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
npm run appium:install-driver
npm start
```

The OS helper installers run `npm install`/`npm ci` and register the pinned UiAutomator2 driver automatically. On macOS they also register the pinned XCUITest driver. Run `npm run appium:install-driver` manually only when using `npm start` without first installing a background helper.

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

The frontend also uses these endpoints for app capture:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check helper status and detected tool paths |
| `GET` | `/diagnostics` | Return detailed Android/iOS diagnostics |
| `GET` | `/devices?platform=android` | List Android emulators or USB devices |
| `GET` | `/devices?platform=ios` | List macOS iOS simulators |
| `POST` | `/install` | Install an uploaded APK or zipped iOS simulator `.app` bundle |
| `POST` | `/launch` | Launch the installed app by package name, bundle ID, or inferred app ID |
| `POST` | `/screenshot` | Return a PNG screenshot from the selected device |

### Screenshot Modes

Normal Android or iOS viewport screenshot:

```bash
curl -X POST http://127.0.0.1:8765/screenshot \
  -H "Content-Type: application/json" \
  -d '{"platform":"android","device_id":"emulator-5554"}' \
  --output screenshot.png
```

Android full-page scrolling screenshot:

```bash
curl -X POST http://127.0.0.1:8765/screenshot \
  -H "Content-Type: application/json" \
  -d '{"platform":"android","device_id":"emulator-5554","mode":"scroll"}' \
  --output android-full-page-screenshot.png
```

iOS simulator full-page scrolling screenshot:

```bash
curl -X POST http://127.0.0.1:8765/screenshot \
  -H "Content-Type: application/json" \
  -d '{"platform":"ios","device_id":"SIMULATOR-UDID","mode":"scroll"}' \
  --output ios-full-page-screenshot.png
```

iOS simulator compatibility:

- Normal viewport capture works with any iOS simulator runtime that is installed, available, and bootable by the active Xcode version.
- Full-page scroll capture supports iOS 18 or newer simulators. iOS 18.4 and iOS 18.5 are verified with Xcode 26.2.
- Physical iPhones and iPads are not supported.

Full-page capture uses Appium to find the largest visible scrollable element, return it to the top, scroll to the bottom, capture each viewport, detect image overlap, and append only new content. Android uses UiAutomator2 and iOS simulators use XCUITest. System bars outside the scrollable element are retained once. Normal screenshots continue to use the existing single-viewport paths.

The main frontend shows copyable helper install/start commands when Local mode cannot connect.

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
http://192.168.12.35
http://192.168.12.35:5173
```

Production still connects directly from the browser to the user's own helper at `http://127.0.0.1:8765` or `http://localhost:8765`; requests are not proxied through `https://pixelperfectui.io`.

If you need a custom development or staging frontend, set a comma-separated allowlist before starting or installing the helper:

```bash
PIXEL_PERFECT_ALLOWED_ORIGINS="https://pixelperfectui.io,http://192.168.12.35,http://192.168.12.35:5173" npm start
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

- Node.js `^20.19.0`, `^22.12.0`, or `>=24.0.0`, with npm `10+`
- Android: Android SDK platform tools (`adb`)
- Android full-page capture: Android SDK root available through `ANDROID_HOME`, `ANDROID_SDK_ROOT`, or a standard SDK location
- iOS simulator: macOS with Xcode command line tools (`xcrun simctl`)
- iOS full-page capture: iOS 18 or newer on a Booted simulator, with Xcode capable of building WebDriverAgent

The daemon uses pinned production dependencies:

```text
appium 3.5.2
appium-uiautomator2-driver 8.1.0
appium-xcuitest-driver 11.17.6 (macOS only)
sharp 0.35.3
```

The Appium drivers are installed under `~/.pixel-perfect-appium` by the helper installer. The daemon starts its own loopback-only Appium server on a free port when the first full-page capture is requested.

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

## Android Full-Page Capture

Full-page capture requires the target app to be open in the foreground and expose a scrollable element through Android accessibility. The helper:

1. Reads the foreground package and activity without relaunching or resetting the app.
2. Attaches Appium UiAutomator2 to the selected device.
3. Selects the largest visible element with `scrollable="true"`.
4. Scrolls that element to the top.
5. Captures and scrolls until UiAutomator2 reports the bottom.
6. Detects vertical overlap with grayscale pixel comparison.
7. Produces one continuous PNG with a maximum height of `30000px`.

Captures are serialized so concurrent requests cannot control the same emulator at the same time. A capture stops after at most 20 frames and returns an explicit error instead of a visibly corrupted image when overlap cannot be determined reliably.

Limitations:

- Fully custom canvas/game rendering may not expose a scrollable accessibility node.
- DRM or secure windows may block screenshots.
- Content that changes during capture, such as animations or continuously updating feeds, can prevent reliable overlap detection.

## iOS Simulator Full-Page Capture

Normal iOS screenshots use `xcrun simctl` and support any simulator runtime available to the active Xcode installation. Full-page scroll capture requires iOS 18 or newer; iOS 18.4 and iOS 18.5 have been verified with Xcode 26.2.

The target app must be open in the foreground on the selected Booted simulator. The helper attaches XCUITest without relaunching or terminating the app, selects the largest visible table, collection view, scroll view, or web view, and detects the top and bottom from consecutive screenshots because XCTest does not report scroll boundaries.

The first iOS full-page capture may take longer while Xcode builds WebDriverAgent. Later captures reuse the build. The app must expose its scroll container through iOS accessibility; custom canvas rendering, secure content, animations, and continuously changing feeds can prevent reliable capture. Physical iPhones and iPads are not supported.

## Troubleshooting

- If Android devices do not appear, run `adb devices` and confirm the device is listed as `device`.
- If full-page capture says UiAutomator2 is not installed, run `npm run appium:install-driver`, then restart or reinstall the helper.
- If iOS full-page capture says XCUITest is not installed, run `npm run appium:install-driver` on macOS, then restart or reinstall the helper.
- If WebDriverAgent fails to build, open Xcode once, accept its license and component prompts, then run `xcodebuild -version` before retrying.
- If Xcode cannot find the selected simulator destination, install an iOS Simulator runtime compatible with the active Xcode version from Xcode > Settings > Components.
- If full-page capture cannot find scrollable content, confirm the app is open in the foreground and that its scroll container is exposed to Android accessibility.
- If Appium cannot find the Android SDK, set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to the SDK directory containing `platform-tools`, then reinstall the helper.
- Full-page capture logs are written to the normal helper logs. On macOS, inspect `~/Library/Logs/pixel-perfect-ui/local-daemon.err.log`.
- If `adb devices` works in the terminal but the app says no Android devices are visible, check `curl http://127.0.0.1:8765/health` and confirm `tools.adb.command` is the same path as `which adb` or `where adb`.
- If the helper captured no `adb` path or a stale path, uninstall and reinstall the helper for your OS, then hard refresh the frontend.
- On Apple Silicon macOS with Homebrew, `adb` is often installed at `/opt/homebrew/bin/adb`. The daemon checks this path directly, but you can also force it with `ADB_PATH=/opt/homebrew/bin/adb npm start` when testing manually.
- If Windows cannot connect, allow Node.js through Windows Firewall for private networks.
- If Linux cannot connect from the browser, check local firewall rules for port `8765`.
- If iOS simulators do not appear on macOS, run `xcrun simctl list devices available`.
