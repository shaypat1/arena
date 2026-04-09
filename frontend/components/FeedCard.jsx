'use client';

import Link from 'next/link';
import { abbreviateNumber } from '@/lib/format';

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:embed\/|watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export default function FeedCard({ feed }) {
  const videoId = extractYouTubeId(feed.stream_url);
  const thumbnailUrl = videoId
    ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
    : null;

  return (
    <Link href={`/feed/${feed.slug}`} className="group block">
      <div className="card-hover overflow-hidden">
        {/* Thumbnail */}
        <div className="relative aspect-video bg-gray-900 overflow-hidden">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={feed.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600">
              <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            </div>
          )}

          {/* Live badge */}
          <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-1 bg-red-600/90 backdrop-blur-sm rounded-md">
            <span className="w-2 h-2 bg-white rounded-full animate-pulse" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Live</span>
          </div>

          {/* Viewer count */}
          {feed.viewer_count > 0 && (
            <div className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 bg-black/60 backdrop-blur-sm rounded-md">
              <svg className="w-3.5 h-3.5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-xs font-medium text-gray-300">{abbreviateNumber(feed.viewer_count)}</span>
            </div>
          )}

          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-transparent to-transparent" />
        </div>

        {/* Card body */}
        <div className="p-4">
          <h3 className="font-semibold text-white group-hover:text-indigo-400 transition-colors truncate">
            {feed.name}
          </h3>
          {feed.location && (
            <p className="text-sm text-gray-500 mt-0.5 truncate">{feed.location}</p>
          )}

          {/* Active bet types */}
          {feed.bet_types && feed.bet_types.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {feed.bet_types.map((bt) => (
                <span
                  key={bt.id || bt.slug || bt}
                  className="badge-blue text-[11px]"
                >
                  {bt.label || bt.name || bt}
                </span>
              ))}
            </div>
          )}

          {/* Active rounds indicator */}
          {feed.active_rounds_count > 0 && (
            <div className="flex items-center gap-1.5 mt-3">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">
                {feed.active_rounds_count} active round{feed.active_rounds_count !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
