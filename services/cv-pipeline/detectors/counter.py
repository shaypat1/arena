"""
counter.py -- Object counting detector with simple centroid tracking.

Pipeline:
  1. Run YOLOv8-nano to detect persons in each frame.
  2. Track unique objects using a centroid-based tracker that assigns
     persistent IDs across frames.
  3. At the end of a counting window, emit the total unique count
     and resolve "over" / "under" against the threshold.
"""

import logging
import math
import time
from collections import OrderedDict
from typing import Optional

import numpy as np

logger = logging.getLogger("cv-pipeline.detectors.counter")

# COCO class ID for person
PERSON_CLASS_ID = 0

DEFAULT_THRESHOLD = 12.5
DEFAULT_WINDOW_SECONDS = 60
# Max distance (pixels) to consider two centroids the same object
DEFAULT_MAX_DISAPPEARED = 15  # frames before dropping a track
DEFAULT_MAX_DISTANCE = 80  # pixels


class CentroidTracker:
    """Simple centroid-based multi-object tracker.

    Assigns a monotonically increasing ID to each new object and
    matches detections across frames by nearest-centroid distance.
    """

    def __init__(self, max_disappeared: int = DEFAULT_MAX_DISAPPEARED,
                 max_distance: float = DEFAULT_MAX_DISTANCE):
        self.next_id = 0
        self.objects: OrderedDict[int, np.ndarray] = OrderedDict()
        self.disappeared: OrderedDict[int, int] = OrderedDict()
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

    @property
    def total_registered(self) -> int:
        """Total number of unique IDs ever assigned."""
        return self.next_id

    def reset(self):
        """Clear all tracks and reset the ID counter."""
        self.next_id = 0
        self.objects.clear()
        self.disappeared.clear()

    def update(self, detections: list[tuple[float, float]]) -> OrderedDict:
        """Update tracker with a list of (cx, cy) centroids.

        Returns the current mapping of object_id -> centroid.
        """
        if len(detections) == 0:
            for oid in list(self.disappeared.keys()):
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)
            return self.objects

        input_centroids = np.array(detections, dtype=np.float32)

        if len(self.objects) == 0:
            for centroid in input_centroids:
                self._register(centroid)
            return self.objects

        object_ids = list(self.objects.keys())
        object_centroids = np.array(list(self.objects.values()), dtype=np.float32)

        # Pairwise distance matrix
        dist = np.linalg.norm(
            object_centroids[:, np.newaxis] - input_centroids[np.newaxis, :],
            axis=2,
        )

        # Greedy matching: row = existing object, col = new detection
        rows = dist.min(axis=1).argsort()
        cols = dist.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue
            if dist[row, col] > self.max_distance:
                continue
            oid = object_ids[row]
            self.objects[oid] = input_centroids[col]
            self.disappeared[oid] = 0
            used_rows.add(row)
            used_cols.add(col)

        # Handle unmatched existing objects
        for row in range(len(object_ids)):
            if row not in used_rows:
                oid = object_ids[row]
                self.disappeared[oid] += 1
                if self.disappeared[oid] > self.max_disappeared:
                    self._deregister(oid)

        # Register new detections
        for col in range(len(input_centroids)):
            if col not in used_cols:
                self._register(input_centroids[col])

        return self.objects

    def _register(self, centroid: np.ndarray):
        self.objects[self.next_id] = centroid
        self.disappeared[self.next_id] = 0
        self.next_id += 1

    def _deregister(self, oid: int):
        del self.objects[oid]
        del self.disappeared[oid]


class CounterDetector:
    """Count unique persons (or other objects) over a time window and
    settle as "over" or "under" relative to a threshold.
    """

    def __init__(self, model, config: Optional[dict] = None):
        self.model = model
        self.config = config or {}
        self.threshold = self.config.get("threshold", DEFAULT_THRESHOLD)
        self.window_seconds = self.config.get("window_seconds", DEFAULT_WINDOW_SECONDS)
        self.min_confidence = self.config.get("min_person_confidence", 0.30)
        self.target_class = self.config.get("target_class_id", PERSON_CLASS_ID)

        self.tracker = CentroidTracker(
            max_disappeared=self.config.get("max_disappeared", DEFAULT_MAX_DISAPPEARED),
            max_distance=self.config.get("max_distance", DEFAULT_MAX_DISTANCE),
        )
        self._window_start: Optional[float] = None

    def process_frame(self, frame: np.ndarray) -> Optional[dict]:
        """Process a frame.  Returns a result dict at window end, else None."""
        now = time.monotonic()

        # Start a new window if needed
        if self._window_start is None:
            self._window_start = now
            self.tracker.reset()
            logger.info("Counter window started (%.0fs)", self.window_seconds)

        # Detect persons
        results = self.model(frame, verbose=False)
        centroids = []
        if results and len(results[0].boxes) > 0:
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id != self.target_class or conf < self.min_confidence:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx = (x1 + x2) / 2.0
                cy = (y1 + y2) / 2.0
                centroids.append((cx, cy))

        self.tracker.update(centroids)

        elapsed = now - self._window_start
        if elapsed < self.window_seconds:
            return None

        # Window complete -- emit result
        count = self.tracker.total_registered
        outcome = "over" if count > self.threshold else "under"

        # Confidence heuristic: higher when count is far from threshold
        distance_from_threshold = abs(count - self.threshold)
        confidence = min(0.99, 0.70 + 0.03 * distance_from_threshold)

        logger.info(
            "Counter window complete  count=%d  threshold=%.1f  outcome=%s  conf=%.2f",
            count, self.threshold, outcome, confidence,
        )

        result = {
            "outcome": outcome,
            "confidence": round(confidence, 4),
            "detection_data": {
                "pedestrian_count": count,
                "threshold": self.threshold,
                "counted_objects": count,
                "window_seconds": self.window_seconds,
            },
        }

        # Reset for next window
        self._window_start = None
        self.tracker.reset()

        return result
