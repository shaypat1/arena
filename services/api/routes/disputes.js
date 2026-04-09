'use strict';

const express = require('express');
const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET / — list disputes ──────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT d.id, d.round_id, d.reason, d.status, d.created_at, d.resolved_at,
              u.username, r.round_number
       FROM disputes d
       JOIN users u ON d.user_id = u.id
       JOIN rounds r ON d.round_id = r.id
       ORDER BY d.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    res.json({ disputes: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

// ─── POST /create ───────────────────────────────────────────
router.post('/create', async (req, res) => {
  try {
    const userId = req.user.id;
    const { round_id, reason } = req.body;

    if (!round_id) return res.status(400).json({ error: 'round_id required' });
    if (!reason || reason.length < 10) {
      return res.status(400).json({ error: 'Please provide a detailed reason (min 10 chars)' });
    }

    // Verify the round exists and is settled
    const { rows: roundRows } = await pool.query(
      `SELECT id, status FROM rounds WHERE id = $1`,
      [round_id]
    );
    if (!roundRows.length) return res.status(404).json({ error: 'Round not found' });
    if (roundRows[0].status !== 'settled') {
      return res.status(400).json({ error: 'Can only dispute settled rounds' });
    }

    // Check for duplicate dispute
    const { rows: existing } = await pool.query(
      `SELECT id FROM disputes WHERE round_id = $1 AND user_id = $2`,
      [round_id, userId]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'You already disputed this round' });
    }

    const { rows } = await pool.query(
      `INSERT INTO disputes (round_id, user_id, reason)
       VALUES ($1, $2, $3)
       RETURNING id, status, created_at`,
      [round_id, userId, reason.slice(0, 2000)]
    );

    res.status(201).json({ dispute: rows[0] });
  } catch (err) {
    console.error('[disputes] POST /create error:', err.message);
    res.status(500).json({ error: 'Failed to create dispute' });
  }
});

module.exports = { router, init };
