'use client';

import './globals.css';
import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { useAuthStore } from '@/hooks/useAuth';
import { BLOCKED_COUNTRIES } from '@/lib/constants';

function GeoBlockScreen() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="card p-8 max-w-md text-center">
        <div className="text-6xl mb-4">&#128683;</div>
        <h1 className="text-2xl font-bold text-white mb-3">Region Restricted</h1>
        <p className="text-gray-400 mb-6">
          Arena is not available in your region due to regulatory restrictions.
          We apologize for the inconvenience.
        </p>
        <p className="text-sm text-gray-500">
          If you believe this is an error, please contact support.
        </p>
      </div>
    </div>
  );
}

function AppProviders({ children }) {
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const [geoBlocked, setGeoBlocked] = useState(false);
  const [geoChecked, setGeoChecked] = useState(false);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    // Geo-blocking disabled for development
    setGeoChecked(true);
  }, []);

  if (!geoChecked) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-400">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading Arena...</span>
        </div>
      </div>
    );
  }

  if (geoBlocked) {
    return <GeoBlockScreen />;
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <head>
        <title>Arena - Live Betting Platform</title>
        <meta name="description" content="Watch live feeds and bet on real-world events in real time. Crypto-funded, transparent, and fair." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="bg-gray-950 text-gray-100">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
