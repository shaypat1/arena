'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { toMicroUSD } from '@/lib/format';
import clsx from 'clsx';

// Phase 1: Place bets (15s) — feed hidden, location shown
// Phase 2: Counting (15s) — feed revealed, bets locked

export default function CarCountBetting({ round, timerStart }) {
  const { user } = useAuth();
  const { post } = useApi();

  const [elapsed, setElapsed] = useState(0);
  const [selectedBet, setSelectedBet] = useState(null); // 'even' | 'odd' | 'zero'
  const [amount, setAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);
  const [placedBet, setPlacedBet] = useState(null);

  // Single timer from timerStart
  useEffect(() => {
    if (!timerStart) return;
    setElapsed(0);
    const iv = setInterval(() => {
      setElapsed((Date.now() - timerStart) / 1000);
    }, 100);
    return () => clearInterval(iv);
  }, [timerStart]);

  // Reset on new round
  useEffect(() => {
    setSelectedBet(null);
    setAmount('');
    setError(null);
    setPlacedBet(null);
  }, [round?.id]);

  const phase1Left = Math.max(0, Math.ceil(15 - elapsed));
  const phase2Left = Math.max(0, Math.ceil(30 - elapsed));
  const phase = elapsed < 15 ? 1 : elapsed < 30 ? 2 : 0;

  const EVEN_ODD_PAYOUT = 1.96;
  const ZERO_PAYOUT = 100;

  async function handlePlaceBet() {
    if (!selectedBet || !amount || Number(amount) <= 0) {
      setError('Pick a bet and enter an amount');
      return;
    }
    setPlacing(true);
    setError(null);
    try {
      await post('/api/bets/place', {
        round_id: round.id,
        chosen_outcome: selectedBet,
        amount: toMicroUSD(Number(amount)),
      });
      setPlacedBet({ outcome: selectedBet, amount: Number(amount) });
    } catch (err) {
      setError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  if (!round || !timerStart) {
    return (
      <div className="card p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-gray-700/50 px-5 py-4 text-center">
          <p className="text-lg font-bold text-white">Next Round</p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <svg className="animate-spin h-5 w-5 text-indigo-400" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-gray-400 text-sm">Loading camera...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-0 overflow-hidden">

      {/* ─── PHASE 1: Place Your Bets ─── */}
      {phase === 1 && (
        <>
          <div className="bg-gradient-to-r from-indigo-600/20 to-purple-600/20 border-b border-gray-700/50 px-5 py-4 text-center">
            <p className="text-lg font-bold text-white">Place Your Bets</p>
            <p className={clsx(
              'text-4xl font-black tabular-nums mt-1',
              phase1Left > 5 ? 'text-white' : 'text-red-400 animate-pulse'
            )}>
              0:{phase1Left.toString().padStart(2, '0')}
            </p>
          </div>

          <TimerBar seconds={phase1Left} total={15} />

          <div className="p-5 space-y-4">
            <p className="text-center text-gray-300 text-sm">
              How many cars will pass in 15 seconds?
            </p>

            {/* Even / Odd / Zero buttons */}
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setSelectedBet('even')}
                className={clsx(
                  'py-5 rounded-xl font-bold transition-all',
                  selectedBet === 'even'
                    ? 'bg-yellow-400 text-black ring-2 ring-yellow-300 shadow-lg shadow-yellow-400/30 scale-[1.02]'
                    : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-600'
                )}
              >
                <div className="text-xl">Even</div>
              </button>

              <button
                onClick={() => setSelectedBet('odd')}
                className={clsx(
                  'py-5 rounded-xl font-bold transition-all',
                  selectedBet === 'odd'
                    ? 'bg-yellow-400 text-black ring-2 ring-yellow-300 shadow-lg shadow-yellow-400/30 scale-[1.02]'
                    : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-600'
                )}
              >
                <div className="text-xl">Odd</div>
              </button>

              <button
                onClick={() => setSelectedBet('zero')}
                className={clsx(
                  'py-5 rounded-xl font-bold transition-all',
                  selectedBet === 'zero'
                    ? 'bg-red-500 text-white ring-2 ring-red-400 shadow-lg shadow-red-500/30 scale-[1.02]'
                    : 'bg-gray-800 text-white hover:bg-gray-700 border border-gray-600'
                )}
              >
                <div className="text-xl">Zero</div>
              </button>
            </div>

            {/* Amount — Stake style with 1/2 and 2x buttons */}
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wider mb-1.5 block">Amount</label>
              <div className="flex items-center bg-gray-900 border border-gray-700 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent">
                <span className="pl-3 text-gray-500 text-sm">$</span>
                <input type="text" inputMode="decimal" value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  placeholder="0.00"
                  className="flex-1 bg-transparent px-2 py-3 text-white font-mono text-lg outline-none"
                  disabled={placing} />
                <button
                  onClick={() => { const v = Number(amount); if (v > 0) setAmount((v / 2).toFixed(2)); }}
                  className="px-3 py-3 text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800 border-l border-gray-700 transition-colors"
                >
                  &frac12;
                </button>
                <button
                  onClick={() => { const v = Number(amount) || 1; setAmount((v * 2).toFixed(2)); }}
                  className="px-3 py-3 text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800 border-l border-gray-700 transition-colors"
                >
                  2x
                </button>
              </div>
            </div>

            {/* Payout — only shows when bet + amount selected */}
            {selectedBet && amount && Number(amount) > 0 && (
              <div className="text-center py-2">
                <span className="text-xs text-gray-500 uppercase tracking-wider">Payout</span>
                <div className="text-3xl font-black text-green-400 mt-1">
                  ${(Number(amount) * (selectedBet === 'zero' ? ZERO_PAYOUT : EVEN_ODD_PAYOUT)).toFixed(2)}
                </div>
              </div>
            )}

            {/* Play button */}
            {user ? (
              <button onClick={handlePlaceBet}
                disabled={!selectedBet || !amount || placing || !!placedBet}
                className={clsx('w-full py-4 rounded-xl font-bold text-base transition-all active:scale-[0.98]',
                  selectedBet && amount && !placing && !placedBet
                    ? 'bg-green-500 hover:bg-green-400 text-white font-black shadow-lg shadow-green-500/30'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed')}>
                {placing ? 'Placing...' : placedBet ? 'Placed!' : 'Play'}
              </button>
            ) : (
              <a href="/login"
                className="block w-full py-4 rounded-xl font-black text-base text-center bg-green-500 hover:bg-green-400 text-white shadow-lg shadow-green-500/30 transition-all">
                Play
              </a>
            )}

            {placedBet && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400 text-center">
                {placedBet.outcome.toUpperCase()} — ${placedBet.amount.toFixed(2)}
              </div>
            )}
            {error && (
              <div className="p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">{error}</div>
            )}
          </div>
        </>
      )}

      {/* ─── PHASE 2: Counting Cars ─── */}
      {phase === 2 && (
        <>
          <div className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 border-b border-gray-700/50 px-5 py-4 text-center">
            <p className="text-lg font-bold text-white">Counting Cars</p>
            <p className={clsx(
              'text-4xl font-black tabular-nums mt-1',
              phase2Left > 5 ? 'text-white' : 'text-yellow-400 animate-pulse'
            )}>
              0:{phase2Left.toString().padStart(2, '0')}
            </p>
          </div>

          <TimerBar seconds={phase2Left} total={15} />

          <div className="p-5 space-y-4">
            {placedBet ? (
              <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Your Bet</p>
                <div className="flex items-center justify-between">
                  <span className={clsx('text-lg font-bold',
                    placedBet.outcome === 'even' ? 'text-blue-400' :
                    placedBet.outcome === 'odd' ? 'text-purple-400' : 'text-emerald-400'
                  )}>
                    {placedBet.outcome.toUpperCase()}
                  </span>
                  <div className="text-right">
                    <span className="text-white font-bold">${placedBet.amount.toFixed(2)}</span>
                    <span className="text-gray-500 text-sm ml-2">→ ${(placedBet.amount * (placedBet.outcome === 'zero' ? ZERO_PAYOUT : EVEN_ODD_PAYOUT)).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center text-gray-500 text-sm py-4">No bet placed this round</div>
            )}
          </div>
        </>
      )}

      {/* ─── Round over ─── */}
      {phase === 0 && (
        <div className="p-8 text-center">
          <p className="text-sm text-gray-500">Round complete — next round starting...</p>
        </div>
      )}
    </div>
  );
}

function TimerBar({ seconds, total }) {
  const pct = (seconds / total) * 100;
  return (
    <div className="h-1.5 bg-gray-800">
      <div className={clsx('h-full transition-all duration-100 ease-linear',
        seconds > 10 ? 'bg-indigo-500' : seconds > 5 ? 'bg-yellow-500' : 'bg-red-500'
      )} style={{ width: `${pct}%` }} />
    </div>
  );
}
