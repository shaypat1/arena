'use strict';

const axios = require('axios');

const COINGECKO_URL = process.env.COINGECKO_API_URL || 'https://api.coingecko.com/api/v3';
const POLL_INTERVAL_MS = 30_000; // 30 seconds

let prices = { BTC: 0, ETH: 0, USDT: 1.0 };
let lastUpdated = null;
let redisClient = null;
let pollTimer = null;

async function fetchPrices() {
  try {
    const { data } = await axios.get(`${COINGECKO_URL}/simple/price`, {
      params: {
        ids: 'bitcoin,ethereum',
        vs_currencies: 'usd',
      },
      timeout: 10_000,
    });

    if (data.bitcoin?.usd) prices.BTC = data.bitcoin.usd;
    if (data.ethereum?.usd) prices.ETH = data.ethereum.usd;
    prices.USDT = 1.0; // stablecoin, always 1:1

    lastUpdated = new Date();

    if (redisClient) {
      await redisClient.set('prices:BTC', String(prices.BTC));
      await redisClient.set('prices:ETH', String(prices.ETH));
      await redisClient.set('prices:USDT', '1');
      await redisClient.set('prices:updated', lastUpdated.toISOString());
    }
  } catch (err) {
    console.error('[price-feed] Failed to fetch prices:', err.message);
  }
}

function startPolling(redis) {
  redisClient = redis;
  fetchPrices();
  pollTimer = setInterval(fetchPrices, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
}

function getPrice(currency) {
  const c = currency.toUpperCase();
  if (!(c in prices) || prices[c] === 0) {
    throw new Error(`No price available for ${c}`);
  }
  return prices[c];
}

function getAllPrices() {
  return { ...prices, lastUpdated };
}

module.exports = { startPolling, stopPolling, getPrice, getAllPrices, fetchPrices };
