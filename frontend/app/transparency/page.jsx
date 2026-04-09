'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';
import { formatUSD, formatDate } from '@/lib/format';
import { COLOR_MAP } from '@/lib/constants';
import clsx from 'clsx';

export default function TransparencyPage() {
  const { get } = useApi();
  const [settlements, setSettlements] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // Filters
  const [feedFilter, setFeedFilter] = useState('');
  const [betTypeFilter, setBetTypeFilter] = useState('');
  const [feeds, setFeeds] = useState([]);

  useEffect(() => {
    get('/api/feeds')
      .then((data) => setFeeds(data.feeds || []))
      .catch(() => {});
  }, [get]);

  const fetchSettlements = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/settlement-log?page=${page}&limit=20`;
      if (feedFilter) url += `&feed_id=${feedFilter}`;
      if (betTypeFilter) url += `&bet_type=${betTypeFilter}`;

      const data = await get(url);
      setSettlements(data.settlements || []);
      setTotal(data.total || 0);
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, [get, page, feedFilter, betTypeFilter]);

  useEffect(() => {
    fetchSettlements();
  }, [fetchSettlements]);

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">Transparency Log</h1>
        <p className="text-sm text-gray-500">
          Every round settlement is recorded and auditable. View the AI detection frame, bounding boxes,
          and confidence scores for any settled round.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={feedFilter}
          onChange={(e) => {
            setFeedFilter(e.target.value);
            setPage(1);
          }}
          className="input-field max-w-[200px] text-sm"
        >
          <option value="">All feeds</option>
          {feeds.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        <input
          type="text"
          value={betTypeFilter}
          onChange={(e) => {
            setBetTypeFilter(e.target.value);
            setPage(1);
          }}
          placeholder="Filter by bet type..."
          className="input-field max-w-[200px] text-sm"
        />
      </div>

      {/* Results count */}
      {!loading && (
        <p className="text-xs text-gray-500 mb-4">
          {total} settlement{total !== 1 ? 's' : ''} found
        </p>
      )}

      {/* Settlements list */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-20 skeleton rounded-xl" />
          ))}
        </div>
      ) : settlements.length > 0 ? (
        <div className="space-y-2">
          {settlements.map((s) => {
            const colorHex = s.outcome ? COLOR_MAP[s.outcome.toLowerCase()] : null;

            return (
              <Link
                key={s.round_id || s.id}
                href={`/transparency/${s.round_id || s.id}`}
                className="card-hover block p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Outcome color swatch */}
                    <div className="shrink-0">
                      {colorHex ? (
                        <div
                          className="w-8 h-8 rounded-full border-2 border-gray-600"
                          style={{ backgroundColor: colorHex }}
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                          <span className="text-xs text-gray-400 capitalize">{s.outcome?.[0] || '?'}</span>
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white capitalize">
                          {s.outcome || 'Unknown'}
                        </span>
                        <span className="badge-blue text-[10px]">
                          {s.bet_type_label || s.bet_type || 'Bet'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">{s.feed_name || 'Feed'}</span>
                        <span className="text-xs text-gray-600">{formatDate(s.settled_at || s.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    {s.confidence != null && (
                      <div className="hidden sm:block text-right">
                        <p className="text-[10px] text-gray-500 uppercase">Confidence</p>
                        <p className={clsx(
                          'text-sm font-semibold tabular-nums',
                          s.confidence >= 0.8 ? 'text-emerald-400' : s.confidence >= 0.5 ? 'text-yellow-400' : 'text-red-400'
                        )}>
                          {(s.confidence * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}

                    {s.total_pool != null && (
                      <div className="text-right">
                        <p className="text-[10px] text-gray-500 uppercase">Pool</p>
                        <p className="text-sm font-medium text-gray-300 tabular-nums">
                          {formatUSD(s.total_pool)}
                        </p>
                      </div>
                    )}

                    <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-gray-500">No settlements found matching your filters.</p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-8">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="btn-secondary text-sm"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500 px-3">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="btn-secondary text-sm"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
