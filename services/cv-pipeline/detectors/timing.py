"""
timing.py -- Traffic light state detection.

Strategy:
  1. The operator defines a rectangular region-of-interest (ROI) that
     contains the traffic light in the camera feed.
  2. The ROI is split into three horizontal bands (top = red, middle =
     yellow, bottom = green).
  3. Each band is converted to HSV and the mean V (brightness) channel
     is checked against thresholds.
  4. The band with the highest brightness that exceeds the minimum
     threshold is declared the active state.

This is a simple pixel-brightness approach that works well for
fixed-camera feeds where the traffic light position does not change.
"""

import logging
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("cv-pipeline.detectors.timing")

# Default ROI covers the full frame (operator should override)
DEFAULT_ROI = {"x": 0, "y": 0, "w": 100, "h": 300}

# Minimum mean brightness for a band to be considered "on"
DEFAULT_MIN_BRIGHTNESS = 120

STATES = ("red", "yellow", "green")


class TimingDetector:
    """Detect the current state of a traffic light (red / yellow / green).

    Designed for feeds where the traffic-light position is fixed and
    known ahead of time.  The detector emits a result on every frame
    (the feed_worker decides when settlement should happen, e.g. on
    state transition).
    """

    def __init__(self, model, config: Optional[dict] = None):
        """
        Parameters
        ----------
        model : ultralytics.YOLO
            Provided for interface consistency; not used by this detector.
        config : dict, optional
            Expected keys:
            - roi: {x, y, w, h} pixel region of the traffic light
            - min_brightness: int threshold for V channel
        """
        self.model = model  # unused, kept for interface compatibility
        self.config = config or {}
        self.roi = self.config.get("roi", DEFAULT_ROI)
        self.min_brightness = self.config.get("min_brightness", DEFAULT_MIN_BRIGHTNESS)
        self._prev_state: Optional[str] = None

    def process_frame(self, frame: np.ndarray) -> Optional[dict]:
        """Analyse a single frame.

        Returns a result dict when the traffic-light state changes
        (or on first detection).  Returns None when the state is
        unchanged, to avoid redundant settlements.
        """
        x = self.roi["x"]
        y = self.roi["y"]
        w = self.roi["w"]
        h = self.roi["h"]

        # Clamp to frame bounds
        fh, fw = frame.shape[:2]
        x = max(0, min(x, fw - 1))
        y = max(0, min(y, fh - 1))
        w = min(w, fw - x)
        h = min(h, fh - y)

        if w < 3 or h < 9:
            return None

        roi_bgr = frame[y : y + h, x : x + w]
        roi_hsv = cv2.cvtColor(roi_bgr, cv2.COLOR_BGR2HSV)

        band_h = h // 3
        bands = {
            "red": roi_hsv[0:band_h, :, :],
            "yellow": roi_hsv[band_h : 2 * band_h, :, :],
            "green": roi_hsv[2 * band_h : 3 * band_h, :, :],
        }

        brightness = {}
        for state_name, band in bands.items():
            # Mean brightness (V channel)
            brightness[state_name] = float(np.mean(band[:, :, 2]))

        # Find the brightest band that exceeds the threshold
        active_state = None
        active_brightness = 0.0
        for state_name in STATES:
            b = brightness[state_name]
            if b >= self.min_brightness and b > active_brightness:
                active_state = state_name
                active_brightness = b

        if active_state is None:
            # No band is bright enough -- ambiguous
            return None

        # Only emit on state *change* to avoid flooding
        if active_state == self._prev_state:
            return None

        prev = self._prev_state
        self._prev_state = active_state

        # Confidence proportional to how clearly the winning band
        # outshines the others
        other_max = max(
            b for s, b in brightness.items() if s != active_state
        )
        separation = active_brightness - other_max
        confidence = min(0.99, 0.60 + separation / 255.0 * 0.40)

        logger.info(
            "Traffic light state changed  %s -> %s  brightness=%s  conf=%.2f",
            prev or "none",
            active_state,
            {k: round(v, 1) for k, v in brightness.items()},
            confidence,
        )

        return {
            "outcome": active_state,
            "confidence": round(confidence, 4),
            "detection_data": {
                "state": active_state,
                "previous_state": prev,
                "brightness_red": round(brightness["red"], 2),
                "brightness_yellow": round(brightness["yellow"], 2),
                "brightness_green": round(brightness["green"], 2),
                "roi": self.roi,
            },
        }
