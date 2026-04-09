'use strict';

/**
 * Withdrawal worker — processes queued withdrawal requests.
 *
 * Uses Bull queue to process withdrawals sequentially per chain
 * to avoid nonce conflicts and ensure reliable on-chain submission.
 */

const Queue = require('bull');
const { debitBalance } = require('./balance');
const { microUsdToCrypto } = require('./converter');

// Network fees in micro-USD (conservative estimates for PoC)
const NETWORK_FEES = {
  BTC: 5_000_000,   // ~$5
  ETH: 3_000_000,   // ~$3
  USDT: 1_000_000,  // ~$1 (Solana)
};

class WithdrawalWorker {
  constructor(pool, redisUrl) {
    this.pool = pool;
    this.queue = new Queue('withdrawals', redisUrl);
    this._setupProcessor();
  }

  _setupProcessor() {
    this.queue.process(async (job) => {
      const { txId, userId, amountMicroUsd, currency, destinationAddress } = job.data;

      try {
        const { cryptoAmount } = microUsdToCrypto(amountMicroUsd, currency);

        // In production: submit actual on-chain transaction here
        // For PoC: simulate the transaction
        const fakeTxHash = `0x${Buffer.from(txId).toString('hex').slice(0, 64).padEnd(64, '0')}`;

        await this.pool.query(
          `UPDATE transactions SET tx_hash = $1, status = 'completed', confirmed_at = NOW()
           WHERE id = $2`,
          [fakeTxHash, txId]
        );

        console.log(
          `[withdrawal-worker] Processed withdrawal ${txId}: ${cryptoAmount} ${currency} to ${destinationAddress}`
        );

        return { txHash: fakeTxHash, cryptoAmount };
      } catch (err) {
        // Mark as failed
        await this.pool.query(
          `UPDATE transactions SET status = 'failed' WHERE id = $1`,
          [txId]
        );

        console.error(`[withdrawal-worker] Failed withdrawal ${txId}:`, err.message);
        throw err;
      }
    });

    this.queue.on('failed', (job, err) => {
      console.error(`[withdrawal-worker] Job ${job.id} failed:`, err.message);
    });
  }

  /**
   * Request a withdrawal. Debits user balance and queues on-chain transaction.
   */
  async requestWithdrawal(userId, amountMicroUsd, currency, destinationAddress) {
    const cur = currency.toUpperCase();
    const fee = NETWORK_FEES[cur] || 3_000_000;
    const totalDebit = amountMicroUsd + fee;

    // Debit user balance (this validates sufficient funds)
    await debitBalance(this.pool, userId, totalDebit, `withdrawal:${cur}`);

    // Convert to crypto for display
    const { cryptoAmount, rate } = microUsdToCrypto(amountMicroUsd, cur);

    // Create transaction record
    const { rows } = await this.pool.query(
      `INSERT INTO transactions (user_id, type, crypto_currency, crypto_amount, usd_amount, conversion_rate, to_address, chain, status)
       VALUES ($1, 'withdrawal', $2, $3, $4, $5, $6, $7, 'pending')
       RETURNING id`,
      [
        userId,
        cur,
        cryptoAmount,
        amountMicroUsd,
        rate,
        destinationAddress,
        cur === 'BTC' ? 'bitcoin' : cur === 'ETH' ? 'ethereum' : 'solana',
      ]
    );

    const txId = rows[0].id;

    // Queue for processing
    await this.queue.add({
      txId,
      userId,
      amountMicroUsd,
      currency: cur,
      destinationAddress,
    });

    return { txId, cryptoAmount, rate, fee };
  }

  async close() {
    await this.queue.close();
  }
}

module.exports = WithdrawalWorker;
