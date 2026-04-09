"""
emitter.py -- Redis settlement-event publisher for the CV pipeline.

Takes a detection result, archives the evidence frame, and publishes
a settlement event to the Redis "settlement" channel in the same
JSON format the feed-simulator uses.
"""

import datetime
import json
import logging
import os

import numpy as np
import redis

from archiver import upload_frame

logger = logging.getLogger("cv-pipeline.emitter")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")

_redis_client = None


def _get_redis() -> redis.Redis:
    """Lazy-connect to Redis with automatic reconnection."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    return _redis_client


def reset_connection():
    """Force a fresh connection on next call (used after errors)."""
    global _redis_client
    _redis_client = None


def emit_settlement(
    feed_id: str,
    bet_type_slug: str,
    round_id: str,
    outcome: str,
    confidence: float,
    detection_data: dict,
    frame: np.ndarray,
) -> None:
    """Archive the frame and publish a settlement event to Redis.

    Parameters
    ----------
    feed_id : str
        UUID of the feed.
    bet_type_slug : str
        Slug of the bet type (e.g. "next-car-color").
    round_id : str
        UUID of the round being settled.
    outcome : str
        The determined outcome (e.g. "red", "over", "yes").
    confidence : float
        Model confidence in [0, 1].
    detection_data : dict
        Arbitrary detection metadata (color_rgb, counts, etc.).
    frame : numpy.ndarray
        The BGR frame used for settlement evidence.
    """
    frame_url = upload_frame(frame, feed_id, round_id)

    event = {
        "feed_id": feed_id,
        "bet_type_slug": bet_type_slug,
        "round_id": round_id,
        "outcome": outcome,
        "confidence": round(confidence, 4),
        "detection_data": _make_serialisable(detection_data),
        "frame_url": frame_url,
        "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }

    payload = json.dumps(event)

    try:
        client = _get_redis()
        listeners = client.publish("settlement", payload)
        logger.info(
            "Published settlement  round=%s  outcome=%s  confidence=%.3f  "
            "listeners=%d  frame=%s",
            round_id,
            outcome,
            confidence,
            listeners,
            frame_url,
        )
    except redis.ConnectionError:
        logger.exception("Redis publish failed -- will reconnect on next attempt")
        reset_connection()
        raise


def _make_serialisable(obj):
    """Recursively convert numpy types to plain Python types for JSON."""
    if isinstance(obj, dict):
        return {k: _make_serialisable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_make_serialisable(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj
