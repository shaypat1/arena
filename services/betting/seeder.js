'use strict';

/**
 * House seed bet placement.
 * When a new round opens, the house places seed bets on all outcomes
 * weighted by historical probabilities to provide initial liquidity.
 */

const { generateBetHash } = require('./bet-hasher');
const { lockFunds } = require('../wallet/balance');
const { buildSeedPool } = require('./pool');

const HOUSE_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Place house seed bets for a newly opened round.
 * Must be called atomically inside a DB transaction via the provided client.
 *
 * @param {object} client - pg client inside a transaction
 * @param {object} round - { id, bet_type_id }
 * @param {object} betType - { seed_distribution, seed_amount, options }
 * @returns {object} { poolState, totalSeeded }
 */
async function placeHouseSeedBets(client, round, betType) {
  const seedAmount = Number(betType.seed_amount);
  if (seedAmount <= 0) return { poolState: {}, totalSeeded: 0 };

  const seedDistribution = betType.seed_distribution;
  const seedPool = buildSeedPool(seedDistribution, seedAmount);

  // Lock total seed amount from house balance
  // We do this via direct SQL since we're inside a transaction already
  const { rows: balRows } = await client.query(
    `SELECT available, locked FROM balances
     WHERE user_id = $1 AND currency = 'USD'
     FOR UPDATE`,
    [HOUSE_USER_ID]
  );

  if (!balRows.length) {
    throw new Error('House account has no balance record');
  }

  const houseAvailable = Number(balRows[0].available);
  if (houseAvailable < seedAmount) {
    console.warn(
      `[seeder] House balance too low for seeding. Available: ${houseAvailable}, needed: ${seedAmount}`
    );
    return { poolState: {}, totalSeeded: 0 };
  }

  // Debit house available, credit house locked
  await client.query(
    `UPDATE balances SET available = available - $1, locked = locked + $1
     WHERE user_id = $2 AND currency = 'USD'`,
    [seedAmount, HOUSE_USER_ID]
  );

  // Place individual seed bets per outcome
  const now = new Date().toISOString();
  for (const [outcome, amount] of Object.entries(seedPool)) {
    if (amount <= 0) continue;

    const betHash = generateBetHash(HOUSE_USER_ID, round.id, outcome, amount, now);
    const odds = 0; // seed bets don't have meaningful initial odds

    await client.query(
      `INSERT INTO bets (user_id, round_id, bet_type_id, chosen_outcome, amount, odds, potential_payout, status, bet_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8)`,
      [HOUSE_USER_ID, round.id, round.bet_type_id, outcome, amount, odds, 0, betHash]
    );
  }

  return { poolState: seedPool, totalSeeded: seedAmount };
}

module.exports = { placeHouseSeedBets, HOUSE_USER_ID };
