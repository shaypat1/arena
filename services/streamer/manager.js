'use strict';

/**
 * Camera stream manager — ingests HLS feeds into LiveKit rooms.
 *
 * Uses @livekit/rtc-node to connect as a participant and publish
 * video frames from ffmpeg. All viewers see identical frames via WebRTC.
 */

const { spawn } = require('child_process');
const { AccessToken } = require('livekit-server-sdk');

const LIVEKIT_URL = process.env.LIVEKIT_URL || 'ws://localhost:7880';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkeyd4873a35';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '93f51df203aeff0c352c90c2abadcbc64ae186d2d7e4db79';
const ROOM_NAME = 'arena-traffic';

let currentRoom = null;
let currentFfmpeg = null;
let currentCameraUrl = null;

async function createPublishToken() {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: 'camera-feed',
    ttl: '1h',
  });
  at.addGrant({
    room: ROOM_NAME,
    roomJoin: true,
    canPublish: true,
    canSubscribe: false,
    roomCreate: true,
  });
  return await at.toJwt();
}

async function createViewerToken(userId) {
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: userId || `viewer-${Date.now()}`,
    ttl: '2h',
  });
  at.addGrant({
    room: ROOM_NAME,
    roomJoin: true,
    canPublish: false,
    canSubscribe: true,
  });
  return await at.toJwt();
}

/**
 * Start streaming an HLS camera feed into LiveKit.
 * Uses ffmpeg to read HLS and output raw I420 frames,
 * which are published as a video track via the LiveKit Node SDK.
 */
async function startStream(hlsUrl) {
  if (hlsUrl === currentCameraUrl && currentFfmpeg && !currentFfmpeg.killed) {
    return;
  }

  stopStream();

  try {
    const { Room, LocalVideoTrack, VideoSource, VideoFrame, TrackPublishOptions, TrackSource } = require('@livekit/rtc-node');

    const token = await createPublishToken();
    const room = new Room();
    await room.connect(LIVEKIT_URL, token);
    console.log(`[streamer] Connected to LiveKit room: ${ROOM_NAME}`);

    // Create a video source and track
    const source = new VideoSource(640, 480);
    const track = LocalVideoTrack.createVideoTrack('camera', source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_CAMERA;
    await room.localParticipant.publishTrack(track, opts);
    console.log(`[streamer] Published video track`);

    // ffmpeg reads HLS, outputs raw I420 frames at 640x480 15fps
    const WIDTH = 640;
    const HEIGHT = 480;
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner', '-loglevel', 'warning',
      '-re',
      '-user_agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      '-i', hlsUrl,
      '-vf', `scale=${WIDTH}:${HEIGHT}`,
      '-r', '15',
      '-pix_fmt', 'yuv420p',
      '-f', 'rawvideo',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    const frameSize = WIDTH * HEIGHT * 3 / 2; // I420 = 1.5 bytes per pixel
    let buffer = Buffer.alloc(0);
    let frameCount = 0;
    let ready = false;

    // Wait for the track to be fully negotiated before sending frames
    setTimeout(() => { ready = true; }, 2000);

    ffmpeg.stdout.on('data', (chunk) => {
      if (!ready) return;
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= frameSize) {
        const frameData = buffer.subarray(0, frameSize);
        buffer = buffer.subarray(frameSize);

        try {
          const frame = new VideoFrame(
            new Uint8Array(frameData),
            0, // I420 format
            WIDTH,
            HEIGHT
          );
          source.captureFrame(frame);
          frameCount++;
          if (frameCount === 1) console.log('[streamer] First frame sent');
        } catch (err) {
          // Skip bad frames
        }
      }
    });

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.includes('deprecated')) console.error(`[streamer/ffmpeg] ${msg}`);
    });

    ffmpeg.on('exit', (code) => {
      console.log(`[streamer] ffmpeg exited: ${code}`);
      if (currentFfmpeg === ffmpeg) { currentFfmpeg = null; currentCameraUrl = null; }
    });

    currentRoom = room;
    currentFfmpeg = ffmpeg;
    currentCameraUrl = hlsUrl;

    console.log(`[streamer] Streaming: ${hlsUrl}`);
  } catch (err) {
    console.error(`[streamer] Failed to start stream:`, err.message);
  }
}

function stopStream() {
  if (currentFfmpeg && !currentFfmpeg.killed) {
    currentFfmpeg.kill('SIGTERM');
  }
  if (currentRoom) {
    try { currentRoom.disconnect(); } catch {}
  }
  currentFfmpeg = null;
  currentRoom = null;
  currentCameraUrl = null;
}

module.exports = {
  startStream,
  stopStream,
  createViewerToken,
  ROOM_NAME,
  LIVEKIT_URL,
};
