'use strict';

const express = require('express');
const { calculateOdds } = require('../../betting/pool');

const router = express.Router();
let pool = null;

function init(pgPool) {
  pool = pgPool;
}

// ─── GET / — list active feeds ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, slug, description, stream_url, thumbnail_url, category,
              timezone, is_premium, viewer_count
       FROM feeds WHERE is_active = true
       ORDER BY viewer_count DESC`
    );

    // Attach active bet types per feed
    for (const feed of rows) {
      const { rows: btRows } = await pool.query(
        `SELECT id, name, slug FROM bet_types WHERE feed_id = $1 AND is_active = true`,
        [feed.id]
      );
      feed.bet_types = btRows;
      feed.active_bet_types = btRows.length;
    }

    res.json({ feeds: rows });
  } catch (err) {
    console.error('[feeds] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feeds' });
  }
});

// ─── GET /:slug — feed detail ───────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const { rows: feedRows } = await pool.query(
      `SELECT * FROM feeds WHERE slug = $1 AND is_active = true`,
      [req.params.slug]
    );

    if (!feedRows.length) return res.status(404).json({ error: 'Feed not found' });
    const feed = feedRows[0];

    // Get bet types
    const { rows: betTypes } = await pool.query(
      `SELECT * FROM bet_types WHERE feed_id = $1 AND is_active = true`,
      [feed.id]
    );

    // Get active rounds with odds
    const { rows: rounds } = await pool.query(
      `SELECT r.*, bt.slug AS bet_type_slug, bt.name AS bet_type_name, bt.options, bt.min_bet, bt.max_bet
       FROM rounds r
       JOIN bet_types bt ON r.bet_type_id = bt.id
       WHERE r.feed_id = $1 AND r.status IN ('open', 'locked')
       ORDER BY r.created_at DESC`,
      [feed.id]
    );

    const activeRounds = rounds.map((r) => {
      const poolState = typeof r.pool_state === 'string' ? JSON.parse(r.pool_state) : r.pool_state;
      const options = typeof r.options === 'string' ? JSON.parse(r.options) : r.options;
      return {
        ...r,
        pool_state: poolState,
        options,
        odds: calculateOdds(poolState, Number(r.total_pool)),
      };
    });

    res.json({
      feed,
      bet_types: betTypes.map((bt) => ({
        ...bt,
        options: typeof bt.options === 'string' ? JSON.parse(bt.options) : bt.options,
        seed_distribution: typeof bt.seed_distribution === 'string'
          ? JSON.parse(bt.seed_distribution) : bt.seed_distribution,
      })),
      active_rounds: activeRounds,
    });
  } catch (err) {
    console.error('[feeds] GET /:slug error:', err.message);
    res.status(500).json({ error: 'Failed to fetch feed' });
  }
});

// ─── GET /:slug/stats — feed statistics ─────────────────────
router.get('/:slug/stats', async (req, res) => {
  try {
    const { rows: feedRows } = await pool.query(
      `SELECT id FROM feeds WHERE slug = $1`,
      [req.params.slug]
    );
    if (!feedRows.length) return res.status(404).json({ error: 'Feed not found' });

    const feedId = feedRows[0].id;

    const { rows: stats } = await pool.query(
      `SELECT
        COUNT(*) AS total_rounds,
        COUNT(*) FILTER (WHERE status = 'settled') AS settled_rounds,
        COALESCE(SUM(total_pool) FILTER (WHERE status = 'settled'), 0) AS total_volume,
        COALESCE(SUM(rake_amount) FILTER (WHERE status = 'settled'), 0) AS total_rake
       FROM rounds WHERE feed_id = $1`,
      [feedId]
    );

    // Recent outcomes for car color
    const { rows: recentOutcomes } = await pool.query(
      `SELECT winning_outcome, COUNT(*) AS count
       FROM rounds
       WHERE feed_id = $1 AND status = 'settled' AND winning_outcome IS NOT NULL
       GROUP BY winning_outcome
       ORDER BY count DESC
       LIMIT 10`,
      [feedId]
    );

    res.json({
      stats: stats[0],
      recent_outcomes: recentOutcomes,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = { router, init };
