# InterviewWin Desktop

A floating, always-on-top InterviewWin window for live interviews and meetings. It hears the
interviewer through **system audio** (what comes out of your speakers or headphones) plus your
microphone, and shows suggested answers in a compact overlay.

The window loads the site's `/desktop` page. The page draws everything you see. The Electron
process only sizes the transparent window around it and supplies the desktop-only abilities:
system audio, screenshots for **Analyze**, the **Ctrl+G** shortcut, and Google sign-in through your
browser. Same account, same minutes, same sessions as the website.

## The flow

1. **Sign in.** Continue with Google opens your default browser; when you finish there, the window
   signs itself in ("You're all set"). Email and password work right in the window.
2. **Home.** `Create` or `Past Sessions`. The title bar shows minutes left (`8 / 10 min`), a drag
   handle, a menu (dashboard, buy minutes, sign out), collapse and close.
3. **Context.** Interview or Meeting, company, position, answer language, AI model (Fast or Smart),
   resume and reference docs (`+` uploads a new file). Answers only draw on the files you pick;
   with none picked, they stay technical.
4. **Answer options.** Humanize, start in Glance mode, Auto AI answer, keyboard shortcuts, custom
   instructions.
5. **Audio setup.** Pick a microphone, test the Mic and System meters, then **Start**.
6. **Live.** A pill toolbar: listening wave, system-audio and mic toggles, **Answer** (answer the
   latest question now), **Analyze** (answer the question on your screen), **Chat** (type a
   question), **Transcript**, minutes countdown, drag handle, options and End. Below it, the latest
   speech and the answer card: `‹ 2 / 5 ›` history, follow latest, hold, text size, opacity, clear,
   collapse, a resize grip, and Glance ⇄ Full answer (**Ctrl+G**). Under each answer: **Shorter**,
   **More detail**, **Example** (one-tap follow-ups) and **Copy**.
7. **After.** The home card sums up the session (`Session ended · 18 min · 6 answers`). Past Sessions
   can be searched, and any session copied or saved as a Markdown file.

## While you're live

- **Transcript.** What was heard, newest last. Any finished line can be answered with one click, so
  a question the AI skipped (or one heard while Auto answer was off) is never lost.
- **Keyboard shortcuts.** Registered only while a session is live, released when it ends, and listed
  under the toolbar's ⋮ → *Keyboard shortcuts* (with a note if another app already owns a key).
  Turn them off in Answer options if they clash with your editor; Ctrl+G always works. They avoid
  the Ctrl+Shift letters on purpose: Teams uses Ctrl+Shift+M to mute, +A to accept and +H to hang up.

  | Action | Windows / Linux | macOS |
  |---|---|---|
  | Answer the latest question | Ctrl+Alt+Enter | ⌘⌥↩ |
  | Analyze the question on your screen | Ctrl+Alt+A | ⌘⌥A |
  | Glance ⇄ full answer | Ctrl+G | ⌘G |
  | Hide / show the window | Ctrl+Alt+H | ⌘⌥H |
  | Click-through on / off | Ctrl+Alt+M | ⌘⌥M |
  | Scroll the answer | Ctrl+Alt+↑ / ↓ | ⌘⌥↑ / ↓ |
  | Previous / next answer | Ctrl+Alt+← / → | ⌘⌥← / → |

- **Click-through.** Clicks pass through the overlay to the app behind it (your code editor, the
  meeting window) while you keep reading. It can only be turned on when its shortcut is registered,
  because that shortcut is the way back; it also switches off by itself when the session ends.
- **Remembered position.** The setup card and the live overlay each reopen where you last dragged
  them, including after a restart. If that monitor is gone, the window goes back to the top centre.

## Platform support

| | Windows | macOS 15+ | macOS 14 and older, Linux |
|---|---|---|---|
| Microphone | Yes | Yes | Yes |
| System audio | Yes (loopback) | Via the macOS share picker — turn on audio | Not available; use speakers so the mic hears the interviewer |
| Analyze (screenshot) | Yes | Yes, after Screen Recording permission | Yes |
| Hidden from screenshots, recording, screen sharing | Yes (Windows 10 2004+; older Windows captures a black box) | Best effort — check with your sharing app | macOS: best effort; Linux: no |

The window uses OS content protection (`setContentProtection`): you see it, but screenshots,
screen recorders and screen-sharing apps capture whatever is behind it. It also has no taskbar
button, and on Windows it is left out of Alt+Tab and Task View. If you minimize it, launch
InterviewWin again (Start menu or desktop shortcut) to bring it back. Set `IW_ALLOW_CAPTURE=1` to
make it an ordinary, capturable window again, e.g. to record a demo video.

## What it deliberately does not do

- It does not reverse-engineer or bundle any third-party application.

## Run it

The window needs a site that has the `/desktop` page. Deploy the frontend first; until then the
app shows "An update is on its way" and reconnects by itself once the page is live.

```bash
cd desktop
npm install
npm start      # production site
npm run dev    # local frontend at http://127.0.0.1:3001 (run `npx next dev --port 3001` in ../frontend)
npm test       # unit tests: URL policy, window fitting, shortcuts, remembered position
```

Point it elsewhere with `IW_APP_URL` (http is only allowed for 127.0.0.1/localhost):

```bash
IW_APP_URL=https://staging.example.com npm start
```

Debug helpers: `IW_DEBUG=1` logs navigation; `IW_SMOKE_SHOT=out.png` saves a screenshot of the
window after it loads and quits (it reads the page directly, so it works with content protection on);
`IW_ALLOW_CAPTURE=1` lets screen recorders see the window.

## Google sign-in setup (one time)

- **Supabase redirect URL.** In Supabase → *Authentication → URL Configuration → Redirect URLs*,
  add exactly `http://127.0.0.1:53782/auth/callback`. Change the port with `IW_LOOPBACK_PORT` and
  register that port instead.
- **Public Supabase keys.** In development they're read from `../frontend/.env.local`. For an
  installer, create `desktop/config.local.json` before building — it is now packaged into the app:

  ```json
  { "supabaseUrl": "https://<ref>.supabase.co", "supabaseAnonKey": "<anon key>" }
  ```

  These are the same public `NEXT_PUBLIC_SUPABASE_*` values the website already ships.

## Release the installers

The website's download buttons (`/download/windows`, `/download/mac`) point at the latest GitHub
release, so publishing a release is all it takes to ship a new version:

1. One time: in GitHub → *Settings → Secrets and variables → Actions → Variables*, add
   `DESKTOP_SUPABASE_ANON_KEY`, the same public value as the website's `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
   The build refuses a secret or service-role key, because anyone can read a key packaged in the app.
2. Set `version` in `package.json`, commit and push, then tag that commit and push the tag:

   ```bash
   git tag desktop-v1.2.0
   git push origin desktop-v1.2.0
   ```

3. The *Desktop release* workflow builds `InterviewWin-Windows-Setup.exe` and `InterviewWin-Mac.dmg`
   (one file for Apple silicon and Intel) and publishes them. Run it by hand from the Actions tab for
   test builds that are not published.

Unsigned installers work, but Windows SmartScreen shows “Windows protected your PC” (and browsers
often show a generic file icon) until the installer is Authenticode-signed. The download page and
help center explain More info → Run anyway. After install, the Start menu uses the green wave icon
from `build/icon.ico`. To remove the SmartScreen warning for customers, add these repository secrets:

- **Mac:** `MAC_CSC_LINK` (a base64 Developer ID Application `.p12`) and `MAC_CSC_KEY_PASSWORD`, plus
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` to notarize.
- **Windows:** `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.

Once the apps are signed, remove the "Run anyway" and "Open Anyway" steps from the website. To host
the files somewhere else, set `DESKTOP_WINDOWS_DOWNLOAD_URL` and `DESKTOP_MAC_DOWNLOAD_URL` on the website.

Local builds: `npm run build:win` on Windows, and `npm run build:mac` on a Mac (add
`-- --config.mac.identity=-` when there is no Developer ID certificate).
