'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/hooks/useApi';

export default function AdminCamerasPage() {
  const { get } = useApi();
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      try {
        const data = await get('/api/admin/cameras');
        setCameras(data.cameras || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [get]);

  const withRoi = cameras.filter((c) => c.roi_geometry);
  const withoutRoi = cameras.filter((c) => !c.roi_geometry);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Camera ROI Editor</h1>
          <p className="text-sm text-gray-500 mt-1">
            Draw counting zones on each camera. Only cameras with an ROI are eligible for rounds.
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-400 hover:text-white">← Back</Link>
      </div>

      {loading && <div className="text-gray-500">Loading…</div>}
      {error && <div className="text-red-400">{error}</div>}

      {!loading && !error && (
        <>
          <Section
            title={`Configured (${withRoi.length})`}
            subtitle="Cameras with an ROI. These are rotated through live rounds."
            cameras={withRoi}
          />
          <Section
            title={`Unconfigured (${withoutRoi.length})`}
            subtitle="No ROI set yet. Click to draw one."
            cameras={withoutRoi}
          />
        </>
      )}
    </div>
  );
}

function Section({ title, subtitle, cameras }) {
  if (cameras.length === 0) return null;
  return (
    <div className="mb-10">
      <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
      <p className="text-xs text-gray-500 mb-4">{subtitle}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cameras.map((c) => (
          <Link
            key={c.id}
            href={`/admin/cameras/${c.id}`}
            className="block bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-indigo-500/50 hover:bg-gray-800/60 transition-all"
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="font-semibold text-white text-sm">{c.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 font-mono">{c.external_id}</p>
              </div>
              {c.roi_geometry ? (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
                  ROI
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-gray-800 border border-gray-700 text-gray-500 text-xs">
                  none
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{c.source}</span>
              <span>·</span>
              <span>{c.timezone || 'no tz'}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
