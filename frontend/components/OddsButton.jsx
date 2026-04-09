'use client';

import { formatOdds, formatProbability } from '@/lib/format';
import { COLOR_MAP } from '@/lib/constants';
import clsx from 'clsx';

export default function OddsButton({ outcome, odds, probability, selected, onClick, disabled }) {
  const colorHex = COLOR_MAP[outcome?.toLowerCase()] || null;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'relative flex flex-col items-center gap-1 px-3 py-2.5 rounded-lg border transition-all duration-150',
        'min-w-[80px] flex-1',
        selected
          ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/50'
          : 'border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Color swatch */}
      {colorHex && (
        <div
          className="w-5 h-5 rounded-full border-2 border-gray-600 mb-0.5"
          style={{ backgroundColor: colorHex }}
        />
      )}

      {/* Outcome label */}
      <span className={clsx(
        'text-xs font-medium capitalize',
        selected ? 'text-indigo-300' : 'text-gray-300'
      )}>
        {outcome}
      </span>

      {/* Odds */}
      <span className={clsx(
        'text-sm font-bold tabular-nums',
        selected ? 'text-white' : 'text-gray-100'
      )}>
        {formatOdds(odds)}
      </span>

      {/* Probability */}
      {probability != null && (
        <span className="text-[10px] text-gray-500 tabular-nums">
          {formatProbability(probability)}
        </span>
      )}

      {/* Selected indicator */}
      {selected && (
        <div className="absolute -top-1 -right-1 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center">
          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      )}
    </button>
  );
}
