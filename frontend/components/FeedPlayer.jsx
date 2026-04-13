'use client';

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function FeedPlayer({ streamUrl, feedName, onCameraReady, revealed, roiGeometry, currentRoundId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const hlsRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState('live'); // 'live' or 'clip'

  // During betting phase: load the live HLS stream (hidden behind cover)
  // During counting phase: switch to the pre-recorded clip
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (revealed && currentRoundId) {
      // Counting phase — try to play the pre-recorded clip
      const clipUrl = `${API_URL}/api/clips/${currentRoundId}.mp4`;

      // Destroy any HLS instance
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

      setMode('clip');
      video.src = clipUrl;
      video.load();
      video.play().catch(() => {});
      setLoaded(true);
      // Clip might not be ready yet — if it 404s, fall back to live stream
      video.onerror = () => {
        // Clip not ready, use live stream instead
        setMode('live');
        startLiveStream(video, streamUrl);
      };
    } else if (streamUrl) {
      // Betting phase — preload live stream behind the cover
      setMode('live');
      startLiveStream(video, streamUrl);
    }

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [revealed, currentRoundId, streamUrl]);

  function startLiveStream(video, url) {
    if (!url) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    let firedReady = false;
    function onFirstFrame() {
      if (firedReady) return;
      firedReady = true;
      setLoaded(true);
      if (onCameraReady) onCameraReady();
    }
    video.addEventListener('playing', onFirstFrame, { once: true });

    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, liveSyncDurationCount: 2, maxBufferLength: 10 });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setTimeout(() => hls.startLoad(), 2000); });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); });
    }
  }

  // Draw ROI gate lines on the canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !revealed) {
      if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const roi = typeof roiGeometry === 'string' ? JSON.parse(roiGeometry) : roiGeometry;
    if (!roi) return;

    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGate(ctx, canvas.width, canvas.height, roi);
  }, [revealed, roiGeometry]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
          <svg className="animate-spin h-8 w-8 text-indigo-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {!revealed && (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-purple-950 to-gray-950 z-20 flex items-center justify-center">
          <div className="text-center">
            <p className="text-3xl font-black text-white">{feedName || 'Unknown Location'}</p>
            <p className="text-2xl font-bold text-green-400 mt-2">Place Your Bets</p>
          </div>
        </div>
      )}

      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" autoPlay muted playsInline />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-[5]" />

      {revealed && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pointer-events-none z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-white/90">{feedName || 'Live'}</span>
            </div>
            <span className="text-xs text-emerald-400 font-medium">
              {mode === 'clip' ? 'RECORDED' : 'LIVE'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function drawGate(ctx, vw, vh, roi) {
  const la = roi.line_a || [[0.1, 0.6], [0.9, 0.6]];
  const lb = roi.line_b || [[0.1, 0.65], [0.9, 0.65]];
  const a1 = [la[0][0] * vw, la[0][1] * vh];
  const a2 = [la[1][0] * vw, la[1][1] * vh];
  const b1 = [lb[0][0] * vw, lb[0][1] * vh];
  const b2 = [lb[1][0] * vw, lb[1][1] * vh];

  ctx.fillStyle = 'rgba(52, 211, 153, 0.08)';
  ctx.beginPath();
  ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]);
  ctx.lineTo(b2[0], b2[1]); ctx.lineTo(b1[0], b1[1]);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a2[0], a2[1]); ctx.stroke();

  ctx.strokeStyle = 'rgba(250, 204, 21, 0.9)';
  ctx.beginPath(); ctx.moveTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.stroke();
}
