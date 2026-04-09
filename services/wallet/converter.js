'use strict';

const { getPrice } = require('./price-feed');

// 1 USD = 1,000,000 micro-USD
const MICRO_USD = 1_000_000;

/**
 * Convert a crypto amount to micro-USD.
 * @param {string} cryptoCurrency - BTC, ETH, or USDT
 * @param {string} cryptoAmount - amount as string to avoid float issues
 * @returns {{ microUsd: number, rate: number }}
 */
function cryptoToMicroUsd(cryptoCurrency, cryptoAmount) {
  const rate = getPrice(cryptoCurrency);
  const usd = parseFloat(cryptoAmount) * rate;
  const microUsd = Math.round(usd * MICRO_USD);
  return { microUsd, rate };
}

/**
 * Convert micro-USD to a crypto amount.
 * @param {number} microUsd - amount in micro-USD
 * @param {string} cryptoCurrency - BTC, ETH, or USDT
 * @returns {{ cryptoAmount: string, rate: number }}
 */
function microUsdToCrypto(microUsd, cryptoCurrency) {
  const rate = getPrice(cryptoCurrency);
  const usd = microUsd / MICRO_USD;
  const cryptoAmount = (usd / rate).toFixed(8);
  return { cryptoAmount, rate };
}

/**
 * Format micro-USD for display.
 * @param {number} microUsd
 * @returns {string} e.g. "$15.02"
 */
function formatUsd(microUsd) {
  return `$${(microUsd / MICRO_USD).toFixed(2)}`;
}

module.exports = { cryptoToMicroUsd, microUsdToCrypto, formatUsd, MICRO_USD };
