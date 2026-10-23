# Android application

## Install and connect locally

Installable **debug-signed test APK**: `artifacts/android/InterviewPilotLive-test.apk`; SHA-256 checksum beside it. App ID: `live.interviewpilot.mobile.debug`. Requires Android 8.0/API 26 or newer and an up-to-date Android System WebView. This is an Android host for the working web application, not an offline copy of Gemini or PostgreSQL.

1. Keep frontend, API, database, Redis and worker running on the PC. Check `http://localhost:3001`.
2. Enable USB debugging on your phone, connect USB, and authorize the PC's debugging prompt.
3. Run from the project root:

   ```powershell
   .\scripts\connect-android.ps1
   # If multiple devices are connected:
   .\scripts\connect-android.ps1 -Serial DEVICE_SERIAL
   ```

The script uses `adb reverse` for TCP 3001 and 8001, installs with `adb install -r` (preserving app data), and opens the app. Default address `http://localhost:3001` then reaches the PC. Both PC listeners remain loopback-only. Re-run after reconnecting USB or restarting the phone; use `-SkipInstall` when the installed APK is current.

You can also copy the APK to the phone and permit installation from your chosen file manager. A copied APK still needs the USB connection above or a reachable hosted HTTPS service. It does not contain the backend, documents, database, or Gemini key. When unreachable, it shows connection settings and an Open workspace retry button.

## Hosted connection

Use Android Back, then **Connection settings**, to enter the root HTTPS address of an InterviewWin deployment. The release host accepts HTTPS only; the test build additionally permits loopback HTTP. HTTP LAN addresses are rejected because microphone capture requires a secure context. Certificates must be valid; SSL errors are never bypassed.

Deploy using `DEPLOYMENT.md`, with `LOCAL_TEST_MODE=false`. Configure frontend `NEXT_PUBLIC_WS_URL` to the deployment's `wss://` endpoint, or leave it empty for a same-origin reverse proxy, before building the frontend. The currently running local frontend is compiled for `ws://localhost:8001`; it cannot serve remote HTTPS unchanged. The APK stores the address, and regular cookies/access controls handle hosted accounts. Hosted use needs no USB debugging.

## Mobile behavior

- The same answer-first 30/70 layout, adjustable divider, simple preferences, automatic question detection, streamed code/explanations and hands-free reading run in the APK.
- Microphone is selected by default. Android WebView cannot capture another app's internal audio; the microphone must hear the permitted conversation. Headphones can prevent this. No camera permission, screen overlay or background recorder is included.
- The first microphone request uses Android's permission prompt. Only audio for the configured origin is granted. Declining gives a visible error; permission can later be changed in Android app settings.
- The foreground workspace keeps the screen awake so hands-free reading does not trigger inactivity sleep. Leaving, locking or changing the server stops capture. Returning from background reloads the workspace, requiring Start again. The document picker stops capture before opening.
- Uploads use Android's document picker and content-URI access, with the server's original validation, encryption and tenant checks. No broad filesystem permission is requested.
- Verify GitHub identity in the desktop browser, then refresh the app. The OAuth state cookie cannot move to an external browser; the APK labels this restriction. Public repository imports and already verified identities remain available.
- External HTTPS links require confirmation and open in the system browser. No JavaScript native bridge is exposed. Device backup is disabled; WebView debugging is enabled only in the debug build.

## Rebuild and release

Use JDK 17 and Android SDK platform 36/build tools 36.0.0. Set `ANDROID_HOME` if not under `%LOCALAPPDATA%\Android\Sdk`. The checked-in wrapper uses Gradle 9.7.1 with the official distribution checksum; Android Gradle Plugin 9.4.0 is pinned.

```powershell
.\scripts\build-android.ps1
# Runs assembleDebug, testDebugUnitTest and lintDebug; copies APK/checksum to artifacts/android.
.\scripts\build-android.ps1 -Release
```

Release output is **unsigned** and HTTPS-only. Sign with your own protected release key before installing/distributing. No release key is generated or committed. Play distribution also needs a signed app bundle, store listing and separate publication.

Official references: [command-line builds](https://developer.android.com/build/building-cmdline), [WebView permissions](https://developer.android.com/reference/android/webkit/PermissionRequest), [WebView management](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview), [AGP compatibility](https://developer.android.com/build/releases/agp-9-4-0-release-notes).
