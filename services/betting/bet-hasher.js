'use strict';

const crypto = require('crypto');

/**
 * Generate a SHA-256 commitment hash for a bet.
 * This hash is stored on the bet record and can be used to verify
 * the bet was not tampered with after placement.
 */
function generateBetHash(userId, roundId, chosenOutcome, amount, timestamp) {
  const data = `${userId}:${roundId}:${chosenOutcome}:${amount}:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

module.exports = { generateBetHash };
