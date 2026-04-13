#!/usr/bin/env python3
"""
Stream processor — reads a live HLS camera feed, runs YOLO, draws
annotations, and outputs an annotated HLS stream for the frontend.

Also opens a local OpenCV window for real-time debugging.

Usage:
  python stream_processor.py [--camera-url URL] [--show] [--conf 0.25]

Output:
  HLS segments in OUTPUT_DIR (served by the Node API at /api/stream/)
"""

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time

import cv2
import numpy as np
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("stream-processor")

# ─── Config ──────────────────────────────────────────────────
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "api", "stream")
FRAME_W = 960
FRAME_H = 540
FPS = 15
VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

# Counting line (normalized y position)
LINE_Y = 0.6
LINE_Y2 = 0.65

# Colors
GREEN = (52, 211, 153)
AMBER = (21, 204, 250)
RED = (68, 68, 239)
WHITE = (255, 255, 255)


class SimpleTracker:
    """Centroid tracker for line-crossing detection."""

    def __init__(self, max_gone=12, max_dist=70):
        self.next_id = 0
        self.tracks = {}  # id -> {cx, cy, prev_cy, gone, crossed}
        self.max_gone = max_gone
        self.max_dist = max_dist

    def update(self, detections):
        """Update with [(cx, cy, x1, y1, x2, y2, cls, conf), ...]"""
        # Mark all as gone
        for tid in list(self.tracks):
            self.tracks[tid]["gone"] += 1
            if self.tracks[tid]["gone"] > self.max_gone:
                del self.tracks[tid]

        if not detections:
            return self.tracks

        det_centroids = [(d[0], d[1]) for d in detections]
        track_ids = list(self.tracks.keys())

        if not track_ids:
            for d in detections:
                self._add(d)
            return self.tracks

        # Greedy matching
        used_det = set()
        for tid in track_ids:
            t = self.tracks[tid]
            best_j, best_d = -1, self.max_dist
            for j, (cx, cy) in enumerate(det_centroids):
                if j in used_det:
                    continue
                dist = ((t["cx"] - cx) ** 2 + (t["cy"] - cy) ** 2) ** 0.5
                if dist < best_d:
                    best_d = dist
                    best_j = j
            if best_j >= 0:
                d = detections[best_j]
                self.tracks[tid]["prev_cy"] = self.tracks[tid]["cy"]
                self.tracks[tid].update(cx=d[0], cy=d[1], x1=d[2], y1=d[3],
                                         x2=d[4], y2=d[5], cls=d[6], conf=d[7], gone=0)
                used_det.add(best_j)

        for j, d in enumerate(detections):
            if j not in used_det:
                self._add(d)

        return self.tracks

    def _add(self, d):
        self.tracks[self.next_id] = dict(
            cx=d[0], cy=d[1], prev_cy=d[1],
            x1=d[2], y1=d[3], x2=d[4], y2=d[5],
            cls=d[6], conf=d[7], gone=0, crossed=False
        )
        self.next_id += 1

    def check_crosses(self, line_y_px):
        """Returns list of track IDs that just crossed the line."""
        crossed = []
        for tid, t in self.tracks.items():
            if t["crossed"]:
                continue
            if (t["prev_cy"] < line_y_px <= t["cy"]) or (t["prev_cy"] > line_y_px >= t["cy"]):
                t["crossed"] = True
                crossed.append(tid)
        return crossed


def draw_annotations(frame, tracker, count, line_y_px, line_y2_px, conf_threshold):
    """Draw counting lines, bounding boxes, and count badge on the frame."""
    h, w = frame.shape[:2]

    # Gate lines
    cv2.line(frame, (0, line_y_px), (w, line_y_px), GREEN, 2)
    cv2.line(frame, (0, line_y2_px), (w, line_y2_px), AMBER, 2)

    # Zone between lines — subtle overlay
    overlay = frame.copy()
    pts = np.array([[0, line_y_px], [w, line_y_px], [w, line_y2_px], [0, line_y2_px]])
    cv2.fillPoly(overlay, [pts], (153, 211, 52))
    cv2.addWeighted(overlay, 0.1, frame, 0.9, 0, frame)

    # Bounding boxes for tracked vehicles
    for tid, t in tracker.tracks.items():
        if t["gone"] > 2:
            continue
        x1, y1, x2, y2 = int(t["x1"]), int(t["y1"]), int(t["x2"]), int(t["y2"])
        color = RED if t["crossed"] else GREEN
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)

        label = f"#{tid} {VEHICLE_CLASSES.get(t['cls'], '?')} {t['conf']:.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
        cv2.rectangle(frame, (x1, y1 - th - 6), (x1 + tw + 4, y1), color, -1)
        cv2.putText(frame, label, (x1 + 2, y1 - 4), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)

    # Count badge — top right
    badge_text = str(count)
    badge_w, badge_h = 120, 50
    bx, by = w - badge_w - 10, 10
    cv2.rectangle(frame, (bx, by), (bx + badge_w, by + badge_h), (0, 0, 0), -1)
    cv2.rectangle(frame, (bx, by), (bx + badge_w, by + badge_h), GREEN, 2)
    cv2.putText(frame, "CARS", (bx + 8, by + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, WHITE, 1)
    cv2.putText(frame, badge_text, (bx + badge_w - 15 - len(badge_text) * 18, by + 42),
                cv2.FONT_HERSHEY_SIMPLEX, 1.2, WHITE, 2)

    # Config info — bottom left
    cv2.putText(frame, f"conf={conf_threshold:.2f} line={LINE_Y:.2f}",
                (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (180, 180, 180), 1)

    return frame


def run(camera_url, model_name="yolov8n.pt", conf=0.25, show=False):
    """Main processing loop."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    logger.info(f"Loading model: {model_name}")
    model = YOLO(model_name)
    model(np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8), verbose=False)  # warmup
    logger.info("Model ready")

    # Start ffmpeg to output HLS
    hls_output = os.path.join(OUTPUT_DIR, "stream.m3u8")
    ffmpeg_cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24", "-s", f"{FRAME_W}x{FRAME_H}", "-r", str(FPS),
        "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-g", str(FPS * 2), "-keyint_min", str(FPS),
        "-b:v", "1500k", "-maxrate", "2000k", "-bufsize", "3000k",
        "-pix_fmt", "yuv420p",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments+append_list",
        "-hls_segment_filename", os.path.join(OUTPUT_DIR, "seg_%03d.ts"),
        hls_output,
    ]
    ffmpeg_proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    logger.info(f"HLS output: {hls_output}")

    # Open camera stream
    logger.info(f"Opening: {camera_url}")
    cap = cv2.VideoCapture(camera_url)
    if not cap.isOpened():
        logger.error("Failed to open stream")
        return

    tracker = SimpleTracker()
    count = 0
    frame_idx = 0
    line_y_px = int(LINE_Y * FRAME_H)
    line_y2_px = int(LINE_Y2 * FRAME_H)

    logger.info(f"Processing (conf={conf}, show={show})...")
    logger.info("Press 'q' to quit, '+'/'-' to adjust confidence, 'r' to reset count")

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                logger.warning("Stream ended, reconnecting...")
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(camera_url)
                continue

            frame = cv2.resize(frame, (FRAME_W, FRAME_H))

            # Run YOLO every 2nd frame for speed
            if frame_idx % 2 == 0:
                results = model(frame, verbose=False, conf=conf)
                detections = []
                for box in results[0].boxes:
                    cls_id = int(box.cls[0])
                    if cls_id not in VEHICLE_CLASSES:
                        continue
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
                    detections.append((cx, cy, x1, y1, x2, y2, cls_id, float(box.conf[0])))

                tracker.update(detections)
                crossed = tracker.check_crosses(line_y_px)
                count += len(crossed)

            # Draw annotations
            annotated = draw_annotations(frame.copy(), tracker, count, line_y_px, line_y2_px, conf)

            # Write to ffmpeg for HLS output
            try:
                ffmpeg_proc.stdin.write(annotated.tobytes())
            except BrokenPipeError:
                logger.error("ffmpeg pipe broken")
                break

            # Show local window for debugging
            if show:
                cv2.imshow("Stream Processor", annotated)
                key = cv2.waitKey(1) & 0xFF
                if key == ord("q"):
                    break
                elif key == ord("+") or key == ord("="):
                    conf = min(0.9, conf + 0.05)
                    logger.info(f"Confidence: {conf:.2f}")
                elif key == ord("-"):
                    conf = max(0.05, conf - 0.05)
                    logger.info(f"Confidence: {conf:.2f}")
                elif key == ord("r"):
                    count = 0
                    tracker = SimpleTracker()
                    logger.info("Count reset")

            frame_idx += 1

    except KeyboardInterrupt:
        logger.info("Interrupted")
    finally:
        cap.release()
        ffmpeg_proc.stdin.close()
        ffmpeg_proc.wait()
        if show:
            cv2.destroyAllWindows()
        logger.info(f"Final count: {count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Stream processor with YOLO")
    parser.add_argument("--camera-url", default="https://wzmedia.dot.ca.gov/D7/CCTV-340.stream/playlist.m3u8",
                        help="HLS camera URL")
    parser.add_argument("--model", default="yolov8n.pt", help="YOLO model file")
    parser.add_argument("--conf", type=float, default=0.25, help="Detection confidence threshold")
    parser.add_argument("--show", action="store_true", help="Show local OpenCV window")
    args = parser.parse_args()

    run(args.camera_url, args.model, args.conf, args.show)
