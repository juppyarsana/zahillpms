#!/bin/bash
set -e

# Everything lives inside main() and runs via `main "$@"` at the very bottom.
# Why: this script does `git pull` on itself partway through. Bash reads a
# script from disk as it executes, rather than loading the whole file
# upfront — if git pull rewrites deploy.sh mid-run, bash's read position can
# fall out of sync with the new file's content, silently skipping whatever
# changed after that point (this is exactly how the kitchen-display build
# step went missing after it was added). A function body is fully parsed
# into memory before any of it runs, so it keeps executing correctly even
# if the file on disk changes underneath it.
main() {

echo ""
echo "══════════════════════════════════════"
echo "  Zahill PMS — Deploy"
echo "══════════════════════════════════════"

# ── Git ──────────────────────────────────────────────────────────────────────
echo ""
echo "▸ Git status"
git status --short

echo ""
echo "▸ Pulling latest changes..."
git pull

# ── Server dependencies ───────────────────────────────────────────────────────
echo ""
echo "▸ Installing server dependencies..."
cd server
npm install --omit=dev
cd ..

# ── Migrations ────────────────────────────────────────────────────────────────
echo ""
echo "▸ Running database migrations..."
cd server
npm run migrate
cd ..

# ── Client build ──────────────────────────────────────────────────────────────
echo ""
echo "▸ Installing client dependencies..."
cd client
npm install --legacy-peer-deps
echo ""
echo "▸ Building client..."
npm run build
cd ..

# ── Room Display build ────────────────────────────────────────────────────────
if [ -d "room-display" ]; then
  echo ""
  echo "▸ Installing room-display dependencies..."
  cd room-display
  npm install --legacy-peer-deps
  echo ""
  echo "▸ Building room-display..."
  npm run build
  cd ..
fi

# ── TV Display build ──────────────────────────────────────────────────────────
if [ -d "tv-display" ]; then
  echo ""
  echo "▸ Installing tv-display dependencies..."
  cd tv-display
  npm install
  echo ""
  echo "▸ Building tv-display..."
  npm run build
  cd ..
fi

# ── Kitchen Display build ─────────────────────────────────────────────────────
if [ -d "kitchen-display" ]; then
  echo ""
  echo "▸ Installing kitchen-display dependencies..."
  cd kitchen-display
  npm install
  echo ""
  echo "▸ Building kitchen-display..."
  npm run build
  cd ..
fi

# ── Restart server ────────────────────────────────────────────────────────────
echo ""
echo "▸ Restarting server via PM2..."
pm2 restart zahill-pms --update-env

echo ""
echo "══════════════════════════════════════"
echo "  Deploy complete!"
echo "══════════════════════════════════════"
echo ""

}

main "$@"
