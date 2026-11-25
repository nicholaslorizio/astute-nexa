# Astute Nexa and Microsoft 365: an honest comparison

Nexa v0.1 covers the everyday work of a small team in one free, self-hosted app. Microsoft 365 is far larger and more mature. This page says plainly where each one stands, so you can decide.

## Where Nexa is ahead

- **Free and open.** No per-seat fee. The full source is public under AGPL-3.0.
- **You own the data.** Everything lives in one folder on your own computer or server. No vendor account needed.
- **One app, one sign-in.** Docs, sheets, slides, chat, calls, mail, calendar and files share one sidebar, one search and one sharing model.
- **Runs anywhere.** One command on Windows, Mac or Linux, a Docker image, or a one-click cloud blueprint. Installs as an app from the browser.
- **Small and readable.** No build step and few dependencies, so a team can audit it and change it.

## Side by side

| | Astute Nexa v0.1 | Microsoft 365 |
|---|---|---|
| Documents | Write: rich text, tables, images, versions. Opens and saves `.docx`. | Word: far deeper layout, styles, review tools, comments, track changes. |
| Spreadsheets | Grid: 73 functions, several sheets, charts, `.xlsx` and `.csv`. | Excel: hundreds of functions, pivot tables, macros, Power Query. |
| Presentations | Deck: 5 themes, text, shapes, images, presenter. `.pptx`. | PowerPoint: animations, transitions, designer, rehearsal tools. |
| Chat and calls | Huddle: channels, DMs, threads, reactions, calls up to 8 with screen share. | Teams: large meetings and webinars, recording, transcripts, phone system. |
| Mail | Relay: team mail, drafts, attachments; sends outside via your SMTP server. | Outlook and Exchange: full inbound and outbound mail on your domain. |
| Calendar | Cadence: invites, RSVP, free/busy, repeats, `.ics`. | Outlook calendar: rooms, booking pages, delegation. |
| Files | Vault: uploads, folders, versions, share links, WebDAV drive sync. | OneDrive and SharePoint: native sync client, files on demand, intranet sites. |
| Hosting | Your computer, your server, or your cloud account. | Microsoft's cloud. |
| Price | Free. | Paid per user per month. See Microsoft's site for current prices. |

## What Nexa v0.1 does not do yet

Be clear about these before moving a team over.

- **No live co-editing.** Two people can open the same file, and Nexa shows who else is in it. Saves are versioned, and if someone saved first you're told and nothing is lost, though you don't see each other's typing live.
- **No incoming outside mail.** Relay delivers mail inside your workspace and can send out through an SMTP server you add. It does not receive mail from the internet yet.
- **Calls are small.** Up to 8 people, connected directly to each other. Some office and mobile networks block direct connections and need a TURN relay server, which Nexa does not include yet.
- **No native sync app.** Vault syncs through your computer's network drive feature (WebDAV) or `rclone`. There is no Nexa desktop client with files on demand. Windows only maps drives over HTTPS.
- **Office files convert, they don't round-trip perfectly.** Text, tables, images, formulas, sheets and slides come through. Advanced features such as tracked changes, macros, pivot tables, animations and complex layouts are simplified or dropped.
- **Spreadsheet depth.** 73 functions cover everyday sums, lookups, text, dates and logic. Pivot tables, macros and array formulas are not there.
- **No chat between companies.** Huddle works inside one workspace. Chat and calls across different companies' workspaces are coming with paid plans.
- **No AI features.**
- **No mobile apps.** The web app works on phones and installs to the home screen.
- **Single server.** One Nexa runs on one machine with SQLite. It suits teams up to roughly dozens of people, not large companies.
- **No audits or certifications.** Nexa has not had an outside security audit and has no compliance certifications.
- **Names not cleared.** The Nexa app names have not been checked for trademark conflicts.

## Who Nexa suits today

Small teams, clubs, classrooms, nonprofits and startups that want their own private workspace for free, and that can live without the advanced features above.
