'use strict';

/**
 * Core betting engine — round lifecycle, bet placement, settlement.
 *
 * Round lifecycle: open → locked → settled | cancelled
 * Settlement model: seeded parimutuel with 5% rake.
 */

const { generateBetHash } = require('./bet-hasher');
const { calculateOdds, calculatePayout, calculateRake } = require('./pool');
const { placeHouseSeedBets, HOUSE_USER_ID } = require('./seeder');
const { lockFunds, settleBet, unlockFunds } = require('../wallet/balance');

/**
 * Open a new round for a given bet type.
 * Creates the round record and places house seed bets atomically.
 */
async function openRound(pool, redisClient, betType, feedId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get next round number for this bet type
    const { rows: seqRows } = await client.query(
      `SELECT COALESCE(MAX(round_number), 0) + 1 AS next_num
       FROM rounds WHERE bet_type_id = $1`,
      [betType.id]
    );
    const roundNumber = seqRows[0].next_num;

    const now = new Date();
    const locksAt = new Date(now.getTime() + betType.round_duration_seconds * 1000);

    // Pick a random camera where it's currently daytime (6am-8pm local time)
    // Falls back to any active camera if none are in daytime.
    let { rows: camRows } = await client.query(
      `SELECT id, external_id, name, image_url, roi_geometry FROM cameras
       WHERE feed_id = $1 AND is_active = true
         AND timezone IS NOT NULL
         AND EXTRACT(HOUR FROM NOW() AT TIME ZONE timezone) BETWEEN 6 AND 19
       ORDER BY RANDOM() LIMIT 1`,
      [feedId]
    );
    if (camRows.length === 0) {
      ({ rows: camRows } = await client.query(
        `SELECT id, external_id, name, image_url, roi_geometry FROM cameras
         WHERE feed_id = $1 AND is_active = true
         ORDER BY RANDOM() LIMIT 1`,
        [feedId]
      ));
    }
    const camera = camRows.length > 0 ? camRows[0] : null;

    // Create round
    const { rows: roundRows } = await client.query(
      `INSERT INTO rounds (feed_id, bet_type_id, round_number, status, opens_at, locks_at, total_pool, pool_state, seed_amount, camera_id)
       VALUES ($1, $2, $3, 'open', $4, $5, 0, '{}', 0, $6)
       RETURNING *`,
      [feedId, betType.id, roundNumber, now, locksAt, camera?.id || null]
    );
    const round = roundRows[0];
    round.camera = camera;

    // Place house seed bets
    const { poolState, totalSeeded } = await placeHouseSeedBets(client, round, betType);

    // Update round with seed state
    await client.query(
      `UPDATE rounds SET total_pool = $1, pool_state = $2, seed_amount = $3
       WHERE id = $4`,
      [totalSeeded, JSON.stringify(poolState), totalSeeded, round.id]
    );

    await client.query('COMMIT');

    round.total_pool = totalSeeded;
    round.pool_state = poolState;
    round.seed_amount = totalSeeded;

    // Calculate initial odds and publish
    const odds = calculateOdds(poolState, totalSeeded);

    if (redisClient) {
      await redisClient.publish(
        'round_state',
        JSON.stringify({
          event: 'round:opened',
          round_id: round.id,
          feed_id: feedId,
          bet_type_id: betType.id,
          bet_type_slug: betType.slug,
          bet_type_name: betType.name,
          round_number: roundNumber,
          opens_at: now.toISOString(),
          locks_at: locksAt.toISOString(),
          pool_state: poolState,
          total_pool: totalSeeded,
          odds,
          options: betType.options,
          camera: camera ? { id: camera.id, name: camera.name, image_url: camera.image_url, roi_geometry: camera.roi_geometry } : null,
        })
      );
    }

    console.log(
      `[engine] Round #${roundNumber} opened for ${betType.slug} on feed ${feedId} (seed: ${totalSeeded})`
    );

    return round;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Lock a round — no more bets accepted.
 */
async function lockRound(pool, redisClient, roundId) {
  const { rows } = await pool.query(
    `UPDATE rounds SET status = 'locked'
     WHERE id = $1 AND status = 'open'
     RETURNING *`,
    [roundId]
  );

  if (!rows.length) return null;
  const round = rows[0];

  if (redisClient) {
    await redisClient.publish(
      'round_state',
      JSON.stringify({
        event: 'round:locked',
        round_id: round.id,
        feed_id: round.feed_id,
        message: 'No more bets',
      })
    );
  }

  console.log(`[engine] Round ${roundId} locked`);
  return round;
}

/**
 * Place a bet on an open round.
 */
async function placeBet(pool, redisClient, userId, roundId, chosenOutcome, amount) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the round row to get consistent state
    const { rows: roundRows } = await client.query(
      `SELECT r.*, bt.min_bet, bt.max_bet, bt.options
       FROM rounds r
       JOIN bet_types bt ON r.bet_type_id = bt.id
       WHERE r.id = $1
       FOR UPDATE`,
      [roundId]
    );

    if (!roundRows.length) {
      throw new Error('Round not found');
    }
    const round = roundRows[0];

    if (round.status !== 'open') {
      throw new Error('Round is not open for betting');
    }

    // Check round hasn't expired
    if (new Date() >= new Date(round.locks_at)) {
      throw new Error('Round betting window has closed');
    }

    // Validate outcome
    const options = typeof round.options === 'string' ? JSON.parse(round.options) : round.options;
    if (!options.includes(chosenOutcome)) {
      throw new Error(`Invalid outcome: ${chosenOutcome}. Valid: ${options.join(', ')}`);
    }

    // Validate amount
    if (amount < Number(round.min_bet)) {
      throw new Error(`Minimum bet is ${round.min_bet}`);
    }
    if (amount > Number(round.max_bet)) {
      throw new Error(`Maximum bet is ${round.max_bet}`);
    }

    // Lock user funds
    const { rows: balRows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (!balRows.length || Number(balRows[0].available) < amount) {
      throw new Error('Insufficient balance');
    }

    await client.query(
      `UPDATE balances SET available = available - $1, locked = locked + $1
       WHERE user_id = $2 AND currency = 'USD'`,
      [amount, userId]
    );

    // Update pool state
    const poolState = typeof round.pool_state === 'string'
      ? JSON.parse(round.pool_state)
      : round.pool_state;
    poolState[chosenOutcome] = (poolState[chosenOutcome] || 0) + amount;
    const newTotalPool = Number(round.total_pool) + amount;

    await client.query(
      `UPDATE rounds SET total_pool = $1, pool_state = $2
       WHERE id = $3`,
      [newTotalPool, JSON.stringify(poolState), roundId]
    );

    // Calculate current implied odds
    const odds = calculateOdds(poolState, newTotalPool);
    const currentOdds = odds[chosenOutcome] || 0;
    const potentialPayout = Math.floor(amount * currentOdds);

    // Generate bet hash
    const now = new Date().toISOString();
    const betHash = generateBetHash(userId, roundId, chosenOutcome, amount, now);

    // Insert bet record
    const { rows: betRows } = await client.query(
      `INSERT INTO bets (user_id, round_id, bet_type_id, chosen_outcome, amount, odds, potential_payout, bet_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, roundId, round.bet_type_id, chosenOutcome, amount, currentOdds, potentialPayout, betHash]
    );

    // Update user stats
    await client.query(
      `UPDATE users SET total_wagered = total_wagered + $1 WHERE id = $2`,
      [amount, userId]
    );

    await client.query('COMMIT');

    const bet = betRows[0];

    // Publish events
    if (redisClient) {
      // Public bet placed event
      const { rows: userRows } = await pool.query(
        `SELECT username FROM users WHERE id = $1`,
        [userId]
      );

      await redisClient.publish(
        'bet_placed',
        JSON.stringify({
          round_id: roundId,
          feed_id: round.feed_id,
          outcome: chosenOutcome,
          amount,
          username: userRows[0]?.username || 'anonymous',
          odds: currentOdds,
        })
      );

      // Updated odds for all outcomes
      await redisClient.publish(
        'odds_update',
        JSON.stringify({
          round_id: roundId,
          feed_id: round.feed_id,
          odds,
          pool_state: poolState,
          total_pool: newTotalPool,
        })
      );

      // Private balance update
      await redisClient.publish(
        'balance_update',
        JSON.stringify({ user_id: userId, type: 'bet_placed' })
      );
    }

    return {
      bet,
      current_odds: odds,
      pool_state: poolState,
      total_pool: newTotalPool,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Settle a round with the winning outcome from the CV pipeline.
 * Distributes payouts proportionally to winners and takes 5% rake.
 *
 * IDEMPOTENT: if the round is already settled, this is a no-op.
 */
async function settleRound(pool, redisClient, settlementEvent) {
  const {
    round_id,
    feed_id,
    bet_type_slug,
    outcome: winningOutcome,
    confidence,
    detection_data,
    frame_url,
    timestamp,
  } = settlementEvent;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock round row — idempotency check
    const { rows: roundRows } = await client.query(
      `SELECT * FROM rounds WHERE id = $1 FOR UPDATE`,
      [round_id]
    );

    if (!roundRows.length) {
      await client.query('ROLLBACK');
      console.warn(`[engine] Settlement: round ${round_id} not found`);
      return null;
    }

    const round = roundRows[0];

    if (round.status === 'settled') {
      await client.query('ROLLBACK');
      console.log(`[engine] Round ${round_id} already settled — skipping`);
      return null;
    }

    if (round.status !== 'locked') {
      await client.query('ROLLBACK');
      console.warn(`[engine] Cannot settle round ${round_id} in status ${round.status}`);
      return null;
    }

    const totalPool = Number(round.total_pool);
    const poolState = typeof round.pool_state === 'string'
      ? JSON.parse(round.pool_state)
      : round.pool_state;

    const rakeAmount = calculateRake(totalPool);
    const poolAfterRake = totalPool - rakeAmount;
    const totalOnWinner = poolState[winningOutcome] || 0;

    // Get all bets for this round
    const { rows: allBets } = await client.query(
      `SELECT * FROM bets WHERE round_id = $1 AND status = 'active' FOR UPDATE`,
      [round_id]
    );

    let totalPayout = 0;
    const betResults = [];

    for (const bet of allBets) {
      const betAmount = Number(bet.amount);

      if (bet.chosen_outcome === winningOutcome) {
        // Winner — calculate proportional payout
        const payout = totalOnWinner > 0
          ? calculatePayout(betAmount, totalOnWinner, totalPool)
          : betAmount; // edge case: return stake if no one bet on winner

        // Settle balance: remove from locked, add payout to available
        await client.query(
          `UPDATE balances SET locked = locked - $1, available = available + $2
           WHERE user_id = $3 AND currency = 'USD'`,
          [betAmount, payout, bet.user_id]
        );

        // Update bet record
        await client.query(
          `UPDATE bets SET status = 'won', actual_payout = $1, settled_at = NOW()
           WHERE id = $2`,
          [payout, bet.id]
        );

        // Update user stats
        const profit = payout - betAmount;
        await client.query(
          `UPDATE users SET
            total_won = total_won + $1,
            total_profit = total_profit + $2,
            win_count = win_count + 1,
            current_streak = CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END,
            best_streak = GREATEST(best_streak, CASE WHEN current_streak >= 0 THEN current_streak + 1 ELSE 1 END)
           WHERE id = $3`,
          [payout, profit, bet.user_id]
        );

        totalPayout += payout;
        betResults.push({ user_id: bet.user_id, bet_id: bet.id, status: 'won', payout });
      } else {
        // Loser — funds already locked, just deduct from locked balance
        await client.query(
          `UPDATE balances SET locked = locked - $1
           WHERE user_id = $2 AND currency = 'USD'`,
          [betAmount, bet.user_id]
        );

        await client.query(
          `UPDATE bets SET status = 'lost', settled_at = NOW()
           WHERE id = $1`,
          [bet.id]
        );

        // Update user stats
        await client.query(
          `UPDATE users SET
            total_profit = total_profit - $1,
            loss_count = loss_count + 1,
            current_streak = CASE WHEN current_streak <= 0 THEN current_streak - 1 ELSE -1 END
           WHERE id = $2`,
          [betAmount, bet.user_id]
        );

        betResults.push({ user_id: bet.user_id, bet_id: bet.id, status: 'lost', payout: 0 });
      }
    }

    // Credit rake to house account
    if (rakeAmount > 0) {
      await client.query(
        `UPDATE balances SET available = available + $1
         WHERE user_id = $2 AND currency = 'USD'`,
        [rakeAmount, HOUSE_USER_ID]
      );
    }

    // Update round record
    await client.query(
      `UPDATE rounds SET
        status = 'settled',
        winning_outcome = $1,
        settlement_data = $2,
        settlement_frame_url = $3,
        settlement_confidence = $4,
        rake_amount = $5,
        settled_at = NOW()
       WHERE id = $6`,
      [
        winningOutcome,
        JSON.stringify(detection_data),
        frame_url,
        confidence,
        rakeAmount,
        round_id,
      ]
    );

    // Create settlement log entry
    await client.query(
      `INSERT INTO settlement_log
        (round_id, feed_id, bet_type_slug, round_number, winning_outcome,
         detection_method, detection_confidence, detection_data, frame_url,
         settled_at, total_bets, total_pool, total_payout, rake_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $10, $11, $12, $13)`,
      [
        round_id,
        feed_id,
        bet_type_slug,
        round.round_number,
        winningOutcome,
        detection_data?.detection_method || 'cv_detection',
        confidence,
        JSON.stringify(detection_data),
        frame_url,
        allBets.length,
        totalPool,
        totalPayout,
        rakeAmount,
      ]
    );

    await client.query('COMMIT');

    // Publish settlement events
    if (redisClient) {
      await redisClient.publish(
        'settlement_complete',
        JSON.stringify({
          event: 'round:settled',
          round_id,
          feed_id,
          bet_type_slug,
          round_number: round.round_number,
          winning_outcome: winningOutcome,
          confidence,
          frame_url,
          total_pool: totalPool,
          rake_amount: rakeAmount,
          total_payout: totalPayout,
          pool_state: poolState,
          bet_results: betResults,
        })
      );

      // Private balance updates for each affected user
      const uniqueUsers = [...new Set(betResults.map((b) => b.user_id))];
      for (const uid of uniqueUsers) {
        await redisClient.publish(
          'balance_update',
          JSON.stringify({ user_id: uid, type: 'settlement' })
        );
      }
    }

    console.log(
      `[engine] Round ${round_id} settled: ${winningOutcome} | pool=${totalPool} rake=${rakeAmount} payout=${totalPayout} bets=${allBets.length}`
    );

    return { round_id, winningOutcome, totalPool, rakeAmount, totalPayout, betResults };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[engine] Settlement error for round ${round_id}:`, err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel a round — refund all bets.
 */
async function cancelRound(pool, redisClient, roundId, reason) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: roundRows } = await client.query(
      `SELECT * FROM rounds WHERE id = $1 FOR UPDATE`,
      [roundId]
    );

    if (!roundRows.length) {
      await client.query('ROLLBACK');
      return null;
    }

    const round = roundRows[0];
    if (round.status === 'settled' || round.status === 'cancelled') {
      await client.query('ROLLBACK');
      return null;
    }

    // Refund all active bets
    const { rows: bets } = await client.query(
      `SELECT * FROM bets WHERE round_id = $1 AND status = 'active' FOR UPDATE`,
      [roundId]
    );

    for (const bet of bets) {
      await client.query(
        `UPDATE balances SET locked = locked - $1, available = available + $1
         WHERE user_id = $2 AND currency = 'USD'`,
        [bet.amount, bet.user_id]
      );

      await client.query(
        `UPDATE bets SET status = 'refunded', settled_at = NOW() WHERE id = $1`,
        [bet.id]
      );
    }

    await client.query(
      `UPDATE rounds SET status = 'cancelled', settled_at = NOW() WHERE id = $1`,
      [roundId]
    );

    await client.query('COMMIT');

    if (redisClient) {
      await redisClient.publish(
        'round_state',
        JSON.stringify({
          event: 'round:cancelled',
          round_id: roundId,
          feed_id: round.feed_id,
          reason: reason || 'Round cancelled',
        })
      );
    }

    console.log(`[engine] Round ${roundId} cancelled, ${bets.length} bets refunded`);
    return { roundId, refunded: bets.length };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { openRound, lockRound, placeBet, settleRound, cancelRound };
