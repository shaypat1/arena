'use strict';

/**
 * Admin routes for camera / ROI management.
 *
 * Provides:
 *   GET  /api/admin/cameras                 list all cameras with ROI state
 *   GET  /api/admin/cameras/:id/snapshot    fetch a single JPEG frame via ffmpeg
 *   PUT  /api/admin/cameras/:id/roi         update roi_geometry JSONB
 *
 * No auth for now — local dev only. If you deploy this, gate with authRequired.
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET /cameras ────────────────────────────────────────────
router.get('/cameras', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.external_id, c.name, c.image_url, c.source, c.timezone,
              c.is_active, c.roi_geometry, f.slug AS feed_slug, f.name AS feed_name
         FROM cameras c
         JOIN feeds f ON c.feed_id = f.id
        ORDER BY (c.roi_geometry IS NOT NULL) DESC, c.source, c.name`
    );
    res.json({ cameras: rows });
  } catch (err) {
    console.error('[admin] /cameras error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /cameras/:id ────────────────────────────────────────
router.get('/cameras/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, f.slug AS feed_slug, f.name AS feed_name
         FROM cameras c
         JOIN feeds f ON c.feed_id = f.id
        WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found' });
    res.json({ camera: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /cameras/:id/snapshot ───────────────────────────────
// Spawns ffmpeg to pull one JPEG frame from the camera's HLS URL.
// Used by the admin ROI editor to show a live reference image.
router.get('/cameras/:id/snapshot', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT image_url FROM cameras WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found' });
    const url = rows[0].image_url;

    // Find ffmpeg binary
    const ffmpegPaths = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', 'ffmpeg'];
    let ffmpegBin = null;
    for (const p of ffmpegPaths) {
      if (p === 'ffmpeg' || fs.existsSync(p)) { ffmpegBin = p; break; }
    }
    if (!ffmpegBin) return res.status(500).json({ error: 'ffmpeg not found' });

    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', url,
      '-vframes', '1',
      '-vf', 'scale=960:540',
      '-q:v', '3',
      '-f', 'image2',
      '-',
    ];

    const ff = spawn(ffmpegBin, args);
    const chunks = [];
    let stderrBuf = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    // Guard against hanging ffmpeg processes
    const killTimer = setTimeout(() => {
      try { ff.kill(); } catch {}
    }, 20000);

    ff.on('close', (code) => {
      clearTimeout(killTimer);
      if (code !== 0 || chunks.length === 0) {
        console.error('[admin] ffmpeg snapshot failed:', stderrBuf);
        return res.status(502).json({ error: 'failed to grab snapshot', detail: stderrBuf.slice(0, 500) });
      }
      const buf = Buffer.concat(chunks);
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-store');
      res.send(buf);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PUT /cameras/:id/roi ────────────────────────────────────
// Accepts two formats:
//
//   Gate format (new, preferred):
//     {
//       type: "gate",
//       line_a: [[x1,y1],[x2,y2]],
//       line_b: [[x1,y1],[x2,y2]],
//       direction: "bidirectional"|"a_to_b"|"b_to_a"
//     }
//
//   Box format (legacy):
//     {
//       box: {x, y, w, h, rotation?},
//       count_edge: "top|bottom|left|right",
//       direction: "up|down|left|right|bidirectional"
//     }
router.put('/cameras/:id/roi', async (req, res) => {
  try {
    const body = req.body || {};
    const clamp = (v) => Math.max(0, Math.min(1, v));

    let roi;
    if (body.type === 'gate' || (body.line_a && body.line_b)) {
      // ── Gate format ──
      const validateLine = (line, name) => {
        if (!Array.isArray(line) || line.length !== 2) {
          throw new Error(`invalid ${name}: expected [[x,y],[x,y]]`);
        }
        const [p1, p2] = line;
        if (!Array.isArray(p1) || p1.length !== 2 ||
            !Array.isArray(p2) || p2.length !== 2 ||
            [p1[0], p1[1], p2[0], p2[1]].some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
          throw new Error(`invalid ${name} points`);
        }
        const clean = [
          [clamp(p1[0]), clamp(p1[1])],
          [clamp(p2[0]), clamp(p2[1])],
        ];
        const dx = clean[1][0] - clean[0][0];
        const dy = clean[1][1] - clean[0][1];
        if (Math.hypot(dx, dy) < 0.02) {
          throw new Error(`${name} is too short`);
        }
        return clean;
      };
      let line_a, line_b;
      try {
        line_a = validateLine(body.line_a, 'line_a');
        line_b = validateLine(body.line_b, 'line_b');
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
      const gateDir = body.direction || 'bidirectional';
      if (!['bidirectional', 'a_to_b', 'b_to_a'].includes(gateDir)) {
        return res.status(400).json({ error: 'invalid direction (gate)' });
      }
      roi = { type: 'gate', line_a, line_b, direction: gateDir };
    } else {
      // ── Box format (legacy) ──
      const { box, count_edge, direction } = body;
      if (!box || typeof box.x !== 'number' || typeof box.y !== 'number' ||
          typeof box.w !== 'number' || typeof box.h !== 'number') {
        return res.status(400).json({ error: 'invalid box' });
      }
      let rotation = typeof box.rotation === 'number' && Number.isFinite(box.rotation)
        ? box.rotation
        : 0;
      rotation = ((rotation % 360) + 540) % 360 - 180;
      const cleanBox = {
        x: clamp(box.x),
        y: clamp(box.y),
        w: clamp(box.w),
        h: clamp(box.h),
        rotation,
      };
      if (cleanBox.x + cleanBox.w > 1) cleanBox.w = 1 - cleanBox.x;
      if (cleanBox.y + cleanBox.h > 1) cleanBox.h = 1 - cleanBox.y;
      if (cleanBox.w <= 0.01 || cleanBox.h <= 0.01) {
        return res.status(400).json({ error: 'box too small' });
      }
      const validEdges = ['top', 'bottom', 'left', 'right'];
      const validDirs = ['up', 'down', 'left', 'right', 'bidirectional'];
      if (!validEdges.includes(count_edge)) {
        return res.status(400).json({ error: 'invalid count_edge' });
      }
      if (!validDirs.includes(direction)) {
        return res.status(400).json({ error: 'invalid direction' });
      }
      roi = { box: cleanBox, count_edge, direction };
    }

    const { rows } = await pool.query(
      `UPDATE cameras SET roi_geometry = $1::jsonb
        WHERE id = $2
        RETURNING id, external_id, roi_geometry`,
      [JSON.stringify(roi), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found' });
    res.json({ camera: rows[0] });
  } catch (err) {
    console.error('[admin] /roi PUT error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /cameras/:id/roi ─────────────────────────────────
router.delete('/cameras/:id/roi', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE cameras SET roi_geometry = NULL WHERE id = $1 RETURNING id, external_id`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Camera not found' });
    res.json({ camera: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, init };
