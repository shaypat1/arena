'use client';

import { useRef, useEffect, useState } from 'react';

export default function FrameViewer({ frameUrl, boundingBox, detectedColor, confidence }) {
  const canvasRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef(null);

  useEffect(() => {
    if (!frameUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
      drawFrame(img);
    };
    img.src = frameUrl;
  }, [frameUrl]);

  useEffect(() => {
    if (imageLoaded && imgRef.current) {
      drawFrame(imgRef.current);
    }
  }, [imageLoaded, boundingBox]);

  function drawFrame(img) {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    ctx.drawImage(img, 0, 0);

    // Draw bounding box if available
    if (boundingBox) {
      const { x, y, width, height } = boundingBox;
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      // Label background
      ctx.fillStyle = 'rgba(99, 102, 241, 0.85)';
      const labelHeight = 24;
      ctx.fillRect(x, y - labelHeight, width, labelHeight);

      // Label text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px monospace';
      ctx.textBaseline = 'middle';
      const label = detectedColor
        ? `${detectedColor} (${((confidence || 0) * 100).toFixed(0)}%)`
        : 'Detection';
      ctx.fillText(label, x + 6, y - labelHeight / 2);
    }
  }

  if (!frameUrl) {
    return (
      <div className="aspect-video bg-gray-900 rounded-lg flex items-center justify-center text-gray-600">
        <p className="text-sm">No settlement frame available</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-lg overflow-hidden bg-gray-900">
      {!imageLoaded && (
        <div className="aspect-video skeleton" />
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-auto"
        style={{ display: imageLoaded ? 'block' : 'none' }}
      />
    </div>
  );
}
