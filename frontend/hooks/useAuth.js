'use client';

import { create } from 'zustand';
import { API_URL } from '@/lib/constants';

const useAuthStore = create((set, get) => ({
  user: null,
  token: typeof window !== 'undefined' ? localStorage.getItem('arena_token') : null,
  loading: true,
  error: null,

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('arena_token', token);
    }
    set({ user, token, loading: false, error: null });
  },

  setUser: (user) => set({ user }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  logout: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('arena_token');
    }
    set({ user: null, token: null, loading: false, error: null });
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');
      get().setAuth(data.user, data.token);
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  register: async (username, email, password) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Registration failed');
      get().setAuth(data.user, data.token);
      return data;
    } catch (err) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  fetchUser: async () => {
    const token = get().token;
    if (!token) {
      set({ loading: false });
      return;
    }
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        get().logout();
        return;
      }
      const data = await res.json();
      set({ user: data.user, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));

export function useAuth() {
  const store = useAuthStore();
  return store;
}

export { useAuthStore };
