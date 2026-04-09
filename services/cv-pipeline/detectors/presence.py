"""
presence.py -- Binary event (yes / no) presence detector.

Pipeline:
  1. Operator defines a zone (polygon or rectangle) within the frame.
  2. YOLOv8 runs object detection every frame.
  3. If a target-class object is detected *within* the zone during the
     observation window, the outcome is "yes"; otherwise "no".
  4. Result is emitted once the window expires.
"""

import logging
import time
from typing import Optional

import numpy as np

logger = logging.getLogger("cv-pipeline.detectors.presence")

# COCO class IDs: 0=person, 2=car, 16=dog, 15=cat, etc.
DEFAULT_TARGET_CLASSES = {0}  # person by default

DEFAULT_WINDOW_SECONDS = 60


def _box_centre(x1: float, y1: float, x2: float, y2: float):
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _point_in_rect(px: float, py: float, zone: dict) -> bool:
    """Check if (px, py) falls inside a rectangular zone."""
    zx = zone.get("x", 0)
    zy = zone.get("y", 0)
    zw = zone.get("w", 9999)
    zh = zone.get("h", 9999)
    return zx <= px <= zx + zw and zy <= py <= zy + zh


class PresenceDetector:
    """Detect whether a target object is present in a defined zone
    within the observation window.

    Settlement: "yes" if at least one qualifying detection occurred
    during the window, "no" otherwise.
    """

    def __init__(self, model, config: Optional[dict] = None):
        """
        Parameters
        ----------
        model : ultralytics.YOLO
            Shared YOLOv8 model instance.
        config : dict, optional
            Expected keys:
            - zone: {x, y, w, h} rectangular zone in pixels
            - target_classes: list of COCO class IDs to look for
            - window_seconds: observation window length
            - min_confidence: detection confidence floor
        """
        self.model = model
        self.config = config or {}
        self.zone = self.config.get("zone", {"x": 0, "y": 0, "w": 9999, "h": 9999})
        self.target_classes = set(
            self.config.get("target_classes", DEFAULT_TARGET_CLASSES)
        )
        self.window_seconds = self.config.get("window_seconds", DEFAULT_WINDOW_SECONDS)
        self.min_confidence = self.config.get("min_confidence", 0.35)

        self._window_start: Optional[float] = None
        self._detected = False
        self._best_confidence = 0.0
        self._detection_count = 0

    def process_frame(self, frame: np.ndarray) -> Optional[dict]:
        """Process one BGR frame.

        Returns a result dict when the window ends, otherwise None.
        """
        now = time.monotonic()

        if self._window_start is None:
            self._window_start = now
            self._detected = False
            self._best_confidence = 0.0
            self._detection_count = 0
            logger.info("Presence window started (%.0fs)", self.window_seconds)

        # Run detection
        results = self.model(frame, verbose=False)
        if results and len(results[0].boxes) > 0:
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                conf = float(box.conf[0])
                if cls_id not in self.target_classes:
                    continue
                if conf < self.min_confidence:
                    continue

                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx, cy = _box_centre(x1, y1, x2, y2)

                if _point_in_rect(cx, cy, self.zone):
                    self._detected = True
                    self._detection_count += 1
                    if conf > self._best_confidence:
                        self._best_confidence = conf

        elapsed = now - self._window_start
        if elapsed < self.window_seconds:
            return None

        # Window complete
        outcome = "yes" if self._detected else "no"
        confidence = self._best_confidence if self._detected else 0.85

        logger.info(
            "Presence window complete  detected=%s  count=%d  conf=%.2f",
            self._detected,
            self._detection_count,
            confidence,
        )

        result = {
            "outcome": outcome,
            "confidence": round(confidence, 4),
            "detection_data": {
                "detected": self._detected,
                "detection_count": self._detection_count,
                "zone": self.zone,
                "target_classes": sorted(self.target_classes),
                "window_seconds": self.window_seconds,
            },
        }

        # Reset for next window
        self._window_start = None
        self._detected = False
        self._best_confidence = 0.0
        self._detection_count = 0

        return result
