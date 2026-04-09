'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

const DETECTOR_URL = 'http://localhost:3002';
const POLL_INTERVAL = 2000;

export function useCarDetector(videoRef, enabled = true) {
  const intervalRef = useRef(null);
  const [carCount, setCarCount] = useState(0);
  const [detections, setDetections] = useState([]);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;

    async function poll() {
      try {
        const res = await fetch(`${DETECTOR_URL}/detections`);
        const data = await res.json();
        setCarCount(data.cars || 0);
        setDetections(data.detections || []);
        if (!modelLoaded) {
          setModelLoaded(true);
          setLoading(false);
        }
      } catch {
        // Server not up yet
      }
    }

    // Check health first
    fetch(`${DETECTOR_URL}/health`)
      .then((r) => r.json())
      .then(() => { setModelLoaded(true); setLoading(false); })
      .catch(() => { setLoading(true); });

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [enabled, modelLoaded]);

  const reset = useCallback(() => {
    setCarCount(0);
    setDetections([]);
  }, []);

  return { carCount, detections, modelLoaded, loading, reset };
}
