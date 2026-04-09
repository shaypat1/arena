'use strict';

const express = require('express');
const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET /:username/stats — public user stats ───────────────
router.get('/:username/stats', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT username, total_wagered, total_won, total_profit,
              win_count, loss_count, current_streak, best_streak, created_at
       FROM users
       WHERE username = $1 AND is_house = false`,
      [req.params.username]
    );

    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

module.exports = { router, init };
