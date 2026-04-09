"""
detectors -- CV detection modules for the Arena settlement pipeline.

Each detector exposes a class with a common interface:
    detector.process_frame(frame) -> Optional[DetectionResult]

DetectionResult is a dict with at least:
    outcome      : str    -- the settlement outcome value
    confidence   : float  -- model confidence [0, 1]
    detection_data : dict -- arbitrary metadata for the settlement log
"""

from detectors.color import ColorDetector
from detectors.counter import CounterDetector
from detectors.timing import TimingDetector
from detectors.presence import PresenceDetector

DETECTOR_REGISTRY = {
    "cv_color": ColorDetector,
    "cv_count": CounterDetector,
    "cv_timing": TimingDetector,
    "cv_presence": PresenceDetector,
}

__all__ = [
    "ColorDetector",
    "CounterDetector",
    "TimingDetector",
    "PresenceDetector",
    "DETECTOR_REGISTRY",
]
