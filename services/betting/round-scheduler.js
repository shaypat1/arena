'use strict';

/**
 * Round scheduler — automatically creates new rounds and manages round lifecycle.
 *
 * For each active bet type:
 * - When there's no open round, open one
 * - When an open round's lock time arrives, lock it
 * - Locked rounds are settled by the CV pipeline / feed simulator via Redis
 */

const { openRound, lockRound } = require('./engine');

class RoundScheduler {
  constructor(pool, redisClient) {
    this.pool = pool;
    this.redis = redisClient;
    this.running = false;
    this.interval = null;
  }

  async start() {
    this.running = true;
    console.log('[scheduler] Starting round scheduler');

    // Run immediately, then on interval
    await this._tick();
    this.interval = setInterval(() => this._tick(), 3000); // check every 3 seconds
  }

  stop() {
    this.running = false;
    if (this.interval) clearInterval(this.interval);
    console.log('[scheduler] Stopped');
  }

  async _tick() {
    if (!this.running) return;

    try {
      await this._lockExpiredRounds();
      await this._openNewRounds();
    } catch (err) {
      console.error('[scheduler] Tick error:', err.message);
    }
  }

  /**
   * Lock any open rounds whose lock time has passed.
   */
  async _lockExpiredRounds() {
    const { rows } = await this.pool.query(
      `SELECT id FROM rounds
       WHERE status = 'open' AND locks_at <= NOW()`
    );

    for (const row of rows) {
      try {
        await lockRound(this.pool, this.redis, row.id);
      } catch (err) {
        console.error(`[scheduler] Failed to lock round ${row.id}:`, err.message);
      }
    }
  }

  /**
   * For each active bet type that doesn't have an open round, create one.
   */
  async _openNewRounds() {
    // Find bet types that need a new round
    const { rows: betTypes } = await this.pool.query(
      `SELECT bt.*, f.id AS f_id, f.is_active AS feed_active
       FROM bet_types bt
       JOIN feeds f ON bt.feed_id = f.id
       WHERE bt.is_active = true AND f.is_active = true`
    );

    for (const bt of betTypes) {
      // Check if there's already an open round for this bet type
      const { rows: existing } = await this.pool.query(
        `SELECT id FROM rounds
         WHERE bet_type_id = $1 AND status = 'open'
         LIMIT 1`,
        [bt.id]
      );

      if (existing.length === 0) {
        // Also check if there's a locked round waiting for settlement
        // Don't pile up rounds faster than they can settle
        const { rows: locked } = await this.pool.query(
          `SELECT COUNT(*) AS cnt FROM rounds
           WHERE bet_type_id = $1 AND status = 'locked'`,
          [bt.id]
        );

        // Allow up to 3 locked rounds in queue
        if (parseInt(locked[0].cnt) < 3) {
          try {
            await openRound(this.pool, this.redis, bt, bt.feed_id);
          } catch (err) {
            console.error(`[scheduler] Failed to open round for ${bt.slug}:`, err.message);
          }
        }
      }
    }
  }
}

module.exports = RoundScheduler;
