'use strict';

const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const { v4: uuid } = require('uuid');

const { ensureBalance, getBalance, creditBalance } = require('./balance');
const { startPolling, getAllPrices } = require('./price-feed');
const { cryptoToMicroUsd, microUsdToCrypto, formatUsd } = require('./converter');
const DepositMonitor = require('./deposit-monitor');
const WithdrawalWorker = require('./withdrawal-worker');

const router = express.Router();

let pool = null;
let redis = null;
let depositMonitor = null;
let withdrawalWorker = null;

/**
 * Initialize wallet service with shared DB pool and Redis client.
 */
async function init(pgPool, redisClient) {
  pool = pgPool;
  redis = redisClient;

  // Start price feed polling
  startPolling(redis);

  // Start deposit monitor
  depositMonitor = new DepositMonitor(pool, redis);
  await depositMonitor.start();

  // Start withdrawal worker
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  withdrawalWorker = new WithdrawalWorker(pool, redisUrl);

  console.log('[wallet] Service initialized');
}

// ─── GET /balance ───────────────────────────────────────────
router.get('/balance', async (req, res) => {
  try {
    const userId = req.user.id;
    await ensureBalance(pool, userId);
    const bal = await getBalance(pool, userId);
    res.json({
      balance: {
        available: bal.available,
        locked: bal.locked,
      },
      display: formatUsd(bal.available),
    });
  } catch (err) {
    console.error('[wallet] GET /balance error:', err.message);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

// ─── GET /transactions ──────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = (page - 1) * limit;

    const { rows } = await pool.query(
      `SELECT id, type, crypto_currency, crypto_amount, usd_amount, conversion_rate,
              tx_hash, chain, status, confirmations, created_at, confirmed_at
       FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM transactions WHERE user_id = $1`,
      [userId]
    );

    res.json({
      transactions: rows.map((tx) => ({
        ...tx,
        usd_display: tx.usd_amount ? formatUsd(tx.usd_amount) : null,
      })),
      total: parseInt(countRows[0].count),
      page,
    });
  } catch (err) {
    console.error('[wallet] GET /transactions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ─── POST /deposit-address ──────────────────────────────────
router.post('/deposit-address', async (req, res) => {
  try {
    const { currency } = req.body;
    const cur = (currency || '').toUpperCase();

    if (!['BTC', 'ETH', 'USDT'].includes(cur)) {
      return res.status(400).json({ error: 'Unsupported currency. Use BTC, ETH, or USDT.' });
    }

    // For PoC: return the hot wallet address for deposits
    // In production: generate unique per-user addresses or use memo/tag system
    const addresses = {
      BTC: process.env.BTC_DEPOSIT_ADDRESS || 'bc1q_demo_deposit_address',
      ETH: process.env.ETH_DEPOSIT_ADDRESS || '0x_demo_deposit_address',
      USDT: process.env.SOL_DEPOSIT_ADDRESS || 'So1_demo_deposit_address',
    };

    res.json({
      address: addresses[cur],
      currency: cur,
      chain: cur === 'BTC' ? 'bitcoin' : cur === 'ETH' ? 'ethereum' : 'solana',
      note: 'Send only ' + cur + ' to this address. Deposits credit automatically after confirmations.',
    });
  } catch (err) {
    console.error('[wallet] POST /deposit-address error:', err.message);
    res.status(500).json({ error: 'Failed to generate deposit address' });
  }
});

// ─── POST /withdraw ─────────────────────────────────────────
router.post('/withdraw', async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount_usd, currency, destination_address } = req.body;

    if (!amount_usd || amount_usd <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    const cur = (currency || '').toUpperCase();
    if (!['BTC', 'ETH', 'USDT'].includes(cur)) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }
    if (!destination_address) {
      return res.status(400).json({ error: 'Destination address required' });
    }

    // amount_usd is in micro-USD from the client
    const amountMicroUsd = parseInt(amount_usd);

    const result = await withdrawalWorker.requestWithdrawal(
      userId,
      amountMicroUsd,
      cur,
      destination_address
    );

    res.json({
      tx_id: result.txId,
      status: 'pending',
      crypto_amount: result.cryptoAmount,
      currency: cur,
      rate: result.rate,
      fee_usd: formatUsd(result.fee),
    });
  } catch (err) {
    if (err.message.includes('insufficient funds')) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }
    console.error('[wallet] POST /withdraw error:', err.message);
    res.status(500).json({ error: 'Withdrawal failed' });
  }
});

// ─── GET /prices ────────────────────────────────────────────
router.get('/prices', (req, res) => {
  const prices = getAllPrices();
  res.json(prices);
});

// ─── POST /simulate-deposit (DEV ONLY) ─────────────────────
// For testing: instantly credit a user's balance
router.post('/simulate-deposit', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Not available in production' });
  }

  try {
    const userId = req.user.id;
    const { amount_usd } = req.body;
    const microUsd = parseInt(amount_usd) || 100_000_000; // default $100

    await ensureBalance(pool, userId);
    const bal = await creditBalance(pool, userId, microUsd, 'simulate_deposit');

    if (redis) {
      await redis.publish(
        'balance_update',
        JSON.stringify({ user_id: userId, type: 'deposit', amount: microUsd })
      );
    }

    res.json({
      balance: bal,
      display: formatUsd(bal.available),
      credited: formatUsd(microUsd),
    });
  } catch (err) {
    console.error('[wallet] simulate-deposit error:', err.message);
    res.status(500).json({ error: 'Failed to simulate deposit' });
  }
});

module.exports = { router, init };
