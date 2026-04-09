'use client';

import { useEffect, useState } from 'react';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { formatUSD } from '@/lib/format';
import clsx from 'clsx';

function RankBadge({ rank }) {
  if (rank === 1) {
    return (
      <div className="w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
        <span className="text-yellow-400 text-sm">&#9733;</span>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="w-8 h-8 rounded-full bg-gray-400/20 flex items-center justify-center">
        <span className="text-gray-300 text-sm">&#9733;</span>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
        <span className="text-orange-400 text-sm">&#9733;</span>
      </div>
    );
  }
  return (
    <div className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center">
      <span className="text-gray-500 text-xs font-bold">{rank}</span>
    </div>
  );
}

export default function LeaderboardPage() {
  const { get } = useApi();
  const { user } = useAuth();
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      try {
        const data = await get('/api/leaderboard');
        setLeaderboard(data.leaderboard || []);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, [get]);

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Leaderboard</h1>
        <p className="text-sm text-gray-500">Top players ranked by total profit</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-16 skeleton rounded-xl" />
          ))}
        </div>
      ) : leaderboard.length > 0 ? (
        <div className="space-y-2">
          {/* Header row */}
          <div className="flex items-center px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider">
            <span className="w-12">Rank</span>
            <span className="flex-1">Player</span>
            <span className="w-28 text-right">Profit</span>
            <span className="w-20 text-right hidden sm:block">Win Rate</span>
            <span className="w-24 text-right hidden sm:block">Total Bets</span>
          </div>

          {leaderboard.map((entry, idx) => {
            const rank = idx + 1;
            const isCurrentUser = user && entry.username === user.username;

            return (
              <div
                key={entry.user_id || idx}
                className={clsx(
                  'card flex items-center px-4 py-3 transition-colors',
                  isCurrentUser && 'ring-1 ring-indigo-500/50 bg-indigo-500/5',
                  rank <= 3 && 'border-yellow-500/20'
                )}
              >
                <div className="w-12">
                  <RankBadge rank={rank} />
                </div>
                <div className="flex-1 flex items-center gap-3 min-w-0">
                  <div
                    className={clsx(
                      'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold',
                      rank === 1
                        ? 'bg-yellow-500/30 text-yellow-300'
                        : rank === 2
                        ? 'bg-gray-500/30 text-gray-300'
                        : rank === 3
                        ? 'bg-orange-500/30 text-orange-300'
                        : 'bg-gray-700 text-gray-400'
                    )}
                  >
                    {entry.username?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="truncate">
                    <span className={clsx(
                      'text-sm font-medium',
                      isCurrentUser ? 'text-indigo-400' : 'text-white'
                    )}>
                      {entry.username}
                    </span>
                    {isCurrentUser && (
                      <span className="text-[10px] text-indigo-400 ml-1.5">(you)</span>
                    )}
                  </div>
                </div>
                <span
                  className={clsx(
                    'w-28 text-right text-sm font-semibold tabular-nums',
                    (entry.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'
                  )}
                >
                  {(entry.profit || 0) >= 0 ? '+' : ''}
                  {formatUSD(entry.profit)}
                </span>
                <span className="w-20 text-right text-sm text-gray-400 tabular-nums hidden sm:block">
                  {entry.win_rate != null ? `${(entry.win_rate * 100).toFixed(1)}%` : '--'}
                </span>
                <span className="w-24 text-right text-sm text-gray-500 tabular-nums hidden sm:block">
                  {entry.total_bets ?? '--'}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-gray-500">No leaderboard data yet. Start betting to climb the ranks!</p>
        </div>
      )}
    </div>
  );
}
