'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import FeedPlayer from '@/components/FeedPlayer';
import CarCountBetting from '@/components/CarCountBetting';
import ChatPanel from '@/components/ChatPanel';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CYCLE_DURATION = 30; // 15s bet + 15s count

export default function FeedPage() {
  const { slug } = useParams();
  const { get } = useApi();

  const [feed, setFeed] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);

  // The current camera + round being shown
  const [currentCamera, setCurrentCamera] = useState(null);
  const [currentRound, setCurrentRound] = useState(null);
  const [timerStart, setTimerStart] = useState(null);

  // Pre-loaded next camera + round (ready to swap in)
  const nextRef = useRef({ camera: null, round: null });
  const preloaded = useRef(false);

  const feedId = feed?.id;
  const { connected, viewers, chatMessages, sendChat } = useSocket(feedId);

  // ─── Load feed on mount ───────────────────────────────
  useEffect(() => {
    async function fetchFeed() {
      try {
        const data = await get(`/api/feeds/${slug}`);
        setFeed(data.feed);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchFeed();
  }, [slug, get]);

  // ─── Fetch a random camera + an open round ────────────
  const fetchNextCameraAndRound = useCallback(async () => {
    if (!feedId) return null;
    try {
      // Get active rounds (each has a random camera assigned)
      const data = await get(`/api/rounds/active/${feedId}`);
      const rounds = data.rounds || [];
      const round = rounds.find(r => r.status === 'open') || rounds[0];
      if (!round) return null;
      return { camera: round.camera, round };
    } catch {
      return null;
    }
  }, [feedId, get]);

  // ─── Start first cycle when feed loads ────────────────
  useEffect(() => {
    if (!feedId) return;
    async function startFirst() {
      const result = await fetchNextCameraAndRound();
      if (result) {
        setCurrentCamera(result.camera);
        setCurrentRound(result.round);
        // timerStart is set by FeedPlayer's onCameraReady callback
      }
    }
    startFirst();
  }, [feedId, fetchNextCameraAndRound]);

  // ─── Pre-load next camera+round during current cycle ──
  useEffect(() => {
    if (!timerStart || !feedId) return;
    preloaded.current = false;

    // At 20s into the cycle, pre-fetch next round
    const preloadTimer = setTimeout(async () => {
      const result = await fetchNextCameraAndRound();
      if (result) {
        nextRef.current = result;
        preloaded.current = true;
      }
    }, 20000);

    return () => clearTimeout(preloadTimer);
  }, [timerStart, feedId, fetchNextCameraAndRound]);

  // ─── When cycle ends (30s), swap to pre-loaded next ───
  useEffect(() => {
    if (!timerStart) return;

    const swapTimer = setTimeout(() => {
      const next = preloaded.current ? nextRef.current : null;
      nextRef.current = { camera: null, round: null };
      preloaded.current = false;

      if (next?.camera) {
        const sameUrl = next.camera.image_url === currentCamera?.image_url;
        setCurrentCamera(next.camera);
        setCurrentRound(next.round);
        if (sameUrl) {
          // Same camera — video won't reload, just restart timer
          setTimerStart(Date.now());
        } else {
          // Different camera — wait for video, but force-start after 4s max
          setTimerStart(null);
          setTimeout(() => {
            setTimerStart(prev => prev || Date.now());
          }, 4000);
        }
      } else {
        // Nothing pre-loaded, fetch now
        fetchNextCameraAndRound().then(result => {
          if (result) {
            const sameUrl = result.camera?.image_url === currentCamera?.image_url;
            setCurrentCamera(result.camera);
            setCurrentRound(result.round);
            if (sameUrl) {
              setTimerStart(Date.now());
            } else {
              setTimerStart(null);
              setTimeout(() => {
                setTimerStart(prev => prev || Date.now());
              }, 4000);
            }
          } else {
            // Fallback: just restart timer with current camera
            setTimerStart(Date.now());
          }
        });
      }
    }, CYCLE_DURATION * 1000);

    return () => clearTimeout(swapTimer);
  }, [timerStart, fetchNextCameraAndRound, currentCamera]);

  // ─── Camera URL for FeedPlayer ────────────────────────
  const cameraUrl = currentCamera?.image_url || feed?.stream_url;
  const cameraName = currentCamera?.name || feed?.name;

  // Reveal the feed after 15s (betting phase over)
  const elapsed = timerStart ? (Date.now() - timerStart) / 1000 : 0;
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!timerStart) { setRevealed(false); return; }
    setRevealed(false);
    const revealTimer = setTimeout(() => setRevealed(true), 15000);
    return () => clearTimeout(revealTimer);
  }, [timerStart]);

  function handleCameraReady() {
    setTimerStart(Date.now());
  }

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2"><div className="aspect-video skeleton rounded-xl" /></div>
          <div><div className="h-[400px] skeleton rounded-xl" /></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="card p-8 text-center max-w-md mx-auto">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/" className="btn-secondary">Back to feeds</a>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 lg:py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">{feed?.name}</h1>
          <p className="text-sm text-gray-500">{feed?.description}</p>
        </div>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2 h-2 bg-emerald-400 rounded-full" />
            {viewers} watching
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <FeedPlayer
            streamUrl={cameraUrl}
            feedName={cameraName}
            onCameraReady={handleCameraReady}
            revealed={revealed}
          />
          <div className="hidden lg:block h-[280px]">
            <ChatPanel messages={chatMessages} onSend={sendChat} connected={connected} />
          </div>
        </div>

        <div className="space-y-4">
          <CarCountBetting
            round={currentRound}
            timerStart={timerStart}
            cameraName={cameraName}
          />
        </div>
      </div>

      <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40">
        {chatOpen && (
          <div className="h-[50vh] bg-gray-900 border-t border-gray-700/50">
            <ChatPanel messages={chatMessages} onSend={sendChat} connected={connected} />
          </div>
        )}
        <button onClick={() => setChatOpen(!chatOpen)}
          className="w-full py-3 bg-gray-800 border-t border-gray-700/50 text-sm font-medium text-gray-400 flex items-center justify-center gap-2">
          {chatOpen ? 'Close Chat' : `Chat (${chatMessages.length})`}
        </button>
      </div>
    </div>
  );
}
