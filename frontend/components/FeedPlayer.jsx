'use client';

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';

export default function FeedPlayer({ streamUrl, feedName, onCameraReady, revealed }) {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    setLoaded(false);
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
      const hls = new Hls({
        enableWorker: true,
        liveSyncDurationCount: 2,
        liveMaxLatencyDurationCount: 5,
        maxBufferLength: 10,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setTimeout(() => hls.startLoad(), 2000);
      });
      hlsRef.current = hls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.addEventListener('loadedmetadata', () => { video.play().catch(() => {}); });
    }

    return () => {
      video.removeEventListener('playing', onFirstFrame);
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
  }, [streamUrl]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      {/* Video always loads underneath */}
      <video ref={videoRef} className="absolute inset-0 w-full h-full object-contain" autoPlay muted playsInline />

      {/* Dark cover during betting phase */}
      {!revealed && (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-purple-950 to-gray-950 z-20 flex items-center justify-center transition-opacity duration-500">
          <div className="text-center">
            <p className="text-3xl font-black text-white">{feedName || 'Unknown Location'}</p>
            <p className="text-2xl font-bold text-green-400 mt-2">Place Your Bets</p>
          </div>
        </div>
      )}

      {/* Loading spinner (only when revealed but not yet loaded) */}
      {revealed && !loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900 z-10">
          <svg className="animate-spin h-8 w-8 text-indigo-400" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}

      {/* Camera label - only when revealed */}
      {revealed && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 pointer-events-none z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              <span className="text-sm font-medium text-white/90">{feedName || 'Live'}</span>
            </div>
            <span className="text-xs text-emerald-400 font-medium">LIVE</span>
          </div>
        </div>
      )}
    </div>
  );
}
