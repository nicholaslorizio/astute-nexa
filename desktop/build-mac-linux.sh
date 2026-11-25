#!/usr/bin/env bash
# Builds the Mac and Linux downloads of Astute Nexa from this repo.
# Needs: bash, tar, xz, zip, dpkg-deb, python3 with Pillow, and the official Node.js
# tarballs for darwin-arm64, darwin-x64 and linux-x64 in $NODE_DL (checked against SHASUMS256.txt).
# Output in $OUT:
#   Astute-Nexa-Mac-AppleSilicon.zip, Astute-Nexa-Mac-Intel.zip
#   astute-nexa_<version>_amd64.deb, Astute-Nexa-Linux-x64.tar.gz
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_VER="${NODE_VER:-22.23.5}"
NODE_DL="${NODE_DL:?set NODE_DL to the folder with the Node tarballs}"
OUT="${OUT:-$ROOT/download}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
VERSION="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$ROOT/package.json")"
mkdir -p "$OUT"

(cd "$NODE_DL" && grep -E "node-v$NODE_VER-(darwin-arm64|darwin-x64)\.tar\.gz|node-v$NODE_VER-linux-x64\.tar\.xz" SHASUMS256.txt | sha256sum -c -)

# 1. The app itself: server, web files and production dependencies only.
APP="$WORK/app"
mkdir -p "$APP"
cp -R "$ROOT/server" "$ROOT/shared" "$ROOT/public" "$ROOT/bin" "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/LICENSE" "$ROOT/README.md" "$APP/"
[ -d "$ROOT/LICENSES" ] && cp -R "$ROOT/LICENSES" "$APP/"
cp -R "$ROOT/node_modules" "$APP/node_modules"   # the app has no dev dependencies, so this is the production set

node_bin() { # $1 = darwin-arm64 | darwin-x64 | linux-x64, $2 = destination file
  local d="$WORK/node-$1"; mkdir -p "$d"
  case "$1" in linux-*) tar -xJf "$NODE_DL/node-v$NODE_VER-$1.tar.xz" -C "$d" --strip-components=2 "node-v$NODE_VER-$1/bin/node";;
                   *) tar -xzf "$NODE_DL/node-v$NODE_VER-$1.tar.gz" -C "$d" --strip-components=2 "node-v$NODE_VER-$1/bin/node";; esac
  cp "$d/node" "$2"; chmod 755 "$2"
}

# 2. Mac: a normal "Astute Nexa.app" per chip. The official Node binary inside is Apple-signed by the Node.js project.
python3 - "$ROOT/public/icons/icon-512.png" "$WORK/AppIcon.icns" <<'PY'
import sys
from PIL import Image
Image.open(sys.argv[1]).convert('RGBA').resize((1024, 1024), Image.LANCZOS).save(sys.argv[2], sizes=[(16,16),(32,32),(64,64),(128,128),(256,256),(512,512),(1024,1024)])
PY
for arch in arm64 x64; do
  B="$WORK/mac-$arch/Astute Nexa.app/Contents"
  mkdir -p "$B/MacOS" "$B/Resources"
  cp -R "$APP" "$B/Resources/app"
  cp "$ROOT/desktop/launcher.js" "$B/Resources/launcher.js"
  cp "$WORK/AppIcon.icns" "$B/Resources/AppIcon.icns"
  node_bin "darwin-$arch" "$B/MacOS/node"
  cat > "$B/MacOS/Astute Nexa" <<'SH'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/../Resources/launcher.js"
SH
  chmod 755 "$B/MacOS/Astute Nexa"
  cat > "$B/Info.plist" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Astute Nexa</string>
  <key>CFBundleDisplayName</key><string>Astute Nexa</string>
  <key>CFBundleIdentifier</key><string>io.github.nicholaslorizio.astute-nexa</string>
  <key>CFBundleExecutable</key><string>Astute Nexa</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSHumanReadableCopyright</key><string>Free and open source under AGPL-3.0</string>
</dict>
</plist>
PL
  name=$([ "$arch" = arm64 ] && echo AppleSilicon || echo Intel)
  rm -f "$OUT/Astute-Nexa-Mac-$name.zip"
  (cd "$WORK/mac-$arch" && zip -qry -9 "$OUT/Astute-Nexa-Mac-$name.zip" "Astute Nexa.app")
done

# 3. Linux: one folder that runs anywhere, installed per user with no password, plus a .deb for Ubuntu and Debian.
L="$WORK/linux/astute-nexa"
mkdir -p "$L"
cp -R "$APP" "$L/app"
cp "$ROOT/desktop/launcher.js" "$L/launcher.js"
cp "$ROOT/public/icons/icon-512.png" "$L/astute-nexa.png"
node_bin linux-x64 "$L/node"
cat > "$L/astute-nexa" <<'SH'
#!/bin/sh
DIR="$(dirname "$(readlink -f "$0")")"
exec "$DIR/node" "$DIR/launcher.js" "$@"
SH
chmod 755 "$L/astute-nexa"
cp "$ROOT/desktop/linux/install.sh" "$L/install.sh"; chmod 755 "$L/install.sh"
rm -f "$OUT/Astute-Nexa-Linux-x64.tar.gz"
tar -C "$WORK/linux" --owner=0 --group=0 -czf "$OUT/Astute-Nexa-Linux-x64.tar.gz" astute-nexa

D="$WORK/deb"
mkdir -p "$D/DEBIAN" "$D/opt" "$D/usr/bin" "$D/usr/share/applications" "$D/usr/share/icons/hicolor/512x512/apps"
cp -R "$L" "$D/opt/astute-nexa"; rm "$D/opt/astute-nexa/install.sh"
ln -s /opt/astute-nexa/astute-nexa "$D/usr/bin/astute-nexa"
cp "$L/astute-nexa.png" "$D/usr/share/icons/hicolor/512x512/apps/astute-nexa.png"
sed 's#^Exec=.*#Exec=/opt/astute-nexa/astute-nexa#; s#^Icon=.*#Icon=astute-nexa#' "$ROOT/desktop/linux/astute-nexa.desktop" > "$D/usr/share/applications/astute-nexa.desktop"
cat > "$D/DEBIAN/control" <<CT
Package: astute-nexa
Version: $VERSION
Section: office
Priority: optional
Architecture: amd64
Maintainer: Astute Nexa <https://github.com/nicholaslorizio/astute-nexa>
Homepage: https://github.com/nicholaslorizio/astute-nexa
Recommends: chromium | chromium-browser | google-chrome-stable | microsoft-edge-stable | brave-browser
Description: Free, open source alternative to Microsoft 365
 Seven apps in one window: Write (documents, .docx), Grid (spreadsheets, .xlsx),
 Deck (presentations, .pptx), Huddle (chat and video calls), Relay (mail),
 Cadence (calendars) and Vault (files). Runs on this computer; data stays here.
CT
printf '#!/bin/sh\nset -e\ncommand -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true\ncommand -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q /usr/share/icons/hicolor || true\n' > "$D/DEBIAN/postinst"
chmod 755 "$D/DEBIAN/postinst"
rm -f "$OUT/astute-nexa_${VERSION}_amd64.deb"
dpkg-deb --root-owner-group -Zxz --build "$D" "$OUT/astute-nexa_${VERSION}_amd64.deb" >/dev/null

ls -la "$OUT"
