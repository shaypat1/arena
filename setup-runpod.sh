#!/bin/bash
# Arena RunPod setup — paste this entire thing into the web terminal
set -e

echo "=== Installing system deps ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs postgresql redis-server ffmpeg 2>/dev/null

echo "=== Starting services ==="
service postgresql start
service redis-server start

echo "=== Setting up database ==="
su - postgres -c "psql -c \"CREATE USER arena WITH PASSWORD 'arena_dev' CREATEDB;\"" 2>/dev/null || true
su - postgres -c "psql -c \"CREATE DATABASE arena OWNER arena;\"" 2>/dev/null || true

echo "=== Installing Node deps ==="
cd /workspace/arena
npm install --prefix services/api
npm install --prefix services/wallet
npm install --prefix frontend

echo "=== Installing Python deps ==="
pip install -q ultralytics opencv-python-headless psycopg2-binary redis numpy

echo "=== Running migrations ==="
for f in db/migrations/*.sql; do
  PGPASSWORD=arena_dev psql -U arena -h localhost -d arena -f "$f" 2>/dev/null
done

echo "=== Creating dirs ==="
mkdir -p services/api/stream services/api/clips

echo "=== Starting API on port 4000 ==="
export DATABASE_URL=postgresql://arena:arena_dev@localhost:5432/arena
export REDIS_URL=redis://localhost:6379
export JWT_SECRET=dev_secret_change_in_prod
export NODE_ENV=development
export PORT=4000
NODE_PATH=services/api/node_modules:services/wallet/node_modules nohup node services/api/index.js > /tmp/api.log 2>&1 &
sleep 3

echo "=== Starting frontend on port 3000 ==="
cd /workspace/arena/frontend
NEXT_PUBLIC_API_URL=http://localhost:4000 nohup npx next dev --port 3000 > /tmp/frontend.log 2>&1 &
sleep 5
cd /workspace/arena

echo "=== Starting CV restream ==="
cd /workspace/arena/services/cv-counter
nohup python restream.py --camera-id nysdot-R11_082 --fps 15 --conf 0.25 > /tmp/restream.log 2>&1 &
sleep 3
cd /workspace/arena

echo ""
echo "=== Status ==="
echo "API: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/health)"
echo "Frontend: $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000)"
echo "CV: $(tail -1 /tmp/restream.log)"
echo ""
echo "✓ Done! Open https://krxyqkpr9hrltg-3001.proxy.runpod.net/"
