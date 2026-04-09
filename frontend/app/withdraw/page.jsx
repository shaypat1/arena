'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { SUPPORTED_CURRENCIES } from '@/lib/constants';
import { toMicroUSD } from '@/lib/format';
import clsx from 'clsx';

export default function WithdrawPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { get, post } = useApi();

  const [balance, setBalance] = useState(null);
  const [selectedCurrency, setSelectedCurrency] = useState(SUPPORTED_CURRENCIES[0]);
  const [amount, setAmount] = useState('');
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      get('/api/wallet/balance').then(setBalance).catch(() => {});
    }
  }, [user, authLoading, router, get]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!amount || Number(amount) <= 0) {
      setError('Enter a valid amount.');
      return;
    }
    if (!address.trim()) {
      setError('Enter a destination address.');
      return;
    }

    setLoading(true);
    try {
      const data = await post('/api/wallet/withdraw', {
        amount_usd: toMicroUSD(Number(amount)),
        currency: selectedCurrency.id,
        destination_address: address.trim(),
      });
      setSuccess(`Withdrawal initiated! TX ID: ${data.tx_id || 'pending'}. Status: ${data.status || 'processing'}`);
      setAmount('');
      setAddress('');
      // Refresh balance
      get('/api/wallet/balance').then(setBalance).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="h-96 skeleton rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-white mb-2">Withdraw</h1>
      <p className="text-sm text-gray-500 mb-8">
        Convert your USD balance to crypto and withdraw to your wallet.
      </p>

      {/* Balance */}
      {balance && (
        <div className="card p-4 mb-6 flex items-center justify-between">
          <span className="text-sm text-gray-400">Available balance</span>
          <span className="text-lg font-bold text-white">{balance.display}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Currency selection */}
        <div>
          <label className="input-label">Withdraw as</label>
          <div className="grid grid-cols-3 gap-3">
            {SUPPORTED_CURRENCIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedCurrency(c)}
                className={clsx(
                  'card p-3 flex flex-col items-center gap-1.5 transition-all',
                  selectedCurrency?.id === c.id
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'hover:border-gray-600'
                )}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: c.color + '33', color: c.color }}
                >
                  {c.id[0]}
                </div>
                <span className="text-xs font-medium text-white">{c.id}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="input-label">Amount (USD)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
            <input
              type="number"
              min="1"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="input-field pl-7 font-mono"
            />
          </div>
          {amount && Number(amount) > 0 && (
            <p className="text-xs text-gray-500 mt-1.5">
              Estimated: ~{selectedCurrency.id === 'BTC'
                ? (Number(amount) / 65000).toFixed(8)
                : selectedCurrency.id === 'ETH'
                ? (Number(amount) / 3200).toFixed(6)
                : Number(amount).toFixed(2)
              } {selectedCurrency.id}
            </p>
          )}
        </div>

        {/* Destination address */}
        <div>
          <label className="input-label">Destination Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder={`Your ${selectedCurrency.id} wallet address`}
            className="input-field font-mono text-sm"
          />
        </div>

        {/* Conversion preview */}
        {amount && Number(amount) > 0 && (
          <div className="card p-4 space-y-2 bg-gray-850">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Withdrawal</span>
              <span className="text-white">${Number(amount).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Network fee (est.)</span>
              <span className="text-gray-400">~$2.00</span>
            </div>
            <div className="border-t border-gray-700 my-1" />
            <div className="flex justify-between text-sm font-semibold">
              <span className="text-gray-400">You receive</span>
              <span className="text-white">
                ~{selectedCurrency.id === 'BTC'
                  ? (Math.max(0, Number(amount) - 2) / 65000).toFixed(8)
                  : selectedCurrency.id === 'ETH'
                  ? (Math.max(0, Number(amount) - 2) / 3200).toFixed(6)
                  : Math.max(0, Number(amount) - 2).toFixed(2)
                } {selectedCurrency.id}
              </span>
            </div>
          </div>
        )}

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-400">
            {success}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !amount || !address}
          className="w-full btn-primary py-3 text-sm font-semibold"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Processing...
            </span>
          ) : (
            'Withdraw'
          )}
        </button>
      </form>

      <p className="text-xs text-gray-600 text-center mt-6">
        Withdrawals are typically processed within 30 minutes. For large amounts, manual review may apply.
      </p>
    </div>
  );
}
