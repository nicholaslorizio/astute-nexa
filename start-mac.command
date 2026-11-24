#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Astute Nexa needs Node.js 22.5 or newer."
  echo "Opening the download page. Install it, then double-click this file again."
  open https://nodejs.org
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "First run: getting Astute Nexa ready. This takes a minute."
  npm install --omit=dev
fi
node bin/nexa.js
