'use client';

import { useState, useEffect } from 'react';
import OddsButton from './OddsButton';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { formatUSD, toMicroUSD } from '@/lib/format';
import { BET_QUICK_AMOUNTS, ROUND_STATES } from '@/lib/constants';
import clsx from 'clsx';

export default function BettingPanel({ round, liveOdds, onBetPlaced }) {
  const { user } = useAuth();
  const { post } = useApi();

  const [selectedOutcome, setSelectedOutcome] = useState(null);
  const [amount, setAmount] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Reset when round changes
  useEffect(() => {
    setSelectedOutcome(null);
    setAmount('');
    setError(null);
    setSuccess(null);
  }, [round?.id]);

  if (!round) return null;

  const roundStatus = round.status || round.state;
  const isOpen = roundStatus === ROUND_STATES.OPEN || roundStatus === 'open';
  const odds = liveOdds || round.odds || round.implied_odds || {};
  const options = round.options || round.outcomes || [];
  const outcomes = Array.isArray(options) ? options : Object.keys(odds);

  async function handlePlaceBet() {
    if (!selectedOutcome || !amount || Number(amount) <= 0) {
      setError('Select an outcome and enter an amount.');
      return;
    }
    if (!user) {
      setError('Please log in to place bets.');
      return;
    }

    setPlacing(true);
    setError(null);
    setSuccess(null);

    try {
      const data = await post('/api/bets/place', {
        round_id: round.id,
        chosen_outcome: selectedOutcome,
        amount: toMicroUSD(Number(amount)),
      });

      setSuccess(`Bet placed! ${selectedOutcome} @ ${data.current_odds?.[selectedOutcome] ? data.current_odds[selectedOutcome].toFixed(2) + 'x' : ''}`);
      setSelectedOutcome(null);
      setAmount('');
      if (onBetPlaced) onBetPlaced(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setPlacing(false);
    }
  }

  const potentialPayout = selectedOutcome && odds[selectedOutcome] && amount
    ? (Number(amount) * odds[selectedOutcome]).toFixed(2)
    : null;

  return (
    <div className="card p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">
          {round.bet_type_name || round.bet_type_label || round.bet_type || 'Bet'}
        </h3>
        <span
          className={clsx(
            'badge text-[10px]',
            isOpen ? 'badge-green' : 'badge-yellow'
          )}
        >
          {isOpen ? 'Open' : roundStatus}
        </span>
      </div>

      {/* Pool info */}
      {round.pool_state?.total_pool != null && (
        <div className="text-xs text-gray-500 mb-3">
          Pool: {formatUSD(round.pool_state.total_pool)}
        </div>
      )}

      {/* Outcome buttons */}
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
        {outcomes.map((outcome) => (
          <OddsButton
            key={outcome}
            outcome={outcome}
            odds={odds[outcome]}
            probability={round.pool_state?.probabilities?.[outcome]}
            selected={selectedOutcome === outcome}
            onClick={() => isOpen && setSelectedOutcome(outcome)}
            disabled={!isOpen}
          />
        ))}
      </div>

      {/* Amount input */}
      {isOpen && (
        <>
          <div className="mb-3">
            <label className="input-label">Bet Amount (USD)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                className="input-field pl-7 font-mono"
                disabled={placing}
              />
            </div>
          </div>

          {/* Quick amount buttons */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {BET_QUICK_AMOUNTS.map((qa) => (
              <button
                key={qa}
                onClick={() => setAmount(String(qa))}
                className={clsx(
                  'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
                  Number(amount) === qa
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700 hover:text-white'
                )}
              >
                ${qa}
              </button>
            ))}
          </div>

          {/* Potential payout */}
          {potentialPayout && (
            <div className="flex items-center justify-between text-sm mb-4 px-3 py-2 bg-gray-900/50 rounded-lg">
              <span className="text-gray-400">Potential payout</span>
              <span className="font-semibold text-emerald-400">${potentialPayout}</span>
            </div>
          )}

          {/* Place bet button */}
          <button
            onClick={handlePlaceBet}
            disabled={!selectedOutcome || !amount || placing || !user}
            className={clsx(
              'w-full py-3 rounded-lg font-semibold text-sm transition-all duration-150 active:scale-[0.98]',
              selectedOutcome && amount && !placing
                ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white shadow-lg shadow-indigo-500/25'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            )}
          >
            {placing ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Placing...
              </span>
            ) : !user ? (
              'Log in to bet'
            ) : selectedOutcome ? (
              `Place bet on ${selectedOutcome}`
            ) : (
              'Select an outcome'
            )}
          </button>
        </>
      )}

      {/* Messages */}
      {error && (
        <div className="mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400">
          {success}
        </div>
      )}
    </div>
  );
}
