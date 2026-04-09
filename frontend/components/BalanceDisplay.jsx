'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';

export default function BalanceDisplay() {
  const { user } = useAuth();
  const { get } = useApi();
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchBalance = useCallback(async () => {
    if (!user) return;
    try {
      const data = await get('/api/wallet/balance');
      setBalance(data);
    } catch {
      // Silently fail on balance fetch
    } finally {
      setLoading(false);
    }
  }, [user, get]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  if (!user) return null;

  return (
    <Link
      href="/deposit"
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800/80 border border-gray-700/50
                 hover:border-gray-600 transition-all group"
    >
      <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {loading ? (
        <div className="w-16 h-4 skeleton rounded" />
      ) : (
        <span className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">
          {balance?.display || '$0.00'}
        </span>
      )}
    </Link>
  );
}
