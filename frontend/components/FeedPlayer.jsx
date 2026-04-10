'use client';

import { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';

// Draws live tracked-vehicle bounding boxes + a running count badge.
// `tracks` is the latest Redis broadcast from cv-counter. Always renders
// the badge so the user can tell at a glance whether the live stream is
// reaching the browser. `lastCount` is the previous round's final count
// (shown during the gap between rounds so the user can see the result).
function drawTracksOverlay(ctx, vw, vh, tracks, lastCount) {
  const list = Array.isArray(tracks?.tracks) ? tracks.tracks : [];

  // Per-track bounding boxes — much more forgiving of update lag than
  // a single centroid dot. Even if the box lags by 1-2 frames, the car
  // is almost always still within it.
  for (const t of list) {
    const hasBbox = typeof t.x1 === 'number';
    const crossedA = Array.isArray(t.crossed) && t.crossed.includes(0);
    const crossedB = Array.isArray(t.crossed) && t.crossed.includes(1);
    const counted = !!t.counted;

    // Colour ramp: grey → green (crossed A) → amber (crossed B) → red (counted)
    let stroke = 'rgba(220, 220, 220, 0.95)';
    let fill = 'rgba(220, 220, 220, 0.12)';
    if (counted) {
      stroke = 'rgba(239, 68, 68, 1)';
      fill = 'rgba(239, 68, 68, 0.22)';
    } else if (crossedA && crossedB) {
      stroke = 'rgba(248, 113, 113, 1)';
      fill = 'rgba(248, 113, 113, 0.20)';
    } else if (crossedB) {
      stroke = 'rgba(250, 204, 21, 1)';
      fill = 'rgba(250, 204, 21, 0.18)';
    } else if (crossedA) {
      stroke = 'rgba(52, 211, 153, 1)';
      fill = 'rgba(52, 211, 153, 0.18)';
    }

    if (hasBbox) {
      const bx = t.x1 * vw;
      const by = t.y1 * vh;
      const bw = (t.x2 - t.x1) * vw;
      const bh = (t.y2 - t.y1) * vh;
      ctx.fillStyle = fill;
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(2, vw / 360);
      ctx.strokeRect(bx, by, bw, bh);

      // Centroid marker inside the box
      const cxPx = t.cx * vw;
      const cyPx = t.cy * vh;
      ctx.fillStyle = stroke;
      ctx.beginPath();
      ctx.arc(cxPx, cyPx, Math.max(3, vw / 240), 0, Math.PI * 2);
      ctx.fill();

      // Track id label above the box
      const labelPx = Math.max(11, Math.round(vh / 50));
      ctx.font = `700 ${labelPx}px system-ui, -apple-system, sans-serif`;
      const label = `#${t.id}`;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(bx, by - labelPx - 4, tw, labelPx + 4);
      ctx.fillStyle = stroke;
      ctx.fillText(label, bx + 4, by - 4);
    } else {
      // Fallback: centroid-only rendering for older cv-counter payloads
      const cxPx = t.cx * vw;
      const cyPx = t.cy * vh;
      const r = Math.max(6, vw / 140);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(cxPx, cyPx, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = stroke;
      ctx.beginPath();
      ctx.arc(cxPx, cyPx, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Big running-count badge in the top-right — always drawn so the user
  // can see immediately if the live stream isn't arriving.
  //
  // Priority of what to show:
  //   1. Active counting → live count, green
  //   2. Warming up but previous round just finished → last count, amber
  //   3. Warming up first round → "—", grey
  //   4. No data at all → "WAITING FOR CV", red
  const hasData = !!tracks;
  const counting = !!tracks?.counting;
  const liveCount = tracks?.count ?? 0;

  const boxW = Math.max(210, vw / 4.5);
  const boxH = Math.max(96, vh / 5.5);
  const pad = 14;
  const bx = vw - boxW - pad;
  const by = pad;

  let bgColor, borderColor, statusLabel, mainNum, subLabel;
  if (!hasData) {
    bgColor = 'rgba(127, 29, 29, 0.88)';
    borderColor = 'rgba(248, 113, 113, 0.9)';
    statusLabel = 'WAITING FOR CV';
    mainNum = '—';
    subLabel = 'no stream from server';
  } else if (counting) {
    bgColor = 'rgba(5, 150, 105, 0.94)';
    borderColor = 'rgba(110, 231, 183, 1)';
    statusLabel = 'LIVE COUNT';
    mainNum = String(liveCount);
    subLabel = `${list.length} in view`;
  } else if (typeof lastCount === 'number') {
    bgColor = 'rgba(180, 83, 9, 0.92)';
    borderColor = 'rgba(253, 186, 116, 1)';
    statusLabel = 'LAST ROUND';
    mainNum = String(lastCount);
    subLabel = 'next round warming up';
  } else {
    bgColor = 'rgba(30, 41, 59, 0.92)';
    borderColor = 'rgba(148, 163, 184, 0.8)';
    statusLabel = 'WARMING UP';
    mainNum = '—';
    subLabel = `${list.length} in view`;
  }

  ctx.fillStyle = bgColor;
  ctx.fillRect(bx, by, boxW, boxH);
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 3;
  ctx.strokeRect(bx, by, boxW, boxH);

  const labelPx = Math.max(13, Math.round(vh / 42));
  ctx.font = `800 ${labelPx}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.fillText(statusLabel, bx + 14, by + labelPx + 6);

  const numPx = Math.max(52, Math.round(vh / 11));
  ctx.font = `900 ${numPx}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = '#fff';
  const ctTextW = ctx.measureText(mainNum).width;
  ctx.fillText(mainNum, bx + boxW - ctTextW - 18, by + boxH - 18);

  const subPx = Math.max(11, Math.round(vh / 58));
  ctx.font = `600 ${subPx}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(subLabel, bx + 14, by + boxH - 12);
}

// Draws a two-line gate overlay: line A, line B, a translucent
// quadrilateral connecting them, direction arrows, labels. Coordinates
// inside `roi` are normalized 0..1. Assumes canvas is already filled
// with the (blurred) current video frame.
function drawGateOverlay(ctx, video, vw, vh, roi) {
  const la = roi.line_a || [[0, 0], [0, 0]];
  const lb = roi.line_b || [[0, 0], [0, 0]];
  const a1 = [la[0][0] * vw, la[0][1] * vh];
  const a2 = [la[1][0] * vw, la[1][1] * vh];
  const b1 = [lb[0][0] * vw, lb[0][1] * vh];
  const b2 = [lb[1][0] * vw, lb[1][1] * vh];

  // Quadrilateral zone: reveal the sharp video inside it.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a1[0], a1[1]);
  ctx.lineTo(a2[0], a2[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.restore();

  // Zone tint for visibility
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a1[0], a1[1]);
  ctx.lineTo(a2[0], a2[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.lineTo(b1[0], b1[1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(52, 211, 153, 0.08)';
  ctx.fill();
  ctx.restore();

  // Line A — emerald
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
  ctx.lineWidth = Math.max(3, vw / 280);
  ctx.beginPath();
  ctx.moveTo(a1[0], a1[1]);
  ctx.lineTo(a2[0], a2[1]);
  ctx.stroke();

  // Line B — amber
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
  ctx.beginPath();
  ctx.moveTo(b1[0], b1[1]);
  ctx.lineTo(b2[0], b2[1]);
  ctx.stroke();

  // Direction arrow from A-midpoint toward B-midpoint (or both ways)
  const amx = (a1[0] + a2[0]) / 2;
  const amy = (a1[1] + a2[1]) / 2;
  const bmx = (b1[0] + b2[0]) / 2;
  const bmy = (b1[1] + b2[1]) / 2;
  const dir = roi.direction || 'bidirectional';
  const drawArrow = (fx, fy, tx, ty, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, vw / 400);
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    const angle = Math.atan2(ty - fy, tx - fx);
    const headLen = Math.max(10, vw / 80);
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  };
  if (dir === 'a_to_b') {
    drawArrow(amx, amy, bmx, bmy, 'rgba(255,255,255,0.9)');
  } else if (dir === 'b_to_a') {
    drawArrow(bmx, bmy, amx, amy, 'rgba(255,255,255,0.9)');
  } else {
    drawArrow(amx, amy, bmx, bmy, 'rgba(255,255,255,0.85)');
    drawArrow(bmx, bmy, amx, amy, 'rgba(255,255,255,0.85)');
  }

  // Labels
  const fontPx = Math.max(14, Math.round(vh / 36));
  ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;
  const drawLabel = (text, x, y, bg, fg) => {
    const padX = 8, padY = 4;
    const w = ctx.measureText(text).width + padX * 2;
    const h = fontPx + padY * 2;
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fg;
    ctx.fillText(text, x + padX, y + fontPx + padY - 3);
  };
  drawLabel('A', a1[0] + 6, a1[1] + 6, 'rgba(0,0,0,0.78)', 'rgba(52, 211, 153, 1)');
  drawLabel('B', b1[0] + 6, b1[1] + 6, 'rgba(0,0,0,0.78)', 'rgba(250, 204, 21, 1)');
}

export default function FeedPlayer({ streamUrl, feedName, onCameraReady, revealed, roiGeometry, cvTracks, currentRoundId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const hlsRef = useRef(null);
  const rafRef = useRef(null);
  const tracksRef = useRef(null);
  const lastCountRef = useRef(null);
  const prevCountingRef = useRef(false);
  const [loaded, setLoaded] = useState(false);

  // Keep a ref to the latest cvTracks so the RAF draw loop always sees
  // the newest data without having to re-register itself on each update.
  // We intentionally don't filter by round_id here — cv-counter only ever
  // processes one round at a time, so the latest cv_tracks is always the
  // truest thing we can show.
  //
  // Also remember the "last count": when cv-counter transitions from
  // counting=true → counting=false (round just finished), we snapshot
  // the final count so we can display it during the gap before the next
  // round starts.
  useEffect(() => {
    tracksRef.current = cvTracks || null;
    if (cvTracks) {
      const wasCounting = prevCountingRef.current;
      const isCounting = !!cvTracks.counting;
      if (wasCounting && !isCounting) {
        // Round just ended — remember the last count
        lastCountRef.current = cvTracks.count ?? 0;
      } else if (!wasCounting && isCounting) {
        // New round started counting — clear the "last" display
        lastCountRef.current = null;
      }
      prevCountingRef.current = isCounting;
    }
  }, [cvTracks]);

  // ── HLS init ─────────────────────────────────────────────────
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

  // ── Canvas selective-blur render loop ──────────────────────
  // Runs only when the frame is revealed AND we have ROI geometry.
  // Draws a blurred copy of the full frame, then overlays a sharp
  // rectangle cut from the ROI, plus a green border + label.
  useEffect(() => {
    if (!revealed || !roiGeometry || !loaded) {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (vw > 0 && vh > 0) {
        if (canvas.width !== vw || canvas.height !== vh) {
          canvas.width = vw;
          canvas.height = vh;
        }
        // Full blurred frame (ever-so-slight — the video is still recognisable
        // so players can follow along, but attention is drawn to the ROI)
        ctx.filter = 'blur(5px) brightness(0.92)';
        ctx.drawImage(video, 0, 0, vw, vh);
        ctx.filter = 'none';

        // ── Gate format (two lines) ────────────────────────────────
        if (roiGeometry.type === 'gate' || (roiGeometry.line_a && roiGeometry.line_b)) {
          drawGateOverlay(ctx, video, vw, vh, roiGeometry);
          drawTracksOverlay(ctx, vw, vh, tracksRef.current, lastCountRef.current);
          rafRef.current = requestAnimationFrame(draw);
          return;
        }

        // ── Legacy box format ──────────────────────────────────────
        // Sharp ROI crop on top — supports rotation around the box center.
        const box = roiGeometry.box || {};
        const rx = (box.x || 0) * vw;
        const ry = (box.y || 0) * vh;
        const rw = (box.w || 0) * vw;
        const rh = (box.h || 0) * vh;
        const rot = ((box.rotation || 0) * Math.PI) / 180;
        const cx = rx + rw / 2;
        const cy = ry + rh / 2;

        // Reveal a rotated rectangle by clipping in box-local coords,
        // then drawing the unrotated video into it.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.beginPath();
        ctx.rect(-rw / 2, -rh / 2, rw, rh);
        ctx.clip();
        ctx.rotate(-rot);
        ctx.translate(-cx, -cy);
        ctx.drawImage(video, 0, 0, vw, vh);
        ctx.restore();

        // Decorations (border, counting line, label) — all drawn in a
        // rotated coord space so they line up with the rotated box.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);

        ctx.strokeStyle = 'rgba(52, 211, 153, 0.95)';
        ctx.lineWidth = Math.max(2, vw / 480);
        ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);

        // Counting line (in local box coords)
        const edge = roiGeometry.count_edge || 'bottom';
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)';
        ctx.lineWidth = Math.max(3, vw / 320);
        ctx.beginPath();
        if (edge === 'bottom') { ctx.moveTo(-rw / 2, rh / 2); ctx.lineTo(rw / 2, rh / 2); }
        else if (edge === 'top') { ctx.moveTo(-rw / 2, -rh / 2); ctx.lineTo(rw / 2, -rh / 2); }
        else if (edge === 'left') { ctx.moveTo(-rw / 2, -rh / 2); ctx.lineTo(-rw / 2, rh / 2); }
        else if (edge === 'right') { ctx.moveTo(rw / 2, -rh / 2); ctx.lineTo(rw / 2, rh / 2); }
        ctx.stroke();

        // Label (upright inside the rotated box — top-left corner)
        const fontPx = Math.max(14, Math.round(vh / 36));
        ctx.font = `700 ${fontPx}px system-ui, -apple-system, sans-serif`;
        const labelText = 'COUNTING ZONE';
        const metrics = ctx.measureText(labelText);
        const padX = 8;
        const padY = 5;
        const labelW = metrics.width + padX * 2;
        const labelH = fontPx + padY * 2;
        const labelX = -rw / 2 + 6;
        const labelY = -rh / 2 + 6;
        ctx.fillStyle = 'rgba(0,0,0,0.78)';
        ctx.fillRect(labelX, labelY, labelW, labelH);
        ctx.fillStyle = 'rgba(52, 211, 153, 1)';
        ctx.fillText(labelText, labelX + padX, labelY + fontPx + padY - 3);

        ctx.restore();

        // Live tracks + running count badge (legacy box path)
        drawTracksOverlay(ctx, vw, vh, tracksRef.current, lastCountRef.current);
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      running = false;
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [revealed, roiGeometry, loaded]);

  const showCanvas = revealed && roiGeometry && loaded;

  return (
    <div ref={containerRef} className="relative w-full aspect-video bg-black rounded-xl overflow-hidden">
      {/* Video: visible only when no ROI overlay is active */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-contain"
        style={{ visibility: showCanvas ? 'hidden' : 'visible' }}
        autoPlay
        muted
        playsInline
      />

      {/* Canvas: shown when revealed + we have ROI. Mirrors object-contain. */}
      {showCanvas && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'contain' }}
        />
      )}

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
