'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STREAMS = {
  cv_restream: `${API}/api/stream/stream.m3u8`,
  nyc_bqe_raw: 'https://s53.nysdot.skyvdn.com:443/rtplive/R11_082/playlist.m3u8',
  california_raw: 'https://wzmedia.dot.ca.gov/D7/CCTV-340.stream/playlist.m3u8',
  iowa_4k_raw: 'https://iowadotsfs1.us-east-1.skyvdn.com:443/rtplive/wwdtv08lb/playlist.m3u8',
};

export default function TestStreamPage() {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [active, setActive] = useState('cv_restream');
  const [status, setStatus] = useState('loading...');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const url = STREAMS[active];
    setStatus('connecting...');

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 6,        // stay 6 segments behind live edge
        liveMaxLatencyDurationCount: 12,  // allow up to 12 segments of latency before catching up
        maxBufferLength: 60,              // buffer up to 60s ahead
        maxMaxBufferLength: 120,
        highBufferWatchdogPeriod: 10,     // wait 10s before declaring stall
        enableWorker: true,
      });
      // Auto-recover from stalls
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.details === 'bufferStalledError') {
          hls.startLoad();
        }
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        setStatus('playing');
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setStatus('playing');
      });
      hls.on(Hls.Events.ERROR, (_, d) => {
        if (d.fatal) {
          setStatus('fatal error — recovering...');
          setTimeout(() => hls.startLoad(), 1000);
        }
      });
      hlsRef.current = hls;
    }

    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [active]);

  return (
    <div style={{ background: '#000', minHeight: '100vh', padding: 20 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
        {Object.keys(STREAMS).map(k => (
          <button key={k} onClick={() => setActive(k)}
            style={{
              padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: active === k ? '#4f46e5' : '#333', color: '#fff', fontWeight: 'bold',
            }}>
            {k}
          </button>
        ))}
      </div>
      <p style={{ color: '#888', fontSize: 14, marginBottom: 10 }}>{active} — {status}</p>
      <video ref={videoRef} style={{ width: '100%', maxWidth: 960 }} autoPlay muted playsInline />
    </div>
  );
}
