"""
color.py -- Vehicle color classification detector.

Pipeline:
  1. Run YOLOv8-nano to find vehicles in the frame.
  2. Extract the bounding-box ROI of the largest (closest) vehicle.
  3. Run k-means (k=3) on the ROI pixels to find the dominant cluster.
  4. Map the dominant RGB value to a named colour bucket via HSV ranges.
"""

import logging
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger("cv-pipeline.detectors.color")

# COCO class IDs that correspond to vehicles
VEHICLE_CLASS_IDS = {2, 3, 5, 7}  # car, motorcycle, bus, truck

VEHICLE_CLASS_NAMES = {
    2: "car",
    3: "motorcycle",
    5: "bus",
    7: "truck",
}

# Friendly vehicle sub-types (approximated from aspect ratio)
VEHICLE_SUBTYPES = ["sedan", "suv", "truck", "hatchback", "coupe", "van"]

# ------------------------------------------------------------------ #
# Colour-bucket definitions in HSV space
# H is in [0, 180] for OpenCV, S and V in [0, 255].
# ------------------------------------------------------------------ #

def _classify_hsv(h: float, s: float, v: float) -> str:
    """Map an HSV triplet to a named colour bucket."""
    # Very dark -> black
    if v < 50:
        return "black"
    # Very low saturation -> silver or white depending on brightness
    if s < 40:
        if v > 180:
            return "white"
        return "silver"
    # Chromatic colours (hue-based)
    if h < 10 or h >= 160:
        return "red"
    if 10 <= h < 25:
        # orange-ish reds map to "other"
        return "other" if s < 120 else "red"
    if 25 <= h < 35:
        return "yellow"
    if 35 <= h < 85:
        return "green"
    if 85 <= h < 130:
        return "blue"
    if 130 <= h < 160:
        # purple range -> other
        return "other"
    return "other"


def _dominant_color_kmeans(roi: np.ndarray, k: int = 3) -> np.ndarray:
    """Return the dominant colour in a BGR ROI using k-means clustering."""
    # Resize for speed (max 80x80)
    h, w = roi.shape[:2]
    scale = min(1.0, 80.0 / max(h, w))
    if scale < 1.0:
        roi = cv2.resize(roi, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

    pixels = roi.reshape(-1, 3).astype(np.float32)
    if len(pixels) < k:
        return np.mean(pixels, axis=0).astype(np.uint8)

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _, labels, centres = cv2.kmeans(pixels, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)

    # The dominant cluster is the one with the most pixels
    _, counts = np.unique(labels, return_counts=True)
    dominant_idx = np.argmax(counts)
    return centres[dominant_idx].astype(np.uint8)


class ColorDetector:
    """Detect the next vehicle's dominant colour from a video frame.

    This detector is stateful: it waits for a *new* vehicle to appear
    (one that was not in the previous frame's detections) before
    emitting a result.  In the PoC we simply detect the largest vehicle
    per frame and return immediately.
    """

    def __init__(self, model, config: Optional[dict] = None):
        """
        Parameters
        ----------
        model : ultralytics.YOLO
            A pre-loaded YOLOv8 model instance (shared across detectors).
        config : dict, optional
            Per-feed configuration overrides.
        """
        self.model = model
        self.config = config or {}
        self.min_vehicle_area = self.config.get("min_vehicle_area", 2000)
        self.min_confidence = self.config.get("min_vehicle_confidence", 0.35)
        self._prev_vehicle_box = None

    def process_frame(self, frame: np.ndarray) -> Optional[dict]:
        """Run detection on a single BGR frame.

        Returns a result dict if a vehicle colour was determined,
        otherwise None.
        """
        results = self.model(frame, verbose=False)
        if not results or len(results[0].boxes) == 0:
            return None

        boxes = results[0].boxes
        best_box = None
        best_area = 0
        best_cls = -1
        best_conf = 0.0

        for box in boxes:
            cls_id = int(box.cls[0])
            conf = float(box.conf[0])
            if cls_id not in VEHICLE_CLASS_IDS:
                continue
            if conf < self.min_confidence:
                continue

            x1, y1, x2, y2 = box.xyxy[0].tolist()
            area = (x2 - x1) * (y2 - y1)

            if area < self.min_vehicle_area:
                continue

            if area > best_area:
                best_area = area
                best_box = (int(x1), int(y1), int(x2), int(y2))
                best_cls = cls_id
                best_conf = conf

        if best_box is None:
            return None

        x1, y1, x2, y2 = best_box

        # Shrink the ROI slightly to avoid edge pixels / background
        pad_x = int((x2 - x1) * 0.1)
        pad_y = int((y2 - y1) * 0.1)
        roi = frame[
            max(0, y1 + pad_y) : min(frame.shape[0], y2 - pad_y),
            max(0, x1 + pad_x) : min(frame.shape[1], x2 - pad_x),
        ]

        if roi.size == 0:
            return None

        dominant_bgr = _dominant_color_kmeans(roi)
        # Convert to HSV for classification
        pixel = np.uint8([[dominant_bgr]])
        hsv = cv2.cvtColor(pixel, cv2.COLOR_BGR2HSV)[0][0]
        colour_name = _classify_hsv(float(hsv[0]), float(hsv[1]), float(hsv[2]))

        # Convert BGR -> RGB for the event payload
        colour_rgb = [int(dominant_bgr[2]), int(dominant_bgr[1]), int(dominant_bgr[0])]

        vehicle_label = VEHICLE_CLASS_NAMES.get(best_cls, "car")

        logger.info(
            "Vehicle detected  class=%s  conf=%.2f  colour=%s  rgb=%s",
            vehicle_label,
            best_conf,
            colour_name,
            colour_rgb,
        )

        return {
            "outcome": colour_name,
            "confidence": best_conf,
            "detection_data": {
                "color_rgb": colour_rgb,
                "color_hsv": [int(hsv[0]), int(hsv[1]), int(hsv[2])],
                "vehicle_class": vehicle_label,
                "vehicle_confidence": round(best_conf, 4),
                "bounding_box": list(best_box),
            },
        }
