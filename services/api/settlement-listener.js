'use strict';

/**
 * Settlement listener — subscribes to Redis "settlement" channel
 * and triggers the betting engine to settle rounds.
 *
 * This bridges the CV pipeline / feed simulator to the betting engine.
 */

const { createClient } = require('redis');
const { settleRound } = require('../betting/engine');

let subscriber = null;

async function startSettlementListener(pgPool, redisPublisher, redisUrl) {
  subscriber = createClient({ url: redisUrl });
  await subscriber.connect();

  await subscriber.subscribe('settlement', async (message) => {
    try {
      const event = JSON.parse(message);
      console.log(
        `[settlement-listener] Received: round=${event.round_id} outcome=${event.outcome} confidence=${event.confidence}`
      );

      await settleRound(pgPool, redisPublisher, event);
    } catch (err) {
      console.error('[settlement-listener] Error processing settlement:', err.message);
    }
  });

  console.log('[settlement-listener] Listening for settlement events');
}

async function stopSettlementListener() {
  if (subscriber) {
    await subscriber.unsubscribe();
    await subscriber.quit();
  }
}

module.exports = { startSettlementListener, stopSettlementListener };
