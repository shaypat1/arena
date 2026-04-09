export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export const BLOCKED_COUNTRIES = [
  'US', 'GB', 'AU', 'FR', 'NL', 'BE', 'ES', 'IT', 'DE', 'AT',
  'PT', 'SE', 'CH', 'IL', 'KR', 'SG', 'HK', 'CU', 'IR', 'KP',
];

export const SUPPORTED_CURRENCIES = [
  { id: 'BTC', name: 'Bitcoin', icon: '/btc.svg', color: '#F7931A' },
  { id: 'ETH', name: 'Ethereum', icon: '/eth.svg', color: '#627EEA' },
  { id: 'USDT', name: 'Tether', icon: '/usdt.svg', color: '#26A17B' },
];

export const COLOR_MAP = {
  red: '#EF4444',
  blue: '#3B82F6',
  green: '#22C55E',
  white: '#F9FAFB',
  black: '#111827',
  silver: '#9CA3AF',
  gray: '#6B7280',
  yellow: '#EAB308',
  orange: '#F97316',
  brown: '#92400E',
  purple: '#A855F7',
  pink: '#EC4899',
  gold: '#D97706',
  beige: '#D2B48C',
  tan: '#C4A882',
  maroon: '#7F1D1D',
  navy: '#1E3A5F',
  teal: '#14B8A6',
};

export const ROUND_STATES = {
  OPEN: 'open',
  LOCKED: 'locked',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
};

export const BET_QUICK_AMOUNTS = [1, 5, 10, 25, 50, 100];
