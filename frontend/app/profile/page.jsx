'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { formatUSD, formatDate } from '@/lib/format';
import clsx from 'clsx';

function StatCard({ label, value, subtext, color }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={clsx('text-2xl font-bold tabular-nums', color || 'text-white')}>
        {value}
      </p>
      {subtext && <p className="text-xs text-gray-600 mt-1">{subtext}</p>}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, logout, loading: authLoading } = useAuth();
  const { get } = useApi();

  const [balance, setBalance] = useState(null);
  const [bets, setBets] = useState([]);
  const [betPage, setBetPage] = useState(1);
  const [betTotal, setBetTotal] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [tab, setTab] = useState('bets');
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [balData, betData, txData] = await Promise.all([
        get('/api/wallet/balance'),
        get(`/api/bets/history?page=${betPage}&limit=20`),
        get('/api/wallet/transactions'),
      ]);
      setBalance(balData);
      setBets(betData.bets || []);
      setBetTotal(betData.total || 0);
      setTransactions(txData.transactions || []);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [user, get, betPage]);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    fetchData();
  }, [user, authLoading, fetchData, router]);

  if (authLoading || !user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="space-y-4">
          <div className="h-8 w-48 skeleton" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 skeleton rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Compute stats from bets
  const totalWagered = bets.reduce((sum, b) => sum + (b.amount || 0), 0);
  const totalWon = bets.filter((b) => b.won).reduce((sum, b) => sum + (b.payout || 0), 0);
  const profit = totalWon - totalWagered;
  const winRate = bets.length > 0
    ? ((bets.filter((b) => b.won).length / bets.length) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
            <span className="text-xl font-bold text-white">
              {user.username?.[0]?.toUpperCase() || 'U'}
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{user.username}</h1>
            <p className="text-sm text-gray-500">{user.email}</p>
          </div>
        </div>
        <button onClick={logout} className="btn-secondary text-sm">
          Log out
        </button>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Balance"
          value={balance?.display || '$0.00'}
          color="text-white"
        />
        <StatCard
          label="Total Wagered"
          value={formatUSD(totalWagered)}
          color="text-gray-300"
        />
        <StatCard
          label="Total Won"
          value={formatUSD(totalWon)}
          color="text-emerald-400"
        />
        <StatCard
          label="Win Rate"
          value={`${winRate}%`}
          color={Number(winRate) >= 50 ? 'text-emerald-400' : 'text-red-400'}
        />
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 mb-8">
        <Link href="/deposit" className="btn-success text-sm">Deposit</Link>
        <Link href="/withdraw" className="btn-secondary text-sm">Withdraw</Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {['bets', 'transactions'].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize',
              tab === t
                ? 'border-indigo-500 text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {t === 'bets' ? 'Bet History' : 'Transactions'}
          </button>
        ))}
      </div>

      {/* Bet history */}
      {tab === 'bets' && (
        <div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 skeleton rounded-xl" />
              ))}
            </div>
          ) : bets.length > 0 ? (
            <>
              <div className="space-y-2">
                {bets.map((bet) => (
                  <div key={bet.id} className="card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={clsx(
                          'w-2 h-2 rounded-full',
                          bet.won === true
                            ? 'bg-emerald-400'
                            : bet.won === false
                            ? 'bg-red-400'
                            : 'bg-gray-600'
                        )}
                      />
                      <div>
                        <span className="text-sm font-medium text-white capitalize">
                          {bet.chosen_outcome}
                        </span>
                        <span className="text-xs text-gray-500 ml-2">
                          {bet.bet_type_label || bet.bet_type || ''}
                        </span>
                        <p className="text-xs text-gray-600">{formatDate(bet.created_at)}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-300">{formatUSD(bet.amount)}</p>
                      {bet.payout != null && bet.won && (
                        <p className="text-xs text-emerald-400">+{formatUSD(bet.payout)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {betTotal > 20 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setBetPage((p) => Math.max(1, p - 1))}
                    disabled={betPage <= 1}
                    className="btn-secondary text-sm"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500">Page {betPage}</span>
                  <button
                    onClick={() => setBetPage((p) => p + 1)}
                    disabled={bets.length < 20}
                    className="btn-secondary text-sm"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="card p-8 text-center">
              <p className="text-gray-500">No bets yet. Head to a feed to place your first bet!</p>
            </div>
          )}
        </div>
      )}

      {/* Transactions */}
      {tab === 'transactions' && (
        <div>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-16 skeleton rounded-xl" />
              ))}
            </div>
          ) : transactions.length > 0 ? (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div key={tx.id} className="card p-4 flex items-center justify-between">
                  <div>
                    <span className={clsx(
                      'badge text-[10px] mb-1',
                      tx.type === 'deposit' ? 'badge-green' : 'badge-red'
                    )}>
                      {tx.type}
                    </span>
                    <p className="text-xs text-gray-600">{formatDate(tx.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className={clsx(
                      'text-sm font-medium',
                      tx.type === 'deposit' ? 'text-emerald-400' : 'text-red-400'
                    )}>
                      {tx.type === 'deposit' ? '+' : '-'}{formatUSD(tx.amount_usd)}
                    </p>
                    <p className="text-xs text-gray-600">{tx.currency} / {tx.status}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card p-8 text-center">
              <p className="text-gray-500">No transactions yet.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
