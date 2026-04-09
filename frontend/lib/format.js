/**
 * Convert micro-USD (from API) to display dollars.
 * 1 USD = 1,000,000 micro-USD.
 */
export function formatUSD(microUSD) {
  if (microUSD == null || isNaN(microUSD)) return '$0.00';
  const dollars = microUSD / 1_000_000;
  return `$${dollars.toFixed(2)}`;
}

/**
 * Format raw dollar amount (already converted) with $ sign.
 */
export function formatDollars(amount) {
  if (amount == null || isNaN(amount)) return '$0.00';
  return `$${Number(amount).toFixed(2)}`;
}

/**
 * Convert a display dollar amount to micro-USD for the API.
 */
export function toMicroUSD(dollars) {
  return Math.round(dollars * 1_000_000);
}

/**
 * Format odds as a multiplier string e.g. "2.35x".
 */
export function formatOdds(odds) {
  if (odds == null || isNaN(odds)) return '-.--x';
  return `${Number(odds).toFixed(2)}x`;
}

/**
 * Format an implied probability as a percentage string.
 */
export function formatProbability(prob) {
  if (prob == null || isNaN(prob)) return '--%';
  return `${(prob * 100).toFixed(1)}%`;
}

/**
 * Format seconds into mm:ss countdown display.
 */
export function formatCountdown(totalSeconds) {
  if (totalSeconds == null || totalSeconds <= 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format a date string for display.
 */
export function formatDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format a timestamp for chat messages.
 */
export function formatChatTime(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Abbreviate large numbers (e.g. 1500 -> 1.5K).
 */
export function abbreviateNumber(num) {
  if (num == null) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Format a percentage with sign (e.g. +12.5% or -3.2%).
 */
export function formatProfitPercent(value) {
  if (value == null || isNaN(value)) return '0.0%';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${Number(value).toFixed(1)}%`;
}
