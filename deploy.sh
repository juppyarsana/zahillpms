#!/bin/bash
set -e

echo ""
echo "══════════════════════════════════════"
echo "  Birdnest PMS — Deploy"
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
npm install
echo ""
echo "▸ Building client..."
npm run build
cd ..

# ── Room Display build ────────────────────────────────────────────────────────
if [ -d "room-display" ]; then
  echo ""
  echo "▸ Installing room-display dependencies..."
  cd room-display
  npm install
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

# ── Restart server ────────────────────────────────────────────────────────────
echo ""
echo "▸ Restarting server via PM2..."
pm2 restart birdnest-pms --update-env

echo ""
echo "══════════════════════════════════════"
echo "  Deploy complete!"
echo "══════════════════════════════════════"
echo ""
