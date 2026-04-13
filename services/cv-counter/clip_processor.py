"""
Clip-based car counter.

Downloads a ~15s clip from a camera HLS stream, runs YOLOv8 on it,
counts cars crossing a gate line, and saves the clip + timestamped
count events so the frontend can play them back in perfect sync.

Output:
  - clips/{round_id}.mp4  — the raw video clip
  - clips/{round_id}.json — timestamped count events + final result
"""

import json
import logging
import os
import subprocess
import time
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("cv-counter.clip")

CLIPS_DIR = os.environ.get("CLIPS_DIR", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "api", "clips"
))
FRAME_W = 960
FRAME_H = 540
CLIP_DURATION = 15  # seconds
VEHICLE_CLASSES = {2, 3, 5, 7}  # car, motorcycle, bus, truck


class SimpleTracker:
    """Minimal centroid tracker for counting line crossings."""

    def __init__(self, max_disappeared=10, max_distance=80):
        self.next_id = 0
        self.objects = {}  # id -> (cx, cy, prev_cy)
        self.disappeared = {}
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance
        self.crossed = set()  # track ids that crossed the line

    def update(self, detections):
        """Update with list of (cx, cy) centroids. Returns {id: (cx, cy)}."""
        if len(detections) == 0:
            for oid in list(self.disappeared):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    del self.objects[oid]
                    del self.disappeared[oid]
            return self.objects

        if len(self.objects) == 0:
            for (cx, cy) in detections:
                self.objects[self.next_id] = (cx, cy, cy)
                self.disappeared[self.next_id] = 0
                self.next_id += 1
            return self.objects

        obj_ids = list(self.objects.keys())
        obj_centroids = [(self.objects[oid][0], self.objects[oid][1]) for oid in obj_ids]

        # Simple greedy nearest-neighbor matching
        used_det = set()
        used_obj = set()
        pairs = []

        for i, (ox, oy) in enumerate(obj_centroids):
            best_j = -1
            best_dist = self.max_distance
            for j, (dx, dy) in enumerate(detections):
                if j in used_det:
                    continue
                dist = ((ox - dx) ** 2 + (oy - dy) ** 2) ** 0.5
                if dist < best_dist:
                    best_dist = dist
                    best_j = j
            if best_j >= 0:
                pairs.append((i, best_j))
                used_det.add(best_j)
                used_obj.add(i)

        for i, j in pairs:
            oid = obj_ids[i]
            cx, cy = detections[j]
            prev_cy = self.objects[oid][1]
            self.objects[oid] = (cx, cy, prev_cy)
            self.disappeared[oid] = 0

        for i in range(len(obj_ids)):
            if i not in used_obj:
                oid = obj_ids[i]
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    del self.objects[oid]
                    del self.disappeared[oid]

        for j in range(len(detections)):
            if j not in used_det:
                cx, cy = detections[j]
                self.objects[self.next_id] = (cx, cy, cy)
                self.disappeared[self.next_id] = 0
                self.next_id += 1

        return self.objects

    def check_line_cross(self, line_y):
        """Check if any tracked object crossed a horizontal line. Returns newly crossed IDs."""
        newly_crossed = []
        for oid, (cx, cy, prev_cy) in self.objects.items():
            if oid in self.crossed:
                continue
            if (prev_cy < line_y <= cy) or (prev_cy > line_y >= cy):
                self.crossed.add(oid)
                newly_crossed.append(oid)
        return newly_crossed


def download_clip(hls_url, output_path, duration=CLIP_DURATION):
    """Download a clip from an HLS stream using ffmpeg. Returns True on success."""
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "warning",
            "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "-i", hls_url,
            "-t", str(duration),
            "-c:v", "libx264", "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-an",
            "-y", output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            logger.error(f"ffmpeg failed: {result.stderr[:200]}")
            return False
        return os.path.exists(output_path) and os.path.getsize(output_path) > 1000
    except Exception as e:
        logger.error(f"Download failed: {e}")
        return False


def process_clip(model, clip_path, roi_geometry):
    """Run YOLO on every frame of the clip. Returns (count, timeline, outcome)."""
    cap = cv2.VideoCapture(clip_path)
    if not cap.isOpened():
        return 0, [], "zero"

    fps = cap.get(cv2.CAP_PROP_FPS) or 15
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Parse ROI — get the horizontal line Y position (normalized)
    roi = json.loads(roi_geometry) if isinstance(roi_geometry, str) else roi_geometry
    if roi and "line_a" in roi:
        line_y_norm = (roi["line_a"][0][1] + roi["line_a"][1][1]) / 2
    else:
        line_y_norm = 0.6  # default: 60% of frame height

    line_y = int(line_y_norm * FRAME_H)

    tracker = SimpleTracker(max_disappeared=15, max_distance=60)
    timeline = []  # [{time: 2.3, count: 1}, ...]
    count = 0
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame = cv2.resize(frame, (FRAME_W, FRAME_H))
        timestamp = frame_idx / fps

        # Run YOLO every 3rd frame for speed
        if frame_idx % 3 == 0:
            results = model(frame, verbose=False, conf=0.25)
            detections = []
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                if cls_id not in VEHICLE_CLASSES:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx = (x1 + x2) / 2
                cy = (y1 + y2) / 2
                detections.append((cx, cy))

            tracker.update(detections)
            newly_crossed = tracker.check_line_cross(line_y)

            for _ in newly_crossed:
                count += 1
                timeline.append({"time": round(timestamp, 2), "count": count})

        frame_idx += 1

    cap.release()

    # Determine outcome
    if count == 0:
        outcome = "zero"
    elif count % 2 == 0:
        outcome = "even"
    else:
        outcome = "odd"

    return count, timeline, outcome


def process_round(model, round_id, camera_url, roi_geometry, redis_client=None):
    """
    Full pipeline: download clip → run CV → save results → publish settlement.
    Returns (clip_path, result_json) or (None, None) on failure.
    """
    Path(CLIPS_DIR).mkdir(parents=True, exist_ok=True)

    clip_path = os.path.join(CLIPS_DIR, f"{round_id}.mp4")
    result_path = os.path.join(CLIPS_DIR, f"{round_id}.json")

    logger.info(f"Downloading clip for round {round_id[:8]}...")
    t0 = time.time()

    if not download_clip(camera_url, clip_path):
        logger.error(f"Failed to download clip for round {round_id[:8]}")
        return None, None

    download_time = time.time() - t0
    logger.info(f"Clip downloaded in {download_time:.1f}s")

    logger.info(f"Processing clip for round {round_id[:8]}...")
    t0 = time.time()
    count, timeline, outcome = process_clip(model, clip_path, roi_geometry)
    process_time = time.time() - t0
    logger.info(f"Processed in {process_time:.1f}s: count={count} outcome={outcome}")

    result = {
        "round_id": round_id,
        "car_count": count,
        "outcome": outcome,
        "timeline": timeline,
        "clip_url": f"/api/clips/{round_id}.mp4",
        "download_time": round(download_time, 2),
        "process_time": round(process_time, 2),
    }

    with open(result_path, "w") as f:
        json.dump(result, f)

    # Publish settlement event to Redis
    if redis_client:
        settlement = {
            "round_id": round_id,
            "feed_id": "10000000-0000-0000-0000-000000000001",
            "bet_type_slug": "car-count",
            "outcome": outcome,
            "confidence": 0.95,
            "detection_data": {
                "car_count": count,
                "timeline": timeline,
                "clip_url": result["clip_url"],
            },
            "frame_url": result["clip_url"],
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        }
        redis_client.publish("settlement", json.dumps(settlement))
        logger.info(f"Published settlement for round {round_id[:8]}: {outcome} ({count} cars)")

    return clip_path, result
