# Astute Nexa online

No server? [RENDER.md](RENDER.md) runs it on Render's free plan with no card.

The online version runs many workspaces on one server. People open a link, make a workspace or join one, and chat, call and share files with their team in the browser.

It is free to host on Oracle Cloud's Always Free tier: one Arm server with 2 cores and 12 GB of memory, 200 GB of disk and 10 TB of traffic a month, at no charge. Oracle asks for a card to confirm who you are and does not charge it unless you upgrade the account.

## 1. Make the server (about 15 minutes)

1. Sign up at oracle.com/cloud/free. Pick a home region near your users; Always Free servers stay in that region.
2. In the console, go to **Compute > Instances > Create instance**.
   - Image: **Ubuntu 24.04**.
   - Shape: **Ampere VM.Standard.A1.Flex**, 2 OCPUs and 12 GB memory (inside the free limit). If Oracle says it is out of capacity, try another availability domain or try again later.
   - Under **Add SSH keys**, pick **Generate a key pair for me** and click **Save private key**. Then **Create**.
3. Open the web ports: **Networking > Virtual cloud networks >** your network **> Security lists > Default > Add ingress rules**: source `0.0.0.0/0`, TCP, destination ports `80,443`.
4. When the instance shows **Running**, copy its **Public IP address**. On Windows, open PowerShell and connect (use your key file's name and the IP):

   ```
   ssh -i $HOME\Downloads\ssh-key-2026-11-25.key ubuntu@<public IP>
   ```

   Type `yes` if it asks about the fingerprint. Then run:

   ```
   curl -fsSL https://raw.githubusercontent.com/nicholaslorizio/astute-nexa/main/deploy/setup-server.sh | sudo bash
   ```

   It prints the address, like `https://129-146-1-2.sslip.io`. No domain is needed. To use your own domain, point it at the server and change `sudo bash` to `sudo DOMAIN=nexa.example.com bash`.

Oracle can reclaim idle Always Free servers (under 20% use for 7 days). Nightly backups go to `/var/lib/astute-nexa/backups` on the server's own disk, so copy them somewhere else now and then.

## 2. Turn on Google sign-in (free, optional)

1. Go to console.cloud.google.com, make a project, then **APIs & Services > OAuth consent screen**: External, app name Astute Nexa, your support email. Publish it.
2. **Credentials > Create credentials > OAuth client ID**: Web application. Authorized redirect URI: `https://<your address>/sso/google/callback`.
3. Put the client ID and secret in `/etc/astute-nexa.env` as `NEXA_GOOGLE_CLIENT_ID` and `NEXA_GOOGLE_CLIENT_SECRET`, then `sudo systemctl restart astute-nexa`.

## 3. Turn on Apple sign-in (needs the $99 a year Apple Developer Program)

1. In developer.apple.com: make an App ID with Sign in with Apple, then a **Services ID** (this is the client ID). Configure it with your domain and the return URL `https://<your address>/sso/apple/callback`.
2. **Keys > +**: enable Sign in with Apple, download the `.p8` key and note its Key ID.
3. Copy the key to `/etc/astute-nexa-apple.p8` (`chown root:nexa`, `chmod 640`) and fill `NEXA_APPLE_CLIENT_ID`, `NEXA_APPLE_TEAM_ID`, `NEXA_APPLE_KEY_ID` and `NEXA_APPLE_PRIVATE_KEY_FILE` in `/etc/astute-nexa.env`, then restart.

Apple asks you to register the domain the sign-in comes from, so your own domain is the safest choice for Apple sign-in.

## Limits you can change

In `/etc/astute-nexa.env`: `NEXA_MAX_WORKSPACES` (100), `NEXA_WORKSPACE_GB` storage per workspace (1), `NEXA_MAX_UPLOAD_MB` (25). New workspaces also stop when the disk has less than 2 GB free, and each address can make 3 workspaces a day.

## Updating

```
sudo git -C /opt/astute-nexa pull && sudo bash -c 'cd /opt/astute-nexa && npm ci --omit=dev' && sudo systemctl restart astute-nexa
```
