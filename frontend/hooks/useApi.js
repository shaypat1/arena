'use client';

import { useCallback } from 'react';
import { API_URL } from '@/lib/constants';
import { useAuth } from './useAuth';

export function useApi() {
  const { token, logout } = useAuth();

  const request = useCallback(
    async (path, options = {}) => {
      const url = `${API_URL}${path}`;
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch(url, {
        ...options,
        headers,
      });

      if (res.status === 401) {
        logout();
        throw new Error('Session expired. Please log in again.');
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || `Request failed (${res.status})`);
      }

      return data;
    },
    [token, logout]
  );

  const get = useCallback((path) => request(path), [request]);

  const post = useCallback(
    (path, body) =>
      request(path, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    [request]
  );

  const put = useCallback(
    (path, body) =>
      request(path, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    [request]
  );

  const del = useCallback(
    (path) =>
      request(path, {
        method: 'DELETE',
      }),
    [request]
  );

  return { get, post, put, del, request };
}
