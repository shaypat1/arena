'use strict';

const express = require('express');
const { placeBet, settleRound } = require('./engine');
const { calculateOdds } = require('./pool');

const router = express.Router();

let pool = null;
let redis = null;

function init(pgPool, redisClient) {
  pool = pgPool;
  redis = redisClient;
}

// ─── POST /place ────────────────────────────────────────────
router.post('/place', async (req, res) => {
  try {
    const userId = req.user.id;
    const { round_id, chosen_outcome, amount } = req.body;

    if (!round_id) return res.status(400).json({ error: 'round_id required' });
    if (!chosen_outcome) return res.status(400).json({ error: 'chosen_outcome required' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const result = await placeBet(pool, redis, userId, round_id, chosen_outcome, parseInt(amount));

    res.json({
      bet: {
        id: result.bet.id,
        round_id: result.bet.round_id,
        chosen_outcome: result.bet.chosen_outcome,
        amount: result.bet.amount,
        odds: result.bet.odds,
        potential_payout: result.bet.potential_payout,
        bet_hash: result.bet.bet_hash,
        placed_at: result.bet.placed_at,
      },
      current_odds: result.current_odds,
      pool_state: result.pool_state,
      total_pool: result.total_pool,
    });
  } catch (err) {
    const status = err.message.includes('not open') || err.message.includes('closed')
      ? 400
      : err.message.includes('Insufficient') || err.message.includes('Invalid')
        ? 400
        : 500;
    res.status(status).json({ error: err.message });
  }
});

// ─── GET /active ────────────────────────────────────────────
router.get('/active', async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT b.*, r.status AS round_status, r.winning_outcome, r.round_number,
              bt.name AS bet_type_name, bt.slug AS bet_type_slug,
              f.name AS feed_name, f.slug AS feed_slug
       FROM bets b
       JOIN rounds r ON b.round_id = r.id
       JOIN bet_types bt ON b.bet_type_id = bt.id
       JOIN feeds f ON r.feed_id = f.id
       WHERE b.user_id = $1 AND b.status = 'active'
       ORDER BY b.placed_at DESC`,
      [userId]
    );
    res.json({ bets: rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active bets' });
  }
});

// ─── GET /history ───────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT b.*, r.round_number, r.winning_outcome,
              bt.name AS bet_type_name, bt.slug AS bet_type_slug,
              f.name AS feed_name, f.slug AS feed_slug
       FROM bets b
       JOIN rounds r ON b.round_id = r.id
       JOIN bet_types bt ON b.bet_type_id = bt.id
       JOIN feeds f ON r.feed_id = f.id
       WHERE b.user_id = $1
       ORDER BY b.placed_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM bets WHERE user_id = $1`,
      [userId]
    );

    res.json({ bets: rows, total: parseInt(countRows[0].count), page });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bet history' });
  }
});

// ─── GET /active/:feedId ─────────────────────────────────────
router.get('/active/:feedId', async (req, res) => {
  try {
    const { feedId } = req.params;
    const { rows } = await pool.query(
      `SELECT r.*, bt.name AS bet_type_name, bt.slug AS bet_type_slug,
              bt.options, bt.min_bet, bt.max_bet, bt.category,
              c.id AS cam_id, c.name AS camera_name, c.image_url AS camera_image_url,
              c.external_id AS camera_external_id, c.roi_geometry AS camera_roi_geometry
       FROM rounds r
       JOIN bet_types bt ON r.bet_type_id = bt.id
       LEFT JOIN cameras c ON r.camera_id = c.id
       WHERE r.feed_id = $1 AND r.status IN ('open', 'locked')
       ORDER BY r.created_at DESC`,
      [feedId]
    );

    const rounds = rows.map((r) => {
      const poolState = typeof r.pool_state === 'string' ? JSON.parse(r.pool_state) : r.pool_state;
      const options = typeof r.options === 'string' ? JSON.parse(r.options) : r.options;
      return {
        ...r,
        pool_state: poolState,
        options,
        odds: calculateOdds(poolState, Number(r.total_pool)),
        camera: r.cam_id ? {
          id: r.cam_id,
          name: r.camera_name,
          image_url: r.camera_image_url,
          external_id: r.camera_external_id,
          roi_geometry: r.camera_roi_geometry,
        } : null,
      };
    });

    res.json({ rounds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch active rounds' });
  }
});

// ─── GET /:id ───────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, bt.name AS bet_type_name, bt.slug AS bet_type_slug,
              bt.options, f.name AS feed_name, f.slug AS feed_slug
       FROM rounds r
       JOIN bet_types bt ON r.bet_type_id = bt.id
       JOIN feeds f ON r.feed_id = f.id
       WHERE r.id = $1`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Round not found' });

    const round = rows[0];
    const poolState = typeof round.pool_state === 'string'
      ? JSON.parse(round.pool_state) : round.pool_state;
    const options = typeof round.options === 'string'
      ? JSON.parse(round.options) : round.options;

    round.pool_state = poolState;
    round.options = options;
    round.odds = calculateOdds(poolState, Number(round.total_pool));
    if (typeof round.settlement_data === 'string') {
      try { round.settlement_data = JSON.parse(round.settlement_data); } catch {}
    }

    // Include bets if settled
    if (round.status === 'settled') {
      const { rows: bets } = await pool.query(
        `SELECT b.chosen_outcome, b.amount, b.status, b.actual_payout, b.odds,
                u.username
         FROM bets b
         JOIN users u ON b.user_id = u.id
         WHERE b.round_id = $1
         ORDER BY b.amount DESC`,
        [req.params.id]
      );
      round.bets = bets;
    }

    res.json({ round });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch round' });
  }
});

module.exports = { router, init };
