#!/bin/sh
# Installs Astute Nexa for this user only: no password needed. Run it from the unpacked folder.
set -e
SRC="$(dirname "$(readlink -f "$0")")"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DEST/applications"
mkdir -p "$DEST/astute-nexa" "$APPS" "$DEST/icons/hicolor/512x512/apps" "$HOME/.local/bin"
cp -R "$SRC/." "$DEST/astute-nexa/"
rm -f "$DEST/astute-nexa/install.sh"
cp "$SRC/astute-nexa.png" "$DEST/icons/hicolor/512x512/apps/astute-nexa.png"
ln -sf "$DEST/astute-nexa/astute-nexa" "$HOME/.local/bin/astute-nexa"
cat > "$APPS/astute-nexa.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Astute Nexa
GenericName=Office suite
Comment=Documents, spreadsheets, slides, chat, mail, calendar and files
Exec="$DEST/astute-nexa/astute-nexa"
Icon=astute-nexa
Terminal=false
Categories=Office;WordProcessor;Spreadsheet;Presentation;
StartupNotify=true
DESK
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q "$APPS" || true
echo "Astute Nexa is installed. Open it from your app menu, or run: astute-nexa"
[ "${1:-}" = "--no-launch" ] || ("$DEST/astute-nexa/astute-nexa" >/dev/null 2>&1 &)
