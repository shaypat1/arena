'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { SUPPORTED_CURRENCIES } from '@/lib/constants';
import clsx from 'clsx';

export default function DepositPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { post } = useApi();

  const [selectedCurrency, setSelectedCurrency] = useState(null);
  const [address, setAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  async function handleSelectCurrency(currency) {
    setSelectedCurrency(currency);
    setAddress(null);
    setError(null);
    setLoading(true);

    try {
      const data = await post('/api/wallet/deposit-address', { currency: currency.id });
      setAddress(data.address);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
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
      <h1 className="text-2xl font-bold text-white mb-2">Deposit</h1>
      <p className="text-sm text-gray-500 mb-8">
        Select a cryptocurrency to generate a deposit address. Funds are converted to USD balance automatically.
      </p>

      {/* Currency selection */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {SUPPORTED_CURRENCIES.map((c) => (
          <button
            key={c.id}
            onClick={() => handleSelectCurrency(c)}
            className={clsx(
              'card p-4 flex flex-col items-center gap-2 transition-all',
              selectedCurrency?.id === c.id
                ? 'border-indigo-500 bg-indigo-500/10 ring-1 ring-indigo-500/50'
                : 'hover:border-gray-600'
            )}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: c.color + '33', color: c.color }}
            >
              {c.id[0]}
            </div>
            <span className="text-sm font-medium text-white">{c.id}</span>
            <span className="text-[11px] text-gray-500">{c.name}</span>
          </button>
        ))}
      </div>

      {/* Deposit address */}
      {loading && (
        <div className="card p-8 text-center">
          <svg className="animate-spin h-8 w-8 text-indigo-400 mx-auto" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500 mt-3">Generating deposit address...</p>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {address && !loading && (
        <div className="card p-6 space-y-6">
          {/* QR Code */}
          <div className="flex justify-center">
            <div className="p-4 bg-white rounded-xl">
              <QRCodeSVG value={address} size={180} level="M" />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="input-label">
              {selectedCurrency?.id} Deposit Address
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={address}
                readOnly
                className="input-field font-mono text-xs"
              />
              <button
                onClick={handleCopy}
                className={clsx(
                  'px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                  copied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                )}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-xs text-yellow-400">
              Only send <strong>{selectedCurrency?.name} ({selectedCurrency?.id})</strong> to this address.
              Sending other tokens may result in permanent loss.
            </p>
          </div>

          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex justify-between">
              <span>Network</span>
              <span className="text-gray-400">
                {selectedCurrency?.id === 'BTC' ? 'Bitcoin' : selectedCurrency?.id === 'ETH' ? 'Ethereum (ERC-20)' : 'Tron (TRC-20)'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Minimum deposit</span>
              <span className="text-gray-400">
                {selectedCurrency?.id === 'BTC' ? '0.0001 BTC' : selectedCurrency?.id === 'ETH' ? '0.001 ETH' : '1 USDT'}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Confirmations</span>
              <span className="text-gray-400">
                {selectedCurrency?.id === 'BTC' ? '2' : '12'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
