'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STREAMS = {
  'NYC BQE': `${API}/api/stream/nyc/stream.m3u8`,
  'NYC Bronx': `${API}/api/stream/nyc_bronx/stream.m3u8`,
  'NYC LIE': `${API}/api/stream/nyc_lie/stream.m3u8`,
  'NYC GCP': `${API}/api/stream/nyc_gcp/stream.m3u8`,
  'Rochester': `${API}/api/stream/rochester/stream.m3u8`,
  'CA I-405': `${API}/api/stream/cali/stream.m3u8`,
  'CA Emeryville': `${API}/api/stream/ca_emeryville/stream.m3u8`,
  'Iowa 4K': `${API}/api/stream/iowa/stream.m3u8`,
  'Iowa Dubuque': `${API}/api/stream/iowa_dubuque/stream.m3u8`,
  'SC Bridge': `${API}/api/stream/sc_bridge/stream.m3u8`,
  'SC I-85': `${API}/api/stream/sc_i85/stream.m3u8`,
  'Rome': `${API}/api/stream/rome/stream.m3u8`,
};

export default function TestStreamPage() {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [active, setActive] = useState('NYC BQE');
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
