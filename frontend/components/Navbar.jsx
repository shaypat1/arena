'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import BalanceDisplay from './BalanceDisplay';
import clsx from 'clsx';

export default function Navbar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navLinks = [
    { href: '/', label: 'Feeds' },
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/transparency', label: 'Transparency' },
  ];

  return (
    <nav className="sticky top-0 z-50 glass border-b border-gray-700/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">A</span>
            </div>
            <span className="text-xl font-bold text-white tracking-tight hidden sm:block">
              Arena
            </span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={clsx(
                  'px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'text-white bg-gray-700/50'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <BalanceDisplay />
                <Link
                  href="/deposit"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600/20
                             text-emerald-400 text-sm font-medium rounded-lg hover:bg-emerald-600/30 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Deposit
                </Link>
                <Link
                  href="/profile"
                  className={clsx(
                    'hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                    pathname === '/profile'
                      ? 'text-white bg-gray-700/50'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  )}
                >
                  <div className="w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center">
                    <span className="text-xs font-bold text-white">
                      {user.username?.[0]?.toUpperCase() || 'U'}
                    </span>
                  </div>
                  <span className="hidden lg:inline">{user.username}</span>
                </Link>
              </>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link href="/login" className="btn-secondary text-sm py-1.5">
                  Log in
                </Link>
                <Link href="/register" className="btn-primary text-sm py-1.5">
                  Sign up
                </Link>
              </div>
            )}

            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800/50"
            >
              {mobileMenuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-gray-700/40 bg-gray-900/95 backdrop-blur-sm animate-slide-down">
          <div className="px-4 py-3 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={clsx(
                  'block px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  pathname === link.href
                    ? 'text-white bg-gray-700/50'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                {link.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white"
                >
                  Profile
                </Link>
                <Link
                  href="/deposit"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-emerald-400 hover:text-emerald-300"
                >
                  Deposit
                </Link>
                <Link
                  href="/withdraw"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white"
                >
                  Withdraw
                </Link>
                <button
                  onClick={() => {
                    logout();
                    setMobileMenuOpen(false);
                  }}
                  className="block w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-red-400 hover:text-red-300"
                >
                  Log out
                </button>
              </>
            ) : (
              <div className="flex gap-2 pt-2">
                <Link
                  href="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 btn-secondary text-sm text-center"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex-1 btn-primary text-sm text-center"
                >
                  Sign up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
