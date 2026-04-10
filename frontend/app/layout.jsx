'use client';

import './globals.css';
import { useEffect } from 'react';
import Navbar from '@/components/Navbar';
import { useAuthStore } from '@/hooks/useAuth';

function AppProviders({ children }) {
  const fetchUser = useAuthStore((s) => s.fetchUser);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

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
        <title>Arena</title>
        <meta name="description" content="Bet on cars from around the world." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="bg-gray-950 text-gray-100">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
