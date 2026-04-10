'use strict';

/**
 * Redis subscriber → Socket.IO broadcaster.
 * Subscribes to Redis pub/sub channels and re-broadcasts events
 * to the appropriate Socket.IO rooms.
 */

const { createClient } = require('redis');
const { getIO } = require('./socket-server');

let subscriber = null;

async function startBridge(redisUrl) {
  subscriber = createClient({ url: redisUrl });
  await subscriber.connect();

  // Subscribe to all relevant channels
  await subscriber.subscribe('round_state', (message) => {
    const data = JSON.parse(message);
    const io = getIO();
    if (!io) return;

    const event = data.event; // round:opened, round:locked, round:cancelled
    io.to(`feed:${data.feed_id}`).emit(event, data);
  });

  await subscriber.subscribe('settlement_complete', (message) => {
    const data = JSON.parse(message);
    const io = getIO();
    if (!io) return;

    // Broadcast settlement to feed room
    io.to(`feed:${data.feed_id}`).emit('round:settled', {
      round_id: data.round_id,
      feed_id: data.feed_id,
      bet_type_slug: data.bet_type_slug,
      round_number: data.round_number,
      winning_outcome: data.winning_outcome,
      confidence: data.confidence,
      frame_url: data.frame_url,
      total_pool: data.total_pool,
      rake_amount: data.rake_amount,
      total_payout: data.total_payout,
      pool_state: data.pool_state,
    });

    // Send individual bet results to each user
    if (data.bet_results) {
      for (const result of data.bet_results) {
        io.to(`user:${result.user_id}`).emit('bet:result', {
          bet_id: result.bet_id,
          status: result.status,
          payout: result.payout,
        });
      }
    }
  });

  await subscriber.subscribe('bet_placed', (message) => {
    const data = JSON.parse(message);
    const io = getIO();
    if (!io) return;

    io.to(`feed:${data.feed_id}`).emit('bet:placed', {
      round_id: data.round_id,
      outcome: data.outcome,
      amount: data.amount,
      username: data.username,
      odds: data.odds,
    });
  });

  await subscriber.subscribe('odds_update', (message) => {
    const data = JSON.parse(message);
    const io = getIO();
    if (!io) return;

    io.to(`feed:${data.feed_id}`).emit('odds:updated', {
      round_id: data.round_id,
      odds: data.odds,
      pool_state: data.pool_state,
      total_pool: data.total_pool,
    });
  });

  await subscriber.subscribe('balance_update', (message) => {
    const data = JSON.parse(message);
    const io = getIO();
    if (!io) return;

    // Private event to specific user
    io.to(`user:${data.user_id}`).emit('user:balance', {
      type: data.type,
      amount: data.amount,
    });
  });

  // Live CV debug stream: per-frame tracks + running count, for drawing
  // live dots on the FeedPlayer during the counting phase.
  await subscriber.subscribe('cv_tracks', (message) => {
    const io = getIO();
    if (!io) return;
    try {
      const data = JSON.parse(message);
      if (data.feed_id) {
        io.to(`feed:${data.feed_id}`).emit('cv:tracks', data);
      }
    } catch (err) {
      // swallow bad payloads
    }
  });

  console.log('[redis-bridge] Subscribed to all channels');
}

async function stopBridge() {
  if (subscriber) {
    await subscriber.unsubscribe();
    await subscriber.quit();
  }
}

module.exports = { startBridge, stopBridge };
