'use strict';

/**
 * Core internal ledger operations for the Arena wallet service.
 *
 * All monetary values are in micro-USD (1 USD = 1,000,000 micro-USD).
 * Every mutation acquires a row-level lock via SELECT ... FOR UPDATE
 * inside an explicit transaction to guarantee atomicity and prevent
 * negative balances under concurrency.
 */

/**
 * Ensure a balance record exists for the given user.
 * Uses INSERT ... ON CONFLICT DO NOTHING so it is safe to call repeatedly.
 */
async function ensureBalance(pool, userId) {
  await pool.query(
    `INSERT INTO balances (user_id, currency, available, locked)
     VALUES ($1, 'USD', 0, 0)
     ON CONFLICT (user_id, currency) DO NOTHING`,
    [userId]
  );
}

/**
 * Return the current balance for a user.
 * Returns { available, locked } in micro-USD, or null if no record exists.
 */
async function getBalance(pool, userId) {
  const { rows } = await pool.query(
    `SELECT available, locked FROM balances
     WHERE user_id = $1 AND currency = 'USD'`,
    [userId]
  );
  if (rows.length === 0) return null;
  return {
    available: Number(rows[0].available),
    locked: Number(rows[0].locked),
  };
}

/**
 * Credit (add to) a user's available balance.
 * @returns {object} New balance { available, locked }
 * @throws If amount <= 0
 */
async function creditBalance(pool, userId, amount, reason) {
  if (amount <= 0) {
    throw new Error(`creditBalance: amount must be positive, got ${amount}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Lock the row
    const { rows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`creditBalance: no balance record for user ${userId}`);
    }

    const newAvailable = Number(rows[0].available) + amount;

    await client.query(
      `UPDATE balances SET available = $1, updated_at = NOW()
       WHERE user_id = $2 AND currency = 'USD'`,
      [newAvailable, userId]
    );

    // Audit log
    await client.query(
      `INSERT INTO balance_audit (user_id, operation, amount, reason, balance_after)
       VALUES ($1, 'credit', $2, $3, $4)`,
      [userId, amount, reason || 'credit', newAvailable]
    );

    await client.query('COMMIT');

    return { available: newAvailable, locked: Number(rows[0].locked) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Debit (subtract from) a user's available balance.
 * @returns {object} New balance { available, locked }
 * @throws If amount <= 0 or insufficient available balance
 */
async function debitBalance(pool, userId, amount, reason) {
  if (amount <= 0) {
    throw new Error(`debitBalance: amount must be positive, got ${amount}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`debitBalance: no balance record for user ${userId}`);
    }

    const currentAvailable = Number(rows[0].available);
    if (currentAvailable < amount) {
      throw new Error(
        `debitBalance: insufficient funds. available=${currentAvailable}, requested=${amount}`
      );
    }

    const newAvailable = currentAvailable - amount;

    await client.query(
      `UPDATE balances SET available = $1, updated_at = NOW()
       WHERE user_id = $2 AND currency = 'USD'`,
      [newAvailable, userId]
    );

    await client.query(
      `INSERT INTO balance_audit (user_id, operation, amount, reason, balance_after)
       VALUES ($1, 'debit', $2, $3, $4)`,
      [userId, amount, reason || 'debit', newAvailable]
    );

    await client.query('COMMIT');

    return { available: newAvailable, locked: Number(rows[0].locked) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Move funds from available to locked (for bet placement).
 * @returns {object} New balance { available, locked }
 * @throws If amount <= 0 or insufficient available balance
 */
async function lockFunds(pool, userId, amount) {
  if (amount <= 0) {
    throw new Error(`lockFunds: amount must be positive, got ${amount}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`lockFunds: no balance record for user ${userId}`);
    }

    const currentAvailable = Number(rows[0].available);
    const currentLocked = Number(rows[0].locked);

    if (currentAvailable < amount) {
      throw new Error(
        `lockFunds: insufficient funds. available=${currentAvailable}, requested=${amount}`
      );
    }

    const newAvailable = currentAvailable - amount;
    const newLocked = currentLocked + amount;

    await client.query(
      `UPDATE balances SET available = $1, locked = $2, updated_at = NOW()
       WHERE user_id = $3 AND currency = 'USD'`,
      [newAvailable, newLocked, userId]
    );

    await client.query(
      `INSERT INTO balance_audit (user_id, operation, amount, reason, balance_after)
       VALUES ($1, 'lock', $2, 'bet_placement', $3)`,
      [userId, amount, newAvailable]
    );

    await client.query('COMMIT');

    return { available: newAvailable, locked: newLocked };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Move funds from locked back to available (bet cancellation/refund).
 * @returns {object} New balance { available, locked }
 * @throws If amount <= 0 or locked < amount
 */
async function unlockFunds(pool, userId, amount) {
  if (amount <= 0) {
    throw new Error(`unlockFunds: amount must be positive, got ${amount}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`unlockFunds: no balance record for user ${userId}`);
    }

    const currentAvailable = Number(rows[0].available);
    const currentLocked = Number(rows[0].locked);

    if (currentLocked < amount) {
      throw new Error(
        `unlockFunds: cannot unlock more than locked. locked=${currentLocked}, requested=${amount}`
      );
    }

    const newAvailable = currentAvailable + amount;
    const newLocked = currentLocked - amount;

    await client.query(
      `UPDATE balances SET available = $1, locked = $2, updated_at = NOW()
       WHERE user_id = $3 AND currency = 'USD'`,
      [newAvailable, newLocked, userId]
    );

    await client.query(
      `INSERT INTO balance_audit (user_id, operation, amount, reason, balance_after)
       VALUES ($1, 'unlock', $2, 'bet_cancellation', $3)`,
      [userId, amount, newAvailable]
    );

    await client.query('COMMIT');

    return { available: newAvailable, locked: newLocked };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Settle a bet: remove lockedAmount from locked, add payout to available.
 *
 * - Win:  lockedAmount = stake, payout = stake + winnings
 * - Loss: lockedAmount = stake, payout = 0
 * - Push: lockedAmount = stake, payout = stake
 *
 * @returns {object} New balance { available, locked }
 */
async function settleBet(pool, userId, lockedAmount, payout) {
  if (lockedAmount <= 0) {
    throw new Error(`settleBet: lockedAmount must be positive, got ${lockedAmount}`);
  }
  if (payout < 0) {
    throw new Error(`settleBet: payout cannot be negative, got ${payout}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT available, locked FROM balances
       WHERE user_id = $1 AND currency = 'USD'
       FOR UPDATE`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error(`settleBet: no balance record for user ${userId}`);
    }

    const currentAvailable = Number(rows[0].available);
    const currentLocked = Number(rows[0].locked);

    if (currentLocked < lockedAmount) {
      throw new Error(
        `settleBet: locked balance inconsistency. locked=${currentLocked}, lockedAmount=${lockedAmount}`
      );
    }

    const newAvailable = currentAvailable + payout;
    const newLocked = currentLocked - lockedAmount;

    await client.query(
      `UPDATE balances SET available = $1, locked = $2, updated_at = NOW()
       WHERE user_id = $3 AND currency = 'USD'`,
      [newAvailable, newLocked, userId]
    );

    await client.query(
      `INSERT INTO balance_audit (user_id, operation, amount, reason, balance_after)
       VALUES ($1, 'settle', $2, $3, $4)`,
      [userId, payout, `bet_settlement locked=${lockedAmount} payout=${payout}`, newAvailable]
    );

    await client.query('COMMIT');

    return { available: newAvailable, locked: newLocked };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  ensureBalance,
  getBalance,
  creditBalance,
  debitBalance,
  lockFunds,
  unlockFunds,
  settleBet,
};
