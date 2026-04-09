'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { formatChatTime } from '@/lib/format';
import clsx from 'clsx';

export default function ChatPanel({ messages, onSend, connected }) {
  const { user } = useAuth();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  }

  function handleSubmit(e) {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || !user) return;
    onSend(msg);
    setInput('');
  }

  return (
    <div className="card flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">Chat</h3>
          <span
            className={clsx(
              'w-2 h-2 rounded-full',
              connected ? 'bg-emerald-400' : 'bg-gray-600'
            )}
          />
        </div>
        <span className="text-xs text-gray-500">
          {messages.length} messages
        </span>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-2 hide-scrollbar min-h-0"
      >
        {messages.length === 0 && (
          <div className="text-center text-gray-600 text-sm py-8">
            No messages yet. Be the first!
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={msg.id || i} className="animate-fade-in">
            <div className="flex items-baseline gap-2">
              <span
                className={clsx(
                  'text-xs font-semibold',
                  msg.username === user?.username ? 'text-indigo-400' : 'text-emerald-400'
                )}
              >
                {msg.username || 'anon'}
              </span>
              <span className="text-[10px] text-gray-600 tabular-nums">
                {formatChatTime(msg.timestamp || msg.created_at)}
              </span>
            </div>
            <p className="text-sm text-gray-300 break-words">{msg.message || msg.text}</p>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom */}
      {!autoScroll && messages.length > 5 && (
        <button
          onClick={() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            setAutoScroll(true);
          }}
          className="mx-3 mb-2 py-1 text-xs text-indigo-400 bg-indigo-500/10 rounded-lg hover:bg-indigo-500/20 transition-colors"
        >
          Scroll to bottom
        </button>
      )}

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-gray-700/50">
        {user ? (
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Say something..."
              maxLength={200}
              className="flex-1 px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-sm text-gray-100
                         placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-600
                         text-white rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="text-center text-sm text-gray-500">
            <a href="/login" className="text-indigo-400 hover:text-indigo-300">Log in</a> to chat
          </p>
        )}
      </form>
    </div>
  );
}
