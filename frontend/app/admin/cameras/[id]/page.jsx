'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Default lines for a brand-new camera (horizontal, middle of frame).
const DEFAULT_LINES = {
  a: [[0.15, 0.45], [0.85, 0.45]],
  b: [[0.15, 0.65], [0.85, 0.65]],
};

export default function AdminCameraEditPage() {
  const { id } = useParams();
  const router = useRouter();
  const { get, put } = useApi();

  const [camera, setCamera] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // Two-line gate state. Each line is [[x1,y1], [x2,y2]] in normalized 0..1 coords.
  const [lineA, setLineA] = useState(DEFAULT_LINES.a);
  const [lineB, setLineB] = useState(DEFAULT_LINES.b);
  const [direction, setDirection] = useState('bidirectional');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canvasRef = useRef(null);
  const imgRef = useRef(null);
  // Dragging state: { target: 'a1'|'a2'|'a_mid'|'b1'|'b2'|'b_mid', offset? }
  const dragRef = useRef(null);

  // ── Load camera + existing ROI ─────────────────────────────
  useEffect(() => {
    async function load() {
      try {
        const data = await get(`/api/admin/cameras/${id}`);
        setCamera(data.camera);
        const existing = data.camera?.roi_geometry;
        const roi = typeof existing === 'string' ? JSON.parse(existing) : existing;
        if (roi?.line_a && roi?.line_b) {
          setLineA(roi.line_a);
          setLineB(roi.line_b);
          if (roi.direction) setDirection(roi.direction);
        } else if (roi?.box) {
          // Legacy box — convert to a two-line gate for editing.
          // Place line A slightly above the box top, line B slightly below
          // the box bottom, both spanning the box width.
          const b = roi.box;
          setLineA([[b.x, b.y], [b.x + b.w, b.y]]);
          setLineB([[b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]);
        }
        // If no ROI at all, keep the defaults.
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, get]);

  // ── Load snapshot ──────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    setSnapshotLoading(true);
    const url = `${API_URL}/api/admin/cameras/${id}/snapshot?t=${Date.now()}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setSnapshotLoading(false);
      requestAnimationFrame(draw);
    };
    img.onerror = () => {
      setError('Failed to load camera snapshot');
      setSnapshotLoading(false);
    };
    img.src = url;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ── Redraw ─────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(img, 0, 0, W, H);

    // Dim the whole frame slightly so lines stand out
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, W, H);

    const a1 = [lineA[0][0] * W, lineA[0][1] * H];
    const a2 = [lineA[1][0] * W, lineA[1][1] * H];
    const b1 = [lineB[0][0] * W, lineB[0][1] * H];
    const b2 = [lineB[1][0] * W, lineB[1][1] * H];

    // Reveal the quadrilateral between the two lines
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a1[0], a1[1]);
    ctx.lineTo(a2[0], a2[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, W, H);
    ctx.restore();

    // Zone tint
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a1[0], a1[1]);
    ctx.lineTo(a2[0], a2[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.lineTo(b1[0], b1[1]);
    ctx.closePath();
    ctx.fillStyle = 'rgba(52, 211, 153, 0.10)';
    ctx.fill();
    ctx.restore();

    // Line A — emerald
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a1[0], a1[1]);
    ctx.lineTo(a2[0], a2[1]);
    ctx.stroke();

    // Line B — amber
    ctx.strokeStyle = '#facc15';
    ctx.beginPath();
    ctx.moveTo(b1[0], b1[1]);
    ctx.lineTo(b2[0], b2[1]);
    ctx.stroke();

    // Direction arrow
    const amx = (a1[0] + a2[0]) / 2;
    const amy = (a1[1] + a2[1]) / 2;
    const bmx = (b1[0] + b2[0]) / 2;
    const bmy = (b1[1] + b2[1]) / 2;
    const drawArrow = (fx, fy, tx, ty) => {
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const angle = Math.atan2(ty - fy, tx - fx);
      const head = 14;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - head * Math.cos(angle - Math.PI / 6), ty - head * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - head * Math.cos(angle + Math.PI / 6), ty - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    };
    if (direction === 'a_to_b') {
      drawArrow(amx, amy, bmx, bmy);
    } else if (direction === 'b_to_a') {
      drawArrow(bmx, bmy, amx, amy);
    } else {
      drawArrow(amx, amy, bmx, bmy);
      drawArrow(bmx, bmy, amx, amy);
    }

    // Endpoint handles
    const drawHandle = (x, y, color) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    drawHandle(a1[0], a1[1], '#34d399');
    drawHandle(a2[0], a2[1], '#34d399');
    drawHandle(b1[0], b1[1], '#facc15');
    drawHandle(b2[0], b2[1], '#facc15');

    // Midpoint "move whole line" handles (hollow)
    const drawMidHandle = (x, y, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    };
    drawMidHandle(amx, amy, '#34d399');
    drawMidHandle(bmx, bmy, '#facc15');

    // Labels
    ctx.font = 'bold 18px system-ui, sans-serif';
    const drawLabel = (text, x, y, bg, fg) => {
      const padX = 8, padY = 4;
      const w = ctx.measureText(text).width + padX * 2;
      const h = 18 + padY * 2;
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = fg;
      ctx.fillText(text, x + padX, y + 18 + padY - 3);
    };
    drawLabel('A', a1[0] + 12, a1[1] + 12, 'rgba(0,0,0,0.8)', '#34d399');
    drawLabel('B', b1[0] + 12, b1[1] + 12, 'rgba(0,0,0,0.8)', '#facc15');
  }, [lineA, lineB, direction]);

  useEffect(() => { draw(); }, [draw]);

  // ── Mouse interaction ──────────────────────────────────────
  const clientToNormalized = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  // In pixels, how close is close enough to grab a handle?
  const HIT_RADIUS_PX = 18;

  const hitTest = (x, y) => {
    // Returns an identifier of what was hit, or null
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const W = canvas.width, H = canvas.height;
    const hr = HIT_RADIUS_PX;
    // Convert back to pixel distance check
    const dist = (p1, p2) => Math.hypot((p1[0] - p2[0]) * W, (p1[1] - p2[1]) * H);

    const candidates = [
      { name: 'a1', pos: lineA[0] },
      { name: 'a2', pos: lineA[1] },
      { name: 'b1', pos: lineB[0] },
      { name: 'b2', pos: lineB[1] },
      { name: 'a_mid', pos: [(lineA[0][0] + lineA[1][0]) / 2, (lineA[0][1] + lineA[1][1]) / 2] },
      { name: 'b_mid', pos: [(lineB[0][0] + lineB[1][0]) / 2, (lineB[0][1] + lineB[1][1]) / 2] },
    ];
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const d = dist([x, y], c.pos);
      if (d < hr && d < bestDist) {
        best = c.name;
        bestDist = d;
      }
    }
    return best;
  };

  const onMouseDown = (e) => {
    const { x, y } = clientToNormalized(e);
    const target = hitTest(x, y);
    if (!target) return;
    dragRef.current = {
      target,
      startX: x,
      startY: y,
      initA: [[...lineA[0]], [...lineA[1]]],
      initB: [[...lineB[0]], [...lineB[1]]],
    };
  };

  const onMouseMove = (e) => {
    if (!dragRef.current) return;
    const { x, y } = clientToNormalized(e);
    const d = dragRef.current;
    const dx = x - d.startX;
    const dy = y - d.startY;

    if (d.target === 'a1') {
      setLineA([[x, y], d.initA[1]]);
    } else if (d.target === 'a2') {
      setLineA([d.initA[0], [x, y]]);
    } else if (d.target === 'b1') {
      setLineB([[x, y], d.initB[1]]);
    } else if (d.target === 'b2') {
      setLineB([d.initB[0], [x, y]]);
    } else if (d.target === 'a_mid') {
      setLineA([
        [d.initA[0][0] + dx, d.initA[0][1] + dy],
        [d.initA[1][0] + dx, d.initA[1][1] + dy],
      ]);
    } else if (d.target === 'b_mid') {
      setLineB([
        [d.initB[0][0] + dx, d.initB[0][1] + dy],
        [d.initB[1][0] + dx, d.initB[1][1] + dy],
      ]);
    }
  };

  const onMouseUp = () => { dragRef.current = null; };

  const refreshSnapshot = () => {
    if (!id) return;
    setSnapshotLoading(true);
    const url = `${API_URL}/api/admin/cameras/${id}/snapshot?t=${Date.now()}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { imgRef.current = img; setSnapshotLoading(false); draw(); };
    img.src = url;
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const round4 = (v) => Number(v.toFixed(4));
      await put(`/api/admin/cameras/${id}/roi`, {
        type: 'gate',
        line_a: [
          [round4(lineA[0][0]), round4(lineA[0][1])],
          [round4(lineA[1][0]), round4(lineA[1][1])],
        ],
        line_b: [
          [round4(lineB[0][0]), round4(lineB[0][1])],
          [round4(lineB[1][0]), round4(lineB[1][1])],
        ],
        direction,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!confirm('Clear ROI for this camera?')) return;
    try {
      await fetch(`${API_URL}/api/admin/cameras/${id}/roi`, { method: 'DELETE' });
      router.push('/admin/cameras');
    } catch (err) {
      setError(err.message);
    }
  };

  const resetLines = () => {
    setLineA(DEFAULT_LINES.a);
    setLineB(DEFAULT_LINES.b);
  };

  if (loading) return <div className="max-w-5xl mx-auto p-8 text-gray-500">Loading…</div>;
  if (error && !camera) return <div className="max-w-5xl mx-auto p-8 text-red-400">{error}</div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link href="/admin/cameras" className="text-sm text-gray-400 hover:text-white mb-2 inline-block">← All cameras</Link>
          <h1 className="text-2xl font-bold text-white">{camera?.name}</h1>
          <p className="text-xs text-gray-500 font-mono">{camera?.external_id}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Canvas */}
        <div className="lg:col-span-3">
          <div className="relative rounded-xl overflow-hidden bg-black border border-gray-800">
            {snapshotLoading ? (
              <div className="aspect-video flex items-center justify-center text-gray-500">
                Loading snapshot…
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className="w-full h-auto cursor-crosshair"
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <button onClick={refreshSnapshot} className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-white">
              ↻ Refresh snapshot
            </button>
            <button onClick={resetLines} className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 text-white">
              Reset lines
            </button>
            <span>
              Drag filled circles to move endpoints · drag hollow midpoints to slide entire lines
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="space-y-4">
          <Field
            label="Gate direction"
            help="A car must cross BOTH lines to count. If directional, order is enforced."
          >
            <div className="space-y-2">
              {[
                { key: 'bidirectional', label: 'Bidirectional (either order)' },
                { key: 'a_to_b', label: 'A → B (enters A, exits B)' },
                { key: 'b_to_a', label: 'B → A (enters B, exits A)' },
              ].map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setDirection(key)}
                  className={`w-full py-2 rounded-lg text-sm font-bold transition-all text-left px-3 ${
                    direction === key
                      ? 'bg-indigo-500 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Line A">
            <div className="text-xs text-emerald-400 font-mono space-y-0.5">
              <div>p1: ({lineA[0][0].toFixed(3)}, {lineA[0][1].toFixed(3)})</div>
              <div>p2: ({lineA[1][0].toFixed(3)}, {lineA[1][1].toFixed(3)})</div>
            </div>
          </Field>
          <Field label="Line B">
            <div className="text-xs text-yellow-400 font-mono space-y-0.5">
              <div>p1: ({lineB[0][0].toFixed(3)}, {lineB[0][1].toFixed(3)})</div>
              <div>p2: ({lineB[1][0].toFixed(3)}, {lineB[1][1].toFixed(3)})</div>
            </div>
          </Field>

          <button
            onClick={save}
            disabled={saving}
            className="w-full py-3 rounded-lg font-bold bg-emerald-500 hover:bg-emerald-400 text-black disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed transition-all"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save gate'}
          </button>

          {camera?.roi_geometry && (
            <button
              onClick={clear}
              className="w-full py-2 rounded-lg text-sm bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20"
            >
              Clear ROI
            </button>
          )}

          {error && <div className="text-sm text-red-400">{error}</div>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, children }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-gray-500 mb-1">{label}</label>
      {children}
      {help && <p className="text-xs text-gray-600 mt-1">{help}</p>}
    </div>
  );
}
