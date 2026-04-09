'use strict';

const express = require('express');
const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET / — public settlement log ──────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (req.query.feed_id) {
      where += ` AND sl.feed_id = $${paramIdx++}`;
      params.push(req.query.feed_id);
    }
    if (req.query.bet_type) {
      where += ` AND sl.bet_type_slug = $${paramIdx++}`;
      params.push(req.query.bet_type);
    }
    if (req.query.outcome) {
      where += ` AND sl.winning_outcome = $${paramIdx++}`;
      params.push(req.query.outcome);
    }

    const { rows } = await pool.query(
      `SELECT sl.*, f.name AS feed_name, f.slug AS feed_slug
       FROM settlement_log sl
       JOIN feeds f ON sl.feed_id = f.id
       ${where}
       ORDER BY sl.settled_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM settlement_log sl ${where}`,
      params
    );

    res.json({
      settlements: rows,
      total: parseInt(countRows[0].count),
      page,
    });
  } catch (err) {
    console.error('[settlement] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settlement log' });
  }
});

// ─── GET /:roundId — detailed settlement ────────────────────
router.get('/:roundId', async (req, res) => {
  try {
    const { rows: slRows } = await pool.query(
      `SELECT sl.*, f.name AS feed_name, f.slug AS feed_slug
       FROM settlement_log sl
       JOIN feeds f ON sl.feed_id = f.id
       WHERE sl.round_id = $1`,
      [req.params.roundId]
    );

    if (!slRows.length) return res.status(404).json({ error: 'Settlement not found' });

    const settlement = slRows[0];

    // Get round details with pool breakdown
    const { rows: roundRows } = await pool.query(
      `SELECT r.pool_state, r.total_pool, r.seed_amount, r.round_number,
              bt.name AS bet_type_name, bt.slug AS bet_type_slug, bt.options
       FROM rounds r
       JOIN bet_types bt ON r.bet_type_id = bt.id
       WHERE r.id = $1`,
      [req.params.roundId]
    );

    if (roundRows.length) {
      const round = roundRows[0];
      const poolState = typeof round.pool_state === 'string'
        ? JSON.parse(round.pool_state) : round.pool_state;
      const options = typeof round.options === 'string'
        ? JSON.parse(round.options) : round.options;

      // Build pool breakdown
      const totalPool = Number(round.total_pool);
      const poolAfterRake = totalPool - Number(settlement.rake_amount);

      settlement.pool = {
        total_pool: totalPool,
        seed_amount: Number(round.seed_amount),
        rake_amount: Number(settlement.rake_amount),
        pool_after_rake: poolAfterRake,
        breakdown: {},
      };

      for (const option of options) {
        const amount = poolState[option] || 0;
        settlement.pool.breakdown[option] = {
          amount,
          implied_odds: amount > 0 ? Math.round((poolAfterRake / amount) * 100) / 100 : 0,
          is_winner: option === settlement.winning_outcome,
        };
      }

      // Bet count per outcome
      const { rows: betCounts } = await pool.query(
        `SELECT chosen_outcome, COUNT(*) AS count, SUM(amount) AS total_amount
         FROM bets WHERE round_id = $1
         GROUP BY chosen_outcome`,
        [req.params.roundId]
      );

      for (const bc of betCounts) {
        if (settlement.pool.breakdown[bc.chosen_outcome]) {
          settlement.pool.breakdown[bc.chosen_outcome].bet_count = parseInt(bc.count);
        }
      }
    }

    res.json({ settlement });
  } catch (err) {
    console.error('[settlement] GET /:roundId error:', err.message);
    res.status(500).json({ error: 'Failed to fetch settlement details' });
  }
});

module.exports = { router, init };
