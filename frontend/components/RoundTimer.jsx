'use client';

import { useState, useEffect } from 'react';
import { formatCountdown } from '@/lib/format';
import { ROUND_STATES } from '@/lib/constants';
import clsx from 'clsx';

export default function RoundTimer({ round }) {
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    if (!round?.locks_at) return;

    function updateTimer() {
      const lockTime = new Date(round.locks_at).getTime();
      const now = Date.now();
      const diff = Math.max(0, Math.floor((lockTime - now) / 1000));
      setSecondsLeft(diff);
    }

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [round?.locks_at]);

  const totalDuration = round?.duration_seconds || 120;
  const progress = totalDuration > 0 ? Math.max(0, secondsLeft / totalDuration) : 0;

  const roundStatus = round?.status || round?.state;
  const isLocked = roundStatus === ROUND_STATES.LOCKED || roundStatus === 'locked';
  const isUrgent = secondsLeft <= 15 && secondsLeft > 0;

  return (
    <div
      className={clsx(
        'glass rounded-lg px-3 py-2 min-w-[140px]',
        isLocked && 'border-yellow-500/50',
        isUrgent && !isLocked && 'border-red-500/50 animate-pulse'
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider truncate">
          {round?.bet_type_name || round?.bet_type_label || 'Round'}
        </span>
        {isLocked ? (
          <span className="badge-yellow text-[10px]">Locked</span>
        ) : secondsLeft > 0 ? (
          <span
            className={clsx(
              'text-sm font-mono font-bold tabular-nums',
              isUrgent ? 'text-red-400' : 'text-white'
            )}
          >
            {formatCountdown(secondsLeft)}
          </span>
        ) : (
          <span className="badge-red text-[10px]">Closing</span>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-1000',
            isLocked
              ? 'bg-yellow-500'
              : isUrgent
              ? 'bg-red-500'
              : progress > 0.5
              ? 'bg-emerald-500'
              : 'bg-orange-500'
          )}
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
