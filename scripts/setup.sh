#!/usr/bin/env bash
# From a fresh clone to a first sweep. Run it once.
#
# It installs, builds, copies the example config, and tells you exactly what
# is still missing. It never writes a secret and never contacts anything.
set -euo pipefail

cd "$(dirname "$0")/.."

say() { printf '\n%s\n' "$1"; }

say "1. Checking Node"
required=20
actual="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$actual" -lt "$required" ]; then
  echo "Node $required or newer is needed. This is $(node -v)."
  exit 1
fi
echo "   $(node -v)"

say "2. Installing"
npm ci --silent 2>/dev/null || npm install --silent

say "3. Building"
npm run build --silent

say "4. Config"
if [ -f .env ]; then
  echo "   .env is already there, leaving it alone"
else
  cp .env.example .env
  echo "   copied .env.example to .env"
fi

say "5. What is still missing"
node --env-file-if-exists=.env dist/config/check.js || true

cat <<'NEXT'

Next, in order:

  1. Fill in .env. Every name in it says where to get the value.
  2. Make the base, if you have not:  npm run base:create -- wspYOURWORKSPACE
     Then add the link field, the rollups and the Development formula it
     prints. The Development field must be a formula.
  3. Check the base matches your config:  npm run airtable:check
  4. Run your first sweep:               npm run sweep

The first sweep spawns nobody and spends nothing. It reads the board, opens
the subtask each component needs, and checks any evidence already reported.
NEXT
