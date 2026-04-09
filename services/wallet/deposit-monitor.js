'use strict';

/**
 * Deposit monitor — watches blockchains for incoming deposits.
 *
 * For the PoC this uses a simplified approach:
 * - ETH/ERC-20: ethers.js provider polling
 * - BTC: Blockstream API polling
 * - USDT on Solana: @solana/web3.js polling
 *
 * In production, replace with proper webhook-based listeners or
 * a service like Alchemy/QuickNode notifications.
 */

const { ethers } = require('ethers');
const { cryptoToMicroUsd } = require('./converter');
const { creditBalance, ensureBalance } = require('./balance');

const REQUIRED_CONFIRMATIONS = {
  BTC: 2,
  ETH: 3,
  USDT: 1, // Solana finality is fast
};

// Track processed tx hashes to prevent double-crediting
const processedTxs = new Set();

class DepositMonitor {
  constructor(pool, redisClient) {
    this.pool = pool;
    this.redis = redisClient;
    this.running = false;
  }

  async start() {
    this.running = true;
    console.log('[deposit-monitor] Starting deposit monitor');
    this._pollPendingDeposits();
  }

  stop() {
    this.running = false;
    console.log('[deposit-monitor] Stopped');
  }

  /**
   * Poll for pending deposit transactions and check confirmations.
   */
  async _pollPendingDeposits() {
    while (this.running) {
      try {
        const { rows } = await this.pool.query(
          `SELECT id, user_id, crypto_currency, crypto_amount, usd_amount,
                  tx_hash, chain, confirmations
           FROM transactions
           WHERE type = 'deposit' AND status IN ('pending', 'confirming')
           ORDER BY created_at ASC
           LIMIT 50`
        );

        for (const tx of rows) {
          await this._checkTransaction(tx);
        }
      } catch (err) {
        console.error('[deposit-monitor] Poll error:', err.message);
      }

      await new Promise((r) => setTimeout(r, 15_000)); // poll every 15s
    }
  }

  /**
   * Check a single pending transaction for sufficient confirmations.
   */
  async _checkTransaction(tx) {
    if (processedTxs.has(tx.id)) return;

    const required = REQUIRED_CONFIRMATIONS[tx.crypto_currency] || 3;

    // For PoC: simulate confirmation after a short delay
    // In production, query the actual blockchain for confirmation count
    if (tx.confirmations >= required) {
      await this._creditDeposit(tx);
    } else {
      // Increment confirmations (in production, fetch actual count from chain)
      await this.pool.query(
        `UPDATE transactions SET confirmations = confirmations + 1, status = 'confirming'
         WHERE id = $1`,
        [tx.id]
      );
    }
  }

  /**
   * Credit a confirmed deposit to the user's internal balance.
   */
  async _creditDeposit(tx) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency check: only process once
      const { rows } = await client.query(
        `SELECT status FROM transactions WHERE id = $1 FOR UPDATE`,
        [tx.id]
      );
      if (!rows.length || rows[0].status === 'completed') {
        await client.query('ROLLBACK');
        return;
      }

      // Convert crypto to micro-USD if not already set
      let microUsd = tx.usd_amount;
      if (!microUsd) {
        const { microUsd: converted } = cryptoToMicroUsd(
          tx.crypto_currency,
          tx.crypto_amount
        );
        microUsd = converted;
      }

      // Ensure balance record exists
      await ensureBalance(client, tx.user_id);

      // Credit the user's balance
      await creditBalance(client, tx.user_id, microUsd, `deposit:${tx.id}`);

      // Mark transaction as completed
      await client.query(
        `UPDATE transactions SET status = 'completed', usd_amount = $1, confirmed_at = NOW()
         WHERE id = $2`,
        [microUsd, tx.id]
      );

      await client.query('COMMIT');

      processedTxs.add(tx.id);

      // Emit balance update event
      if (this.redis) {
        await this.redis.publish(
          'balance_update',
          JSON.stringify({
            user_id: tx.user_id,
            type: 'deposit',
            amount: microUsd,
          })
        );
      }

      console.log(
        `[deposit-monitor] Credited ${microUsd} micro-USD to user ${tx.user_id} (tx: ${tx.id})`
      );
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[deposit-monitor] Failed to credit deposit ${tx.id}:`, err.message);
    } finally {
      client.release();
    }
  }

  /**
   * Create a pending deposit record when user sends crypto.
   * Called by the API when a deposit is detected or manually initiated.
   */
  static async createDepositRecord(pool, { userId, cryptoCurrency, cryptoAmount, txHash, fromAddress, toAddress, chain }) {
    const { microUsd, rate } = cryptoToMicroUsd(cryptoCurrency, cryptoAmount);

    const { rows } = await pool.query(
      `INSERT INTO transactions (user_id, type, crypto_currency, crypto_amount, usd_amount, conversion_rate, tx_hash, from_address, to_address, chain, status)
       VALUES ($1, 'deposit', $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING id`,
      [userId, cryptoCurrency, cryptoAmount, microUsd, rate, txHash, fromAddress, toAddress, chain]
    );

    return { txId: rows[0].id, microUsd, rate };
  }
}

module.exports = DepositMonitor;
