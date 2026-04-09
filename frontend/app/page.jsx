'use client';

import { useEffect, useState } from 'react';
import FeedCard from '@/components/FeedCard';
import { useApi } from '@/hooks/useApi';

function FeedCardSkeleton() {
  return (
    <div className="card overflow-hidden">
      <div className="aspect-video skeleton" />
      <div className="p-4 space-y-3">
        <div className="h-5 w-3/4 skeleton" />
        <div className="h-4 w-1/2 skeleton" />
        <div className="flex gap-2">
          <div className="h-5 w-16 skeleton rounded-full" />
          <div className="h-5 w-20 skeleton rounded-full" />
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { get } = useApi();
  const [feeds, setFeeds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function fetchFeeds() {
      try {
        const data = await get('/api/feeds');
        setFeeds(data.feeds || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchFeeds();
  }, [get]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Hero section */}
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight">
          Watch. Predict. <span className="text-gradient">Win.</span>
        </h1>
        <p className="text-lg text-gray-400 max-w-2xl mx-auto">
          Bet on real-world events from live camera feeds. Pick the next car color,
          count pedestrians, predict the weather &mdash; all powered by crypto.
        </p>
      </div>

      {/* Live indicator */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <h2 className="text-xl font-bold text-white">Live Feeds</h2>
        </div>
        {!loading && (
          <span className="text-sm text-gray-500">
            {feeds.length} feed{feeds.length !== 1 ? 's' : ''} active
          </span>
        )}
      </div>

      {/* Error state */}
      {error && (
        <div className="card p-8 text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="btn-secondary"
          >
            Retry
          </button>
        </div>
      )}

      {/* Feed grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <FeedCardSkeleton key={i} />
          ))}
        </div>
      ) : feeds.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {feeds.map((feed) => (
            <FeedCard key={feed.id || feed.slug} feed={feed} />
          ))}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <svg className="w-16 h-16 mx-auto mb-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <h3 className="text-lg font-semibold text-white mb-2">No feeds available</h3>
          <p className="text-gray-500">Check back soon for live betting feeds.</p>
        </div>
      )}

      {/* Bottom CTA */}
      <div className="mt-16 text-center">
        <div className="card p-8 max-w-2xl mx-auto bg-gradient-to-br from-gray-800 to-gray-850">
          <h3 className="text-xl font-bold text-white mb-2">How it works</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-6">
            <div>
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <span className="text-indigo-400 font-bold">1</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Watch</h4>
              <p className="text-xs text-gray-500">Pick a live camera feed and watch in real time</p>
            </div>
            <div>
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-purple-500/20 flex items-center justify-center">
                <span className="text-purple-400 font-bold">2</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Predict</h4>
              <p className="text-xs text-gray-500">Place bets on what happens next in the feed</p>
            </div>
            <div>
              <div className="w-10 h-10 mx-auto mb-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <span className="text-emerald-400 font-bold">3</span>
              </div>
              <h4 className="text-sm font-semibold text-white mb-1">Win</h4>
              <p className="text-xs text-gray-500">AI verifies outcomes instantly. Get paid in crypto.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
