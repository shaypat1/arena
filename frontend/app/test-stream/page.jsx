'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const STREAMS = {
  // US
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
  // Europe
  'Rome': `${API}/api/stream/rome/stream.m3u8`,
  'Italy Anzio': `${API}/api/stream/italy_anzio/stream.m3u8`,
  'Iceland': `${API}/api/stream/iceland/stream.m3u8`,
  // Russia
  'Astrakhan': `${API}/api/stream/astrakhan/stream.m3u8`,
};

export default function TestStreamPage() {
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const [active, setActive] = useState('NYC BQE');
  const [status, setStatus] = useState('loading...');
  const [logs, setLogs] = useState([]);
  const [lastSeq, setLastSeq] = useState(null);
  const logsEndRef = useRef(null);

  // HLS player
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

    const url = STREAMS[active];
    setStatus('connecting...');
    setLogs([]);
    setLastSeq(null);

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDurationCount: 4,
        liveMaxLatencyDurationCount: 8,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        enableWorker: true,
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setStatus('fatal error — recovering...');
          setTimeout(() => hls.startLoad(), 1000);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
        setStatus('playing');
      });
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setStatus('playing');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hlsRef.current = hls;
    }

    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [active]);

  // Segment poller — checks the m3u8 every 2s for the active stream
  useEffect(() => {
    const url = STREAMS[active];
    if (!url) return;

    let prevSegments = null;
    let prevTime = Date.now();

    function addLog(msg) {
      const now = new Date();
      const ts = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLogs(prev => [...prev.slice(-50), { ts, msg }]);
    }

    async function poll() {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          addLog(`HTTP ${res.status}`);
          return;
        }
        const text = await res.text();
        const lines = text.split('\n');

        // Get sequence number
        let seq = null;
        const segments = [];
        for (const line of lines) {
          if (line.includes('EXT-X-MEDIA-SEQUENCE')) {
            seq = parseInt(line.split(':')[1]);
          }
          if (line.trim().endsWith('.ts')) {
            segments.push(line.trim());
          }
        }

        const newest = segments[segments.length - 1] || '?';
        const segCount = segments.length;

        if (prevSegments === null) {
          addLog(`Connected — seq=${seq} segs=${segCount} latest=${newest}`);
        } else if (JSON.stringify(segments) !== JSON.stringify(prevSegments)) {
          const elapsed = ((Date.now() - prevTime) / 1000).toFixed(1);
          const newSegs = segments.filter(s => !prevSegments.includes(s));
          addLog(`+${newSegs.length} new seg${newSegs.length !== 1 ? 's' : ''} after ${elapsed}s — seq=${seq} latest=${newest}`);
          prevTime = Date.now();
        } else {
          // No change
          const stale = ((Date.now() - prevTime) / 1000).toFixed(0);
          if (parseInt(stale) > 5) {
            addLog(`No new segments for ${stale}s — stale?`);
          }
        }

        prevSegments = segments;
        setLastSeq(seq);
      } catch (err) {
        addLog(`Poll error: ${err.message}`);
      }
    }

    poll();
    const iv = setInterval(poll, 2000);
    return () => clearInterval(iv);
  }, [active]);

  // Auto-scroll logs
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div style={{ background: '#000', minHeight: '100vh', display: 'flex' }}>
      {/* Video + Logs */}
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column' }}>
        <p style={{ color: '#888', fontSize: 14, marginBottom: 10 }}>{active} — {status} {lastSeq !== null && `(seq: ${lastSeq})`}</p>
        <div style={{ display: 'flex', gap: 15, flex: 1 }}>
          {/* Video */}
          <div style={{ flex: 1 }}>
            <video ref={videoRef} style={{ width: '100%', maxWidth: 720 }} autoPlay muted playsInline />
          </div>
          {/* Logs */}
          <div style={{
            width: 350, background: '#111', borderRadius: 8, border: '1px solid #333',
            padding: 10, overflowY: 'auto', maxHeight: 500, fontFamily: 'monospace', fontSize: 11,
          }}>
            <div style={{ color: '#666', marginBottom: 8, fontSize: 12, fontWeight: 'bold' }}>
              Segment Log — {active}
            </div>
            {logs.length === 0 && <div style={{ color: '#444' }}>Polling...</div>}
            {logs.map((l, i) => (
              <div key={i} style={{
                color: l.msg.includes('stale') ? '#f59e0b' : l.msg.includes('error') || l.msg.includes('HTTP') ? '#ef4444' : '#6ee7b7',
                marginBottom: 3, lineHeight: 1.4, wordBreak: 'break-all',
              }}>
                <span style={{ color: '#555' }}>{l.ts}</span> {l.msg}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
      {/* Sidebar */}
      <div style={{
        width: 180, borderLeft: '1px solid #333', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 4, padding: 10,
      }}>
        {Object.keys(STREAMS).map(k => (
          <button key={k} onClick={() => setActive(k)}
            style={{
              padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, textAlign: 'left', whiteSpace: 'nowrap',
              background: active === k ? '#4f46e5' : '#222', color: '#fff', fontWeight: active === k ? 'bold' : 'normal',
            }}>
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}
