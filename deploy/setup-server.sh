#!/usr/bin/env bash
# Sets up Astute Nexa online on a fresh Ubuntu 22.04 or 24.04 server (built for Oracle Cloud Always Free).
# Run once as root:  curl -fsSL https://raw.githubusercontent.com/nicholaslorizio/astute-nexa/main/deploy/setup-server.sh | sudo bash
# Optional before running: export DOMAIN=nexa.example.com (otherwise <public-ip>.sslip.io is used, no domain needed).
set -euo pipefail
NODE_VER="${NODE_VER:-22.23.5}"
REPO="${REPO:-https://github.com/nicholaslorizio/astute-nexa.git}"
APP=/opt/astute-nexa
DATA=/var/lib/astute-nexa
ENV=/etc/astute-nexa.env

case "$(uname -m)" in aarch64) ARCH=arm64;; x86_64) ARCH=x64;; *) echo "Unsupported CPU $(uname -m)"; exit 1;; esac
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq git curl ca-certificates xz-utils debian-keyring debian-archive-keyring apt-transport-https gnupg iptables-persistent

# Node.js from nodejs.org, checked against its published checksums.
if ! /usr/local/bin/node -v 2>/dev/null | grep -q "v$NODE_VER"; then
  T=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-$ARCH.tar.xz" -o "$T/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VER/SHASUMS256.txt" -o "$T/SHASUMS256.txt"
  (cd "$T" && grep " node-v$NODE_VER-linux-$ARCH.tar.xz\$" SHASUMS256.txt | sed "s# node-v.*# node.tar.xz#" | sha256sum -c -)
  tar -xJf "$T/node.tar.xz" -C /usr/local --strip-components=1
  rm -rf "$T"
fi

# Caddy, for automatic HTTPS.
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -yq caddy
fi

# The app, run by its own user with no login.
id nexa >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin nexa
mkdir -p "$DATA" && chown nexa:nexa "$DATA" && chmod 700 "$DATA"
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone --depth 1 "$REPO" "$APP"; fi
(cd "$APP" && /usr/local/bin/npm ci --omit=dev --no-audit --no-fund)

IP="$(curl -fsS https://api.ipify.org || true)"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"
if [ ! -f "$ENV" ]; then
  cat > "$ENV" <<EOF
NEXA_CLOUD=1
PORT=4580
HOST=127.0.0.1
NEXA_DATA=$DATA
NEXA_PUBLIC_URL=https://$DOMAIN
NEXA_SECURE_COOKIES=1
NEXA_TRUST_PROXY=1
NEXA_MAX_WORKSPACES=100
NEXA_WORKSPACE_GB=1
NEXA_MAX_UPLOAD_MB=25
# Google sign-in: fill both, then run: systemctl restart astute-nexa
#NEXA_GOOGLE_CLIENT_ID=
#NEXA_GOOGLE_CLIENT_SECRET=
# Apple sign-in: fill all four (key file must be readable by the nexa user), then restart.
#NEXA_APPLE_CLIENT_ID=
#NEXA_APPLE_TEAM_ID=
#NEXA_APPLE_KEY_ID=
#NEXA_APPLE_PRIVATE_KEY_FILE=/etc/astute-nexa-apple.p8
EOF
  chmod 640 "$ENV"; chown root:nexa "$ENV"
fi

cp "$APP/deploy/astute-nexa.service" /etc/systemd/system/astute-nexa.service
cp "$APP/deploy/astute-nexa-backup.service" "$APP/deploy/astute-nexa-backup.timer" /etc/systemd/system/
DOMAIN_IN_ENV="$(sed -n 's#^NEXA_PUBLIC_URL=https://##p' "$ENV")"
sed "s#{\$DOMAIN}#$DOMAIN_IN_ENV#" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile

# Oracle's Ubuntu images only let SSH in, so open the web ports too.
for p in 80 443; do iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport $p -j ACCEPT; done
netfilter-persistent save >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl enable --now astute-nexa astute-nexa-backup.timer
systemctl restart caddy
echo
echo "Astute Nexa online is starting at https://$DOMAIN_IN_ENV"
echo "If it does not load, open ports 80 and 443 in the Oracle Cloud console (Networking > Virtual cloud networks > Security lists)."
