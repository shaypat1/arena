'use client';

import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';

export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="sticky top-0 z-50 glass border-b border-gray-700/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-black text-sm">A</span>
            </div>
            <span className="text-xl font-bold text-white tracking-tight">Arena</span>
          </Link>

          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm text-gray-400">{user.username}</span>
                <button onClick={logout} className="text-sm text-gray-500 hover:text-white transition-colors">
                  Log out
                </button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Link href="/login" className="btn-secondary text-sm py-1.5">Log in</Link>
                <Link href="/register" className="btn-primary text-sm py-1.5">Sign up</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
