# Put the online version on Render's free plan

This runs the online version of Astute Nexa, where anyone can make their own workspace from a link,
for free on [Render](https://render.com). No card is needed. Render's free plan wipes its disk whenever
the server restarts or sleeps, so Nexa keeps every workspace in a private GitHub repo of yours and
brings them back on start.

## What you get

- An address like `https://astute-nexa.onrender.com` with HTTPS.
- Live chat and calls in Huddle, and Write, Grid, Deck, Relay, Cadence and Vault.
- Up to 30 workspaces, 50 MB each, with uploads up to 10 MB. Change these in Render under
  **Environment** (`NEXA_MAX_WORKSPACES`, `NEXA_WORKSPACE_GB`, `NEXA_MAX_UPLOAD_MB`).

Limits of the free plan:

- After 15 minutes with no visitors the server sleeps. The next visitor waits about a minute while it wakes.
- Render gives 750 free hours a month, enough to stay on all month.
- Nexa saves changed workspaces to GitHub once a minute and again when Render stops the server.
  If the server crashes outright, the last minute of changes can be lost.
- Render may restart a free server at any time. Data comes back from GitHub when it does.

## 1. Make the private data repo on GitHub

1. Open <https://github.com/new>.
2. Name it `nexa-data`, choose **Private**, and tick **Add a README file**. The README matters: Nexa
   can't save to a repo with no commits.
3. Click **Create repository**.

## 2. Make a token that can only reach that repo

1. Open <https://github.com/settings/personal-access-tokens/new>.
2. Give it a name like `Astute Nexa data` and pick an expiry.
3. Under **Repository access**, choose **Only select repositories** and pick `nexa-data`.
4. Under **Permissions**, set **Contents** to **Read and write**. Leave everything else as it is.
5. Click **Generate token** and copy it. Paste it only into Render in the next step.

## 3. Create the service on Render

1. Sign up at <https://render.com> with your GitHub account. The free plan needs no card.
2. Click **New**, then **Blueprint**, and pick the `astute-nexa` repo. Render reads `render.yaml`.
3. Render asks for two values:
   - `NEXA_GITHUB_REPO`: your user name and the data repo, like `nicholaslorizio/nexa-data`
   - `NEXA_GITHUB_TOKEN`: the token from step 2
4. Click **Apply**. The first build takes a few minutes.
5. Open the service's address and add `/cloud/` to make the first workspace.

## Google and Apple sign-in

Both stay off until their keys are set. Follow the Google and Apple parts of
[README.md](README.md), with these two changes:

- The sign-in return address is `https://<your-service>.onrender.com/sso/google/callback`
  (or `/sso/apple/callback`).
- Add the keys in Render under **Environment** instead of `/etc/astute-nexa.env`.

Render tells Nexa its own address, so `NEXA_PUBLIC_URL` isn't needed unless you add your own domain.

## Updating

Render rebuilds and restarts on every push to `main`. Workspaces are saved to GitHub before it stops
and come back when it starts.

## If something goes wrong

- **The service won't start and the log says GitHub 401 or 403:** the token is wrong, expired, or
  can't write to `nexa-data`. Make a new one as in step 2 and replace it under **Environment**.
- **The log says the GitHub repo is empty:** the data repo has no README. Add any file to it on GitHub.
- **The log says it can't find the branch:** check `NEXA_GITHUB_REPO` and that the token was given that repo.
- **"This server is full for now":** 30 workspaces exist. Raise `NEXA_MAX_WORKSPACES`, keeping in
  mind that every workspace is saved to the data repo.
