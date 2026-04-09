"""
feed_worker.py -- Per-feed processing loop for the CV pipeline.

Each FeedWorker:
  1. Resolves the stream URL (handles YouTube embed URLs via yt-dlp).
  2. Opens the stream with ffmpeg as a subprocess and reads frames at
     a target rate (default 5 fps).
  3. For every active bet_type on this feed, runs the appropriate
     detector on each frame.
  4. When a detector returns a result *and* there is a locked round
     waiting for settlement, archives the evidence frame and emits
     a settlement event to Redis.
  5. On stream failure, retries with exponential back-off.
"""

import logging
import os
import re
import subprocess
import time
from typing import Optional

import cv2
import numpy as np
import psycopg2

from detectors import DETECTOR_REGISTRY
from emitter import emit_settlement

logger = logging.getLogger("cv-pipeline.feed_worker")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena"
)

TARGET_FPS = int(os.environ.get("CV_TARGET_FPS", "5"))
RETRY_BASE_DELAY = 5  # seconds
RETRY_MAX_DELAY = 120


# ------------------------------------------------------------------
# Stream URL resolution
# ------------------------------------------------------------------

_YT_EMBED_RE = re.compile(
    r"https?://(?:www\.)?youtube\.com/embed/([A-Za-z0-9_-]+)"
)
_YT_WATCH_RE = re.compile(
    r"https?://(?:www\.)?youtube\.com/watch\?v=([A-Za-z0-9_-]+)"
)
_YT_SHORT_RE = re.compile(
    r"https?://youtu\.be/([A-Za-z0-9_-]+)"
)


def _extract_youtube_id(url: str) -> Optional[str]:
    for regex in (_YT_EMBED_RE, _YT_WATCH_RE, _YT_SHORT_RE):
        m = regex.search(url)
        if m:
            return m.group(1)
    return None


def resolve_stream_url(raw_url: str) -> str:
    """Convert a YouTube embed / watch URL into a direct stream URL
    using yt-dlp.  For non-YouTube URLs, return as-is.
    """
    yt_id = _extract_youtube_id(raw_url)
    if yt_id is None:
        return raw_url

    canonical = f"https://www.youtube.com/watch?v={yt_id}"
    logger.info("Resolving YouTube stream via yt-dlp  video_id=%s", yt_id)

    try:
        result = subprocess.run(
            [
                "yt-dlp",
                "--get-url",
                "--format", "best[height<=720]",
                "--no-warnings",
                canonical,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and result.stdout.strip():
            resolved = result.stdout.strip().splitlines()[0]
            logger.info("Resolved stream URL (length=%d)", len(resolved))
            return resolved
        else:
            logger.warning(
                "yt-dlp failed (rc=%d): %s", result.returncode, result.stderr[:200]
            )
    except FileNotFoundError:
        logger.warning("yt-dlp not found -- falling back to raw URL")
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out for %s", canonical)
    except Exception:
        logger.exception("Unexpected error resolving stream URL")

    # Fallback: return the raw URL and let ffmpeg try
    return raw_url


# ------------------------------------------------------------------
# Frame reader (ffmpeg subprocess)
# ------------------------------------------------------------------

class FrameReader:
    """Read decoded BGR frames from a video stream via ffmpeg subprocess."""

    def __init__(self, stream_url: str, width: int = 640, height: int = 360,
                 fps: int = TARGET_FPS):
        self.stream_url = stream_url
        self.width = width
        self.height = height
        self.fps = fps
        self._proc: Optional[subprocess.Popen] = None
        self._frame_size = width * height * 3  # BGR

    def start(self):
        """Launch the ffmpeg subprocess."""
        cmd = [
            "ffmpeg",
            "-loglevel", "error",
            "-reconnect", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "30",
            "-i", self.stream_url,
            "-vf", f"fps={self.fps},scale={self.width}:{self.height}",
            "-an",                # discard audio
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-",
        ]
        logger.info("Starting ffmpeg  fps=%d  size=%dx%d", self.fps, self.width, self.height)
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=10**7
        )

    def read(self) -> Optional[np.ndarray]:
        """Read one frame.  Returns None on EOF or error."""
        if self._proc is None:
            return None
        raw = self._proc.stdout.read(self._frame_size)
        if len(raw) != self._frame_size:
            return None
        frame = np.frombuffer(raw, dtype=np.uint8).reshape(
            (self.height, self.width, 3)
        )
        return frame

    def stop(self):
        """Terminate the ffmpeg process."""
        if self._proc is not None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=5)
            except Exception:
                self._proc.kill()
            self._proc = None

    @property
    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.poll() is None


# ------------------------------------------------------------------
# Database helpers
# ------------------------------------------------------------------

def _connect_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    return conn


def _fetch_active_bet_types(pg_conn, feed_id: str) -> list[dict]:
    """Get all active bet types for a feed."""
    query = """
        SELECT id, slug, settlement_method, options, round_duration_seconds
        FROM bet_types
        WHERE feed_id = %s AND is_active = true
    """
    with pg_conn.cursor() as cur:
        cur.execute(query, (feed_id,))
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def _fetch_locked_round(pg_conn, feed_id: str, bet_type_id: str) -> Optional[dict]:
    """Get the oldest locked round for a specific feed + bet_type."""
    query = """
        SELECT id AS round_id, feed_id, bet_type_id
        FROM rounds
        WHERE feed_id = %s AND bet_type_id = %s AND status = 'locked'
        ORDER BY created_at ASC
        LIMIT 1
    """
    with pg_conn.cursor() as cur:
        cur.execute(query, (feed_id, bet_type_id))
        row = cur.fetchone()
        if row is None:
            return None
        cols = [d[0] for d in cur.description]
        return dict(zip(cols, row))


# ------------------------------------------------------------------
# FeedWorker
# ------------------------------------------------------------------

class FeedWorker:
    """Process a single camera feed end-to-end.

    Intended to be run in its own thread via ``worker.run()``.
    """

    def __init__(self, feed: dict, model, stop_event):
        """
        Parameters
        ----------
        feed : dict
            Row from the feeds table (must include id, name, slug, stream_url).
        model : ultralytics.YOLO
            Pre-loaded YOLO model instance.
        stop_event : threading.Event
            Signals graceful shutdown.
        """
        self.feed = feed
        self.feed_id = str(feed["id"])
        self.feed_name = feed["name"]
        self.stream_url = feed["stream_url"]
        self.model = model
        self.stop_event = stop_event

        self._pg_conn = None
        self._detectors: dict[str, dict] = {}  # bet_type_id -> {detector, slug}
        self._retry_count = 0

    # ---------------------------------------------------------------
    # Public
    # ---------------------------------------------------------------

    def run(self):
        """Main loop -- runs until stop_event is set."""
        logger.info("FeedWorker starting  feed=%s (%s)", self.feed_name, self.feed_id)

        while not self.stop_event.is_set():
            try:
                self._run_stream_loop()
            except Exception:
                logger.exception(
                    "Stream loop crashed for feed %s -- will retry", self.feed_name
                )
            finally:
                self._retry_count += 1
                delay = min(
                    RETRY_BASE_DELAY * (2 ** min(self._retry_count, 6)),
                    RETRY_MAX_DELAY,
                )
                logger.info(
                    "Feed %s: retrying in %.0fs (attempt #%d)",
                    self.feed_name, delay, self._retry_count,
                )
                if self.stop_event.wait(timeout=delay):
                    break

        logger.info("FeedWorker stopped  feed=%s", self.feed_name)

    # ---------------------------------------------------------------
    # Internal
    # ---------------------------------------------------------------

    def _ensure_db(self):
        if self._pg_conn is None or self._pg_conn.closed:
            self._pg_conn = _connect_db()

    def _init_detectors(self):
        """(Re-)load active bet types and instantiate detectors."""
        self._ensure_db()
        bet_types = _fetch_active_bet_types(self._pg_conn, self.feed_id)
        self._detectors.clear()

        for bt in bet_types:
            method = bt["settlement_method"]
            detector_cls = DETECTOR_REGISTRY.get(method)
            if detector_cls is None:
                logger.warning(
                    "No detector for settlement_method=%s (bet_type=%s) -- skipping",
                    method, bt["slug"],
                )
                continue

            detector = detector_cls(self.model)
            self._detectors[str(bt["id"])] = {
                "detector": detector,
                "slug": bt["slug"],
                "settlement_method": method,
            }
            logger.info(
                "  Detector ready  bet_type=%s  method=%s", bt["slug"], method
            )

        logger.info(
            "Feed %s: %d detector(s) active", self.feed_name, len(self._detectors)
        )

    def _run_stream_loop(self):
        """Open the stream and process frames until failure or shutdown."""
        resolved_url = resolve_stream_url(self.stream_url)
        reader = FrameReader(resolved_url)
        reader.start()

        if not reader.is_alive:
            logger.error("ffmpeg failed to start for feed %s", self.feed_name)
            reader.stop()
            return

        self._init_detectors()
        if not self._detectors:
            logger.warning("No active detectors for feed %s -- sleeping", self.feed_name)
            reader.stop()
            return

        self._retry_count = 0  # reset on successful start
        frames_processed = 0

        try:
            while not self.stop_event.is_set():
                frame = reader.read()
                if frame is None:
                    logger.warning("End of stream / read error for feed %s", self.feed_name)
                    break

                frames_processed += 1
                self._process_frame(frame)

                if frames_processed % (TARGET_FPS * 60) == 0:
                    logger.info(
                        "Feed %s: %d frames processed", self.feed_name, frames_processed
                    )
                    # Refresh detectors periodically (picks up new bet types)
                    self._init_detectors()

        finally:
            reader.stop()
            logger.info(
                "Feed %s: stream ended after %d frames", self.feed_name, frames_processed
            )

    def _process_frame(self, frame: np.ndarray):
        """Run all active detectors against one frame and settle if possible."""
        for bt_id, entry in self._detectors.items():
            detector = entry["detector"]
            slug = entry["slug"]

            try:
                result = detector.process_frame(frame)
            except Exception:
                logger.exception(
                    "Detector error  feed=%s  bet_type=%s", self.feed_name, slug
                )
                continue

            if result is None:
                continue

            # A detection result is available -- check for a locked round
            try:
                self._ensure_db()
                locked = _fetch_locked_round(self._pg_conn, self.feed_id, bt_id)
            except psycopg2.OperationalError:
                logger.exception("DB connection lost -- reconnecting")
                self._pg_conn = None
                continue

            if locked is None:
                # No locked round waiting -- discard the result
                logger.debug(
                    "Detection result discarded (no locked round)  feed=%s  bet=%s  outcome=%s",
                    self.feed_name, slug, result["outcome"],
                )
                continue

            # Emit settlement
            try:
                emit_settlement(
                    feed_id=self.feed_id,
                    bet_type_slug=slug,
                    round_id=str(locked["round_id"]),
                    outcome=result["outcome"],
                    confidence=result["confidence"],
                    detection_data=result["detection_data"],
                    frame=frame,
                )
            except Exception:
                logger.exception(
                    "Failed to emit settlement  feed=%s  round=%s",
                    self.feed_name, locked["round_id"],
                )
