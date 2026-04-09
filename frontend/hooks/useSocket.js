'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '@/lib/constants';
import { useAuthStore } from './useAuth';

let socketInstance = null;

function getSocket() {
  if (!socketInstance) {
    const token =
      typeof window !== 'undefined' ? localStorage.getItem('arena_token') : null;
    socketInstance = io(SOCKET_URL, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket', 'polling'],
    });
  }
  return socketInstance;
}

export function useSocket(feedId) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [chatMessages, setChatMessages] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [oddsMap, setOddsMap] = useState({});
  const [settlement, setSettlement] = useState(null);
  const [betResult, setBetResult] = useState(null);

  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    if (token) {
      socket.auth = { token };
    }

    if (!socket.connected) {
      socket.connect();
    }

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    if (socket.connected) {
      setConnected(true);
    }

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [token]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !feedId) return;

    socket.emit('join:feed', { feed_id: feedId });

    const onViewers = (data) => {
      if (data.feed_id === feedId) {
        setViewers(data.count);
      }
    };

    const onChat = (msg) => {
      setChatMessages((prev) => [...prev.slice(-200), msg]);
    };

    const onRoundOpened = (data) => {
      const round = { ...data, id: data.round_id || data.id, status: 'open', state: 'open' };
      setRounds((prev) => {
        const filtered = prev.filter((r) => r.id !== round.id);
        return [...filtered, round];
      });
    };

    const onRoundLocked = (data) => {
      setRounds((prev) =>
        prev.map((r) => (r.id === data.round_id ? { ...r, status: 'locked', state: 'locked' } : r))
      );
    };

    const onRoundSettled = (data) => {
      setSettlement(data);
      setRounds((prev) => prev.filter((r) => r.id !== data.round_id));
      setTimeout(() => setSettlement(null), 8000);
    };

    const onOddsUpdated = (data) => {
      setOddsMap((prev) => ({
        ...prev,
        [data.round_id]: data.odds,
      }));
    };

    const onBetResult = (data) => {
      setBetResult(data);
      setTimeout(() => setBetResult(null), 6000);
    };

    const onBalance = () => {
      // Balance updates are handled globally via the auth store refetch
    };

    socket.on('feed:viewers', onViewers);
    socket.on('chat:message', onChat);
    socket.on('round:opened', onRoundOpened);
    socket.on('round:locked', onRoundLocked);
    socket.on('round:settled', onRoundSettled);
    socket.on('odds:updated', onOddsUpdated);
    socket.on('bet:result', onBetResult);
    socket.on('user:balance', onBalance);

    return () => {
      socket.emit('leave:feed', { feed_id: feedId });
      socket.off('feed:viewers', onViewers);
      socket.off('chat:message', onChat);
      socket.off('round:opened', onRoundOpened);
      socket.off('round:locked', onRoundLocked);
      socket.off('round:settled', onRoundSettled);
      socket.off('odds:updated', onOddsUpdated);
      socket.off('bet:result', onBetResult);
      socket.off('user:balance', onBalance);
      setChatMessages([]);
      setRounds([]);
      setOddsMap({});
    };
  }, [feedId]);

  const sendChat = useCallback(
    (message) => {
      const socket = socketRef.current;
      if (socket && feedId) {
        socket.emit('chat:send', { feed_id: feedId, message });
      }
    },
    [feedId]
  );

  return {
    connected,
    viewers,
    chatMessages,
    rounds,
    oddsMap,
    settlement,
    betResult,
    sendChat,
    clearBetResult: () => setBetResult(null),
    clearSettlement: () => setSettlement(null),
  };
}
