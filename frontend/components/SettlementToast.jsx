'use client';

import { useEffect, useRef } from 'react';
import { formatUSD } from '@/lib/format';
import { COLOR_MAP } from '@/lib/constants';
import clsx from 'clsx';

export default function SettlementToast({ settlement, betResult, onDismiss }) {
  const confettiRef = useRef(false);

  useEffect(() => {
    if (betResult?.won && !confettiRef.current) {
      confettiRef.current = true;
      import('canvas-confetti').then((mod) => {
        const confetti = mod.default;
        confetti({
          particleCount: 80,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#10b981', '#6366f1', '#8b5cf6', '#fbbf24'],
        });
      });
    }
    return () => {
      confettiRef.current = false;
    };
  }, [betResult?.won]);

  if (!settlement && !betResult) return null;

  const isWin = betResult?.won;
  const outcome = settlement?.outcome || betResult?.outcome;
  const colorHex = outcome ? COLOR_MAP[outcome.toLowerCase()] : null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up max-w-sm w-full">
      {/* Settlement notification */}
      {settlement && (
        <div
          className={clsx(
            'card p-4 mb-3 border-l-4 shadow-2xl',
            'border-indigo-500 shadow-indigo-500/10'
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
                Round Settled
              </p>
              <div className="flex items-center gap-2">
                {colorHex && (
                  <div
                    className="w-4 h-4 rounded-full border-2 border-gray-600"
                    style={{ backgroundColor: colorHex }}
                  />
                )}
                <span className="text-lg font-bold text-white capitalize">{outcome}</span>
              </div>
              {settlement.bet_type_label && (
                <p className="text-xs text-gray-500 mt-1">{settlement.bet_type_label}</p>
              )}
            </div>
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Bet result notification */}
      {betResult && (
        <div
          className={clsx(
            'card p-4 border-l-4 shadow-2xl',
            isWin
              ? 'border-emerald-500 shadow-emerald-500/10 glow-green'
              : 'border-red-500 shadow-red-500/10 animate-shake'
          )}
        >
          <div className="flex items-start justify-between">
            <div>
              <p
                className={clsx(
                  'text-xs font-medium uppercase tracking-wider mb-1',
                  isWin ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {isWin ? 'You Won!' : 'Better Luck Next Time'}
              </p>
              {betResult.payout != null && (
                <span
                  className={clsx(
                    'text-xl font-bold',
                    isWin ? 'text-emerald-400' : 'text-red-400'
                  )}
                >
                  {isWin ? '+' : ''}{formatUSD(betResult.payout)}
                </span>
              )}
              {betResult.outcome && (
                <p className="text-xs text-gray-500 mt-1">
                  Result: <span className="capitalize">{betResult.outcome}</span>
                </p>
              )}
            </div>
            <button
              onClick={onDismiss}
              className="text-gray-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
