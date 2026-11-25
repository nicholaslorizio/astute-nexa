<p align="center"><img src="public/icons/icon.svg" width="88" alt="Astute Nexa logo"></p>

<h1 align="center">Astute Nexa</h1>

<p align="center"><b>Docs, sheets, slides, chat and calls, mail, calendar and files. One free workspace your team owns.</b></p>

<p align="center">Write · Grid · Deck · Huddle · Relay · Cadence · Vault</p>

<h2 align="center"><a href="https://astute-nexa.onrender.com/cloud">Use it free in your browser</a></h2>

<p align="center">Nothing to install · make a workspace for your team and invite them with one link · chat and video calls between users<br>On the free plan, the first visit after a quiet spell can take about a minute to load.</p>

<h3 align="center"><a href="https://github.com/nicholaslorizio/astute-nexa/raw/main/download/Astute-Nexa-Setup.exe">Download free for Windows</a></h3>

<p align="center">Windows 10 and 11 · 29 MB · nothing else to install<br>Also for <a href="#mac">Mac</a> and <a href="#linux">Linux</a></p>

1. Click **Download free for Windows** above.
2. Open the file. If your browser asks, choose **Keep**.
3. Windows may show "Windows protected your PC" because Nexa is new and not yet signed. Click **More info**, then **Run anyway**.
4. Click **Next**, **Install**, **Finish**. Nexa opens in its own window and adds itself to your Start menu and desktop.

Your files stay on your computer, in `%LOCALAPPDATA%\Astute Nexa`. Uninstalling Nexa keeps them.

## Mac

<p><b><a href="https://github.com/nicholaslorizio/astute-nexa/raw/main/download/Astute-Nexa-Mac-AppleSilicon.zip">Download for Mac with Apple silicon (M1 or newer)</a></b> · <b><a href="https://github.com/nicholaslorizio/astute-nexa/raw/main/download/Astute-Nexa-Mac-Intel.zip">Download for Mac with Intel</a></b><br>macOS 11 or newer · about 60 MB · not sure which? Apple menu &gt; About This Mac shows "Chip: Apple" or "Processor: Intel".</p>

1. Open the zip, then drag **Astute Nexa** into your **Applications** folder.
2. Double-click **Astute Nexa**. macOS warns that it can't verify the app, because Nexa is new and not yet signed. Click **Done**.
3. Open **System Settings > Privacy & Security**, scroll down and click **Open Anyway** next to Astute Nexa, then enter your Mac password and click **Open**. You only do this once.

On macOS 14 or older, Control-click the app, choose **Open**, then **Open** again. Nexa opens in its own window when Chrome, Edge or Brave is installed, and in Safari otherwise. Your files stay in `~/Library/Application Support/Astute Nexa`.

## Linux

- **Ubuntu, Debian, Mint, Pop!_OS:** <b><a href="https://github.com/nicholaslorizio/astute-nexa/raw/main/download/astute-nexa_0.1.0_amd64.deb">download the .deb</a></b> (37 MB), double-click it and click **Install**, then open Astute Nexa from your app menu.
- **Any other 64-bit Linux:** <b><a href="https://github.com/nicholaslorizio/astute-nexa/raw/main/download/Astute-Nexa-Linux-x64.tar.gz">download the .tar.gz</a></b> (62 MB), unpack it and run `./install.sh` in the folder. It installs for your user with no password and adds Astute Nexa to your app menu.

Nexa opens in its own window when Chrome, Chromium, Edge or Brave is installed. Your files stay in `~/.astute-nexa`.

The Windows app runs on your PC only, so you can try every app on your own. For chat and calls between users, use the free online version at [astute-nexa.onrender.com/cloud](https://astute-nexa.onrender.com/cloud), or run Nexa on your own server as shown below.

---

## Other ways to run it

Pick one. Each way gives you the same app, and these work on Mac and Linux too.

### 1. Run it with one command (Windows, Mac or Linux)

Install [Node.js 22.5 or newer](https://nodejs.org), then open a terminal and run:

```
npx github:nicholaslorizio/astute-nexa
```

Nexa starts and opens in your browser at http://localhost:4580.

### 2. Double-click to start

1. On this page, click **Code**, then **Download ZIP**, and unzip it.
2. Double-click the starter for your computer:
   - **Windows:** `start-windows.bat`
   - **Mac:** `start-mac.command` (the first time, right-click it and choose **Open**)
   - **Linux:** `start-linux.sh`

The first start takes about a minute while it gets ready. If Node.js is missing, the starter opens its download page for you.

### 3. Run it on a server with Docker

```
docker build -t astute-nexa .
docker run -d -p 4580:4580 -v nexa-data:/data --name nexa astute-nexa
```

### 4. Host it in the cloud

The online version, where anyone can make their own workspace from a link, runs with `NEXA_CLOUD=1`. Two ways to host it:

- **Render, free, no card:** [deploy/RENDER.md](deploy/RENDER.md). The `render.yaml` blueprint sets it up, and workspaces are kept in a private GitHub repo of yours because Render's free plan has no lasting disk.
- **Your own server:** [deploy/README.md](deploy/README.md) sets it up on a Linux server with HTTPS and nightly backups.

Both have Google and Apple sign-in ready to switch on.

## Sign up

1. Open Nexa. The first person to arrive sets up the workspace: your name, email and a password. That makes you the owner.
2. Leave **Add a sample doc, budget and deck** ticked if you want something to look around in.
3. Go to **People**, copy the **team link** and send it to your team. Anyone with the link makes an account in seconds. You can limit it to your email domain or turn it off.
4. Or invite someone by email from **People**. Invites can make them a member, an admin or a guest.

**Install it like an app:** on Home, click **Install** (Chrome, Edge) or use **Share > Add to Home Screen** (iPhone, iPad). Nexa then opens in its own window with its own icon.

## What's inside

| App | What it does |
|---|---|
| **Write** | Documents with headings, lists, tables, images, links and version history. Opens and saves `.docx`. |
| **Grid** | Spreadsheets with 73 built-in functions, several sheets, cross-sheet references, formatting and charts. Opens and saves `.xlsx` and `.csv`. |
| **Deck** | Slide decks with five themes, text, shapes and images, and a full-screen presenter. Opens and saves `.pptx`. |
| **Huddle** | Team channels, direct messages, threads, reactions, file sharing, and voice and video calls with screen sharing. |
| **Relay** | Mail for your team, with threads, drafts, attachments and search. Sends to outside addresses when you add an SMTP server. |
| **Cadence** | Calendars with invites, RSVPs, free/busy, repeating events, and `.ics` import and export. |
| **Vault** | All your files in one place: uploads of any kind, folders, version history, share links, Trash, and sync to Windows, Mac, Linux and phones. |

Sharing works the same everywhere: a file is private until you share it, people get **view** or **edit**, and folders pass access on to what's inside.

## Sync your files to your computer and phone

Vault works as a network drive, so files show up in your computer's own file browser.

1. In Vault, click **Sync**.
2. Click **Make a sync password**. Use it only for syncing; your main password won't work there.
3. Follow the steps shown for your device:
   - **Windows:** File Explorer > This PC > **Map network drive**. Windows needs HTTPS, so use this on a hosted Nexa.
   - **Mac:** Finder > Go > **Connect to Server**.
   - **Linux:** your file manager's **Connect to Server**, or `rclone bisync` for two-way sync with offline copies.
   - **iPhone and Android:** a free WebDAV app, such as Documents by Readdle on iPhone, or FolderSync, Solid Explorer or Material Files on Android.

Write, Grid and Deck files appear on the drive as `.docx`, `.xlsx` and `.pptx`. Saving over one from Word, Excel or PowerPoint keeps the old version in history.

## Settings

Set these as environment variables before you start Nexa. All are optional.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `4580` | Port to listen on. |
| `HOST` | `0.0.0.0` | Address to listen on. Use `127.0.0.1` to keep it on your computer only. |
| `NEXA_DATA` | `~/.astute-nexa` | Folder for the database and files. Back this folder up. |
| `NEXA_SECURE_COOKIES` | off | Set to `1` when Nexa is served over HTTPS. |
| `NEXA_TRUST_PROXY` | off | Set to `1` behind a reverse proxy or load balancer. |
| `NEXA_SMTP_URL` | none | An SMTP server, such as `smtps://user:pass@smtp.example.com`, so Relay can send mail outside your team. |
| `NEXA_SMTP_FROM` | none | The From address for outside mail. |
| `NEXA_MAX_UPLOAD_MB` | `100` | Largest file one person can upload. |
| `NEXA_QUOTA_GB` | none | Storage limit for each person. |
| `NEXA_SOURCE_URL` | this repo | The source code link shown in the app, which the AGPL asks you to offer. Point it at your copy if you change the code. |
| `NEXA_CLOUD` | off | Set to `1` to host many workspaces on one server, each opened at `/w/<name>`. |
| `NEXA_PUBLIC_URL` | none | The site's `https://` address, needed for Google and Apple sign-in. |
| `NEXA_MAX_WORKSPACES` | `100` | With `NEXA_CLOUD`, the most workspaces the server will hold. |
| `NEXA_WORKSPACE_GB` | `1` | With `NEXA_CLOUD`, storage for each workspace. |
| `NEXA_GOOGLE_CLIENT_ID`, `NEXA_GOOGLE_CLIENT_SECRET` | none | Turn on Continue with Google. |
| `NEXA_APPLE_CLIENT_ID`, `NEXA_APPLE_TEAM_ID`, `NEXA_APPLE_KEY_ID`, `NEXA_APPLE_PRIVATE_KEY_FILE` | none | Turn on Continue with Apple. |
| `NEXA_GITHUB_REPO`, `NEXA_GITHUB_TOKEN` | none | With `NEXA_CLOUD`, keep workspaces in a private GitHub repo, for hosts whose disk is wiped on restart. See [deploy/RENDER.md](deploy/RENDER.md). |
| `NEXA_MIN_FREE_MB` | `2048` | With `NEXA_CLOUD`, stop making new workspaces when free disk drops below this. |
| `NEXA_TURN_CF_KEY_ID`, `NEXA_TURN_CF_API_TOKEN` | none | A Cloudflare TURN key, so calls connect on networks that block direct connections. See [deploy/RENDER.md](deploy/RENDER.md). |
| `NEXA_TURN_URLS`, `NEXA_TURN_USERNAME`, `NEXA_TURN_CREDENTIAL` | none | Any other TURN server, with a fixed login. Use `NEXA_TURN_SECRET` instead of the user name and password for coturn's `use-auth-secret`. |
| `NEXA_ICE_POLICY` | `all` | Set to `relay` to send every call through TURN, to check the relay works. |

## Security

- Passwords are hashed with scrypt. Sessions use HTTP-only cookies.
- Every change needs a same-site request, which blocks cross-site forgery.
- A strict Content Security Policy blocks outside scripts, and documents are cleaned of scripts on save.
- Public share links can expire, can be view-only, and the owner can turn them off for the whole workspace.
- Disabling an account ends its sessions and live connections at once.

Found a security problem? Please open a private security advisory on this repo instead of a public issue.

## For developers

```
git clone https://github.com/nicholaslorizio/astute-nexa
cd astute-nexa
npm install
npm start      # http://localhost:4580
npm test       # 53 tests
```

No build step. The server is Node.js with Express, SQLite (built into Node) and WebSockets. The front end is plain JavaScript.

- `server/` the API, realtime, mail, calendar, Vault and WebDAV
- `public/` the web app, one file per app in `public/js/`
- `shared/` the formula engine and deck themes, used by both sides
- `test/` the test suite

## Coming next

- **Cross-company chat.** Huddle works inside one workspace today. Chat and calls between different companies' workspaces are coming with paid plans, under proper licensing.

## More

- [How Nexa compares with Microsoft 365](COMPARISON.md), including what v1 does not do yet
- [Brand guide](BRANDING.md)
- [Open source licenses of the parts Nexa uses](LICENSES.md)

## License

Astute Nexa is free software under the [GNU Affero General Public License v3.0](LICENSE). You can use, change and share it. If you run a changed version for other people over a network, you must offer them your source code too.

Astute Nexa is not affiliated with Microsoft. Microsoft 365, Word, Excel, PowerPoint, Teams, Outlook and OneDrive are trademarks of Microsoft Corporation.
