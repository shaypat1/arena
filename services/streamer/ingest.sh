#!/bin/bash
# Ingests an HLS camera feed and publishes to LiveKit via WHIP.
# Usage: ./ingest.sh <room_name> <hls_url>
#
# LiveKit's WHIP endpoint accepts WebRTC directly from ffmpeg.
# This gives all viewers identical frames with <500ms latency.

ROOM="$1"
HLS_URL="$2"

if [ -z "$ROOM" ] || [ -z "$HLS_URL" ]; then
  echo "Usage: ./ingest.sh <room_name> <hls_url>"
  exit 1
fi

LIVEKIT_URL="${LIVEKIT_URL:-http://localhost:7880}"
LIVEKIT_API_KEY="${LIVEKIT_API_KEY:-devkeyd4873a35}"
LIVEKIT_API_SECRET="${LIVEKIT_API_SECRET:-93f51df203aeff0c352c90c2abadcbc64ae186d2d7e4db79}"

# Use livekit-cli to publish the HLS stream into a room
# livekit-cli supports ingesting RTMP/WHIP, but the simplest path
# is to use ffmpeg to re-stream to LiveKit's WHIP endpoint.

WHIP_URL="${LIVEKIT_URL}/whip/${ROOM}"

echo "[ingest] Room: $ROOM"
echo "[ingest] Source: $HLS_URL"
echo "[ingest] WHIP: $WHIP_URL"

# Generate a token for publishing
TOKEN=$(livekit-cli create-token \
  --api-key "$LIVEKIT_API_KEY" \
  --api-secret "$LIVEKIT_API_SECRET" \
  --join --room "$ROOM" \
  --identity "camera-feed" \
  --grant-publish 2>/dev/null)

echo "[ingest] Starting ffmpeg..."

# ffmpeg reads HLS, transcodes to VP8/Opus, sends via WHIP
exec ffmpeg -hide_banner -loglevel warning \
  -i "$HLS_URL" \
  -c:v libvpx -b:v 1500k -maxrate 2000k -bufsize 3000k \
  -deadline realtime -cpu-used 8 \
  -an \
  -f whip \
  -auth_token "$TOKEN" \
  "$WHIP_URL"
