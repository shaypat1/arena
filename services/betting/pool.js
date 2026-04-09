'use strict';

/**
 * Pool state tracking and odds calculation for seeded parimutuel betting.
 *
 * Odds formula: implied_odds(outcome) = (total_pool * 0.95) / amount_on_outcome
 * The 0.95 factor accounts for the 5% rake.
 */

const RAKE_RATE = 0.05;

/**
 * Calculate live implied odds for all outcomes in a round.
 * @param {object} poolState - { "red": 30000000, "blue": 8000000, ... } amounts per outcome in micro-USD
 * @param {number} totalPool - total pool in micro-USD
 * @returns {object} { "red": 2.97, "blue": 13.19, ... }
 */
function calculateOdds(poolState, totalPool) {
  if (totalPool <= 0) return {};

  const poolAfterRake = totalPool * (1 - RAKE_RATE);
  const odds = {};

  for (const [outcome, amount] of Object.entries(poolState)) {
    if (amount > 0) {
      odds[outcome] = Math.round((poolAfterRake / amount) * 100) / 100;
    } else {
      odds[outcome] = 0;
    }
  }

  return odds;
}

/**
 * Calculate the payout for a winning bet after settlement.
 * @param {number} betAmount - the bet amount in micro-USD
 * @param {number} totalOnWinner - total amount bet on the winning outcome
 * @param {number} totalPool - total pool
 * @returns {number} payout in micro-USD
 */
function calculatePayout(betAmount, totalOnWinner, totalPool) {
  if (totalOnWinner <= 0) return 0;
  const poolAfterRake = Math.floor(totalPool * (1 - RAKE_RATE));
  const share = betAmount / totalOnWinner;
  return Math.floor(share * poolAfterRake);
}

/**
 * Calculate rake amount from a pool.
 * @param {number} totalPool
 * @returns {number}
 */
function calculateRake(totalPool) {
  return Math.floor(totalPool * RAKE_RATE);
}

/**
 * Build the initial pool state from seed distribution and seed amount.
 * @param {object} seedDistribution - { "white": 0.30, "black": 0.25, ... }
 * @param {number} seedAmount - total seed amount in micro-USD
 * @returns {object} { "white": 30000000, "black": 25000000, ... }
 */
function buildSeedPool(seedDistribution, seedAmount) {
  const pool = {};
  let allocated = 0;
  const entries = Object.entries(seedDistribution);

  for (let i = 0; i < entries.length; i++) {
    const [outcome, weight] = entries[i];
    if (i === entries.length - 1) {
      // Last entry gets remainder to avoid rounding issues
      pool[outcome] = seedAmount - allocated;
    } else {
      pool[outcome] = Math.floor(seedAmount * weight);
      allocated += pool[outcome];
    }
  }

  return pool;
}

module.exports = { calculateOdds, calculatePayout, calculateRake, buildSeedPool, RAKE_RATE };
