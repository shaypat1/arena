'use strict';

const express = require('express');
const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET / — global leaderboard ─────────────────────────────
router.get('/', async (req, res) => {
  try {
    const sortBy = req.query.sort || 'profit';
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));

    const sortMap = {
      profit: 'total_profit DESC',
      wagered: 'total_wagered DESC',
      wins: 'win_count DESC',
      streak: 'best_streak DESC',
    };
    const orderBy = sortMap[sortBy] || sortMap.profit;

    const { rows } = await pool.query(
      `SELECT username, total_wagered, total_won, total_profit,
              win_count, loss_count, current_streak, best_streak
       FROM users
       WHERE is_house = false AND is_banned = false
         AND (total_wagered > 0 OR win_count > 0)
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit]
    );

    res.json({
      leaderboard: rows.map((u, i) => ({ rank: i + 1, ...u })),
      sort_by: sortBy,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

module.exports = { router, init };
