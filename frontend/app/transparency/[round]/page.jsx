'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import FrameViewer from '@/components/FrameViewer';
import { useApi } from '@/hooks/useApi';
import { formatUSD, formatDate } from '@/lib/format';
import { COLOR_MAP } from '@/lib/constants';
import clsx from 'clsx';

function ConfidenceMeter({ confidence }) {
  const pct = (confidence || 0) * 100;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">Detection Confidence</span>
        <span
          className={clsx(
            'text-sm font-bold tabular-nums',
            pct >= 80 ? 'text-emerald-400' : pct >= 50 ? 'text-yellow-400' : 'text-red-400'
          )}
        >
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-500',
            pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PoolBreakdown({ poolState }) {
  if (!poolState?.breakdown) return null;

  const entries = Object.entries(poolState.breakdown);
  const total = entries.reduce((sum, [, val]) => sum + (val || 0), 0);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-white">Pool Breakdown</h3>
      {entries.map(([outcome, amount]) => {
        const pct = total > 0 ? (amount / total) * 100 : 0;
        const colorHex = COLOR_MAP[outcome.toLowerCase()] || '#6366f1';

        return (
          <div key={outcome} className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colorHex }} />
                <span className="text-xs text-gray-300 capitalize">{outcome}</span>
              </div>
              <span className="text-xs text-gray-400 tabular-nums">
                {formatUSD(amount)} ({pct.toFixed(1)}%)
              </span>
            </div>
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, backgroundColor: colorHex }}
              />
            </div>
          </div>
        );
      })}
      {total > 0 && (
        <div className="pt-2 border-t border-gray-700 flex justify-between">
          <span className="text-xs text-gray-500">Total Pool</span>
          <span className="text-sm font-semibold text-white">{formatUSD(total)}</span>
        </div>
      )}
    </div>
  );
}

export default function RoundDetailPage() {
  const { round: roundId } = useParams();
  const { get } = useApi();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchRound() {
      try {
        const res = await get(`/api/settlement-log/${roundId}`);
        setData(res);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchRound();
  }, [roundId, get]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="space-y-6">
          <div className="h-6 w-48 skeleton" />
          <div className="aspect-video skeleton rounded-xl" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-32 skeleton rounded-xl" />
            <div className="h-32 skeleton rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="card p-8 text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <Link href="/transparency" className="btn-secondary">Back to settlement log</Link>
        </div>
      </div>
    );
  }

  const settlement = data?.settlement || data;
  const colorHex = settlement?.outcome ? COLOR_MAP[settlement.outcome.toLowerCase()] : null;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm">
        <Link href="/transparency" className="text-gray-500 hover:text-gray-300 transition-colors">
          Settlement Log
        </Link>
        <svg className="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-gray-400">Round {roundId}</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        {colorHex && (
          <div
            className="w-12 h-12 rounded-full border-2 border-gray-600"
            style={{ backgroundColor: colorHex }}
          />
        )}
        <div>
          <h1 className="text-2xl font-bold text-white capitalize">
            {settlement?.outcome || 'Unknown'}
          </h1>
          <p className="text-sm text-gray-500">
            {settlement?.bet_type_label || settlement?.bet_type || ''} &middot;{' '}
            {settlement?.feed_name || ''} &middot;{' '}
            {formatDate(settlement?.settled_at)}
          </p>
        </div>
      </div>

      {/* Settlement frame with bbox */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Settlement Frame
        </h2>
        <FrameViewer
          frameUrl={settlement?.frame_url || settlement?.settlement_frame_url}
          boundingBox={settlement?.bounding_box || settlement?.bbox}
          detectedColor={settlement?.outcome}
          confidence={settlement?.confidence}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Detection details */}
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white">Detection Details</h3>

          {settlement?.confidence != null && (
            <ConfidenceMeter confidence={settlement.confidence} />
          )}

          {/* Color swatch */}
          {colorHex && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500">Detected color</span>
              <div className="flex items-center gap-2">
                <div
                  className="w-6 h-6 rounded border border-gray-600"
                  style={{ backgroundColor: colorHex }}
                />
                <span className="text-sm text-white capitalize">{settlement?.outcome}</span>
              </div>
            </div>
          )}

          {settlement?.model_version && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Model version</span>
              <span className="text-gray-400">{settlement.model_version}</span>
            </div>
          )}
          {settlement?.processing_time_ms != null && (
            <div className="flex justify-between text-xs">
              <span className="text-gray-500">Processing time</span>
              <span className="text-gray-400">{settlement.processing_time_ms}ms</span>
            </div>
          )}
        </div>

        {/* Pool breakdown */}
        <div className="card p-5">
          <PoolBreakdown poolState={settlement?.pool_state} />

          {!settlement?.pool_state?.breakdown && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">Round Info</h3>
              {settlement?.total_pool != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total pool</span>
                  <span className="text-white">{formatUSD(settlement.total_pool)}</span>
                </div>
              )}
              {settlement?.total_bets != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total bets</span>
                  <span className="text-gray-300">{settlement.total_bets}</span>
                </div>
              )}
              {settlement?.winner_count != null && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Winners</span>
                  <span className="text-emerald-400">{settlement.winner_count}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Back link */}
      <Link
        href="/transparency"
        className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to settlement log
      </Link>
    </div>
  );
}
