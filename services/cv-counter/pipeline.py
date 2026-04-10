"""
Persistent CV pipeline.

ONE long-running ffmpeg + frame reader + YOLO+tracker loop that serves
every round. A round-specific counter is swapped in at round boundaries,
which means:

  * After the first round's cold-start, every subsequent round gets warm
    ffmpeg and a warm YOLO tracker — no per-round startup lag.
  * Overlapping rounds (round N counting while round N+1 is in betting
    phase) are handled naturally: when round N finalizes, we swap to a
    fresh counter for round N+1 without touching ffmpeg.
  * Only one round is ever "counting" at a time. Warm-up frames between
    rounds are observed by YOLO (keeps tracker state alive) but no
    counter is active, so nothing is recorded.

Lifecycle events called from main.py:
  attach_round(round_info)   on round:opened — queues a counter if idle,
                              or stores as pending if another round is
                              currently counting.
  begin_counting(round_id)   on round:locked — enables the counter.
  finalize(round_id)         scheduled (locks_at + duration) — publishes
                              settlement, swaps to pending round if any,
                              otherwise goes idle.
  stop()                     on service shutdown.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import threading
import time
import traceback
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from counter import LineCrossingCounter


# ── ffmpeg discovery (robust against stripped PATH) ───────────────────
def _find_ffmpeg() -> str:
    p = shutil.which("ffmpeg")
    if p:
        return p
    for candidate in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"):
        if os.path.exists(candidate):
            return candidate
    raise RuntimeError("ffmpeg not found in PATH or Homebrew locations")


FFMPEG_BIN = _find_ffmpeg()


# ── Tunables (env-overridable) ────────────────────────────────────────
FRAME_W = int(os.environ.get("CV_FRAME_W", "960"))
FRAME_H = int(os.environ.get("CV_FRAME_H", "540"))
# 15 FPS. At 10 FPS a highway car jumps ~60px/frame which is enough for
# ByteTrack to lose the ID on its next frame — the IoU between successive
# bboxes drops below the match threshold. At 15 FPS per-frame motion is
# ~40px which is much more stable. We have ~60ms/frame of inference budget
# on YOLOv8s @ imgsz=960 MPS (track() mode), so 15 FPS fits comfortably.
FRAME_FPS = int(os.environ.get("CV_FRAME_FPS", "15"))

COUNTED_CLASSES = [2, 5, 7]  # car, bus, truck (COCO)

CV_CONF_THRESHOLD = float(os.environ.get("CV_CONF_THRESHOLD", "0.35"))
CV_IOU_THRESHOLD = float(os.environ.get("CV_IOU_THRESHOLD", "0.5"))
CV_IMGSZ = int(os.environ.get("CV_IMGSZ", "960"))
CV_DEVICE = os.environ.get("CV_DEVICE", "mps")

BYTETRACK_CFG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bytetrack.yaml")


logger = logging.getLogger("cv-counter.pipeline")


# ── Round info loaded from the DB ─────────────────────────────────────
@dataclass
class RoundInfo:
    round_id: str
    feed_id: str
    bet_type_slug: str
    bet_type_id: str
    camera_id: Optional[int]
    camera_external_id: Optional[str]
    camera_image_url: Optional[str]
    roi_geometry: Optional[dict]
    round_duration_seconds: int
    locks_at: Optional[datetime] = None  # absolute lock timestamp for accurate finalize


def fetch_round_info(pg_conn, round_id: str) -> Optional[RoundInfo]:
    query = """
        SELECT r.id, r.feed_id, r.bet_type_id, r.camera_id,
               c.external_id, c.image_url, c.roi_geometry,
               bt.slug, bt.round_duration_seconds, r.locks_at
          FROM rounds r
          LEFT JOIN cameras c   ON r.camera_id = c.id
          LEFT JOIN bet_types bt ON r.bet_type_id = bt.id
         WHERE r.id = %s
    """
    with pg_conn.cursor() as cur:
        cur.execute(query, (round_id,))
        row = cur.fetchone()
        if row is None:
            return None
        roi = row[6]
        if isinstance(roi, str):
            try:
                roi = json.loads(roi)
            except Exception:
                roi = None
        locks_at = row[9]
        if locks_at is not None and locks_at.tzinfo is None:
            locks_at = locks_at.replace(tzinfo=timezone.utc)
        return RoundInfo(
            round_id=str(row[0]),
            feed_id=str(row[1]),
            bet_type_id=str(row[2]),
            camera_id=row[3],
            camera_external_id=row[4],
            camera_image_url=row[5],
            roi_geometry=roi,
            bet_type_slug=row[7],
            round_duration_seconds=row[8] or 15,
            locks_at=locks_at,
        )


# ── The persistent pipeline ───────────────────────────────────────────
class Pipeline:
    def __init__(self, model, redis_client):
        self.model = model
        self.redis = redis_client

        # Persistent subprocess + thread state
        self._ffmpeg: Optional[subprocess.Popen] = None
        self._reader_thread: Optional[threading.Thread] = None
        self._stop_flag = threading.Event()
        self._ffmpeg_camera_url: Optional[str] = None

        # Per-round state (mutable; protected by _lock)
        self._lock = threading.Lock()
        self._current_round: Optional[RoundInfo] = None
        self._current_counter: Optional[LineCrossingCounter] = None
        self._pending_round: Optional[RoundInfo] = None
        self._pending_is_locked = False  # True if round:locked arrived for pending
        self._counting_start_ts: Optional[float] = None

        # Simple detection counters for debugging (total across round)
        self._detection_frames_with_vehicles = 0
        self._total_detections = 0

        # Timing instrumentation (reset each round)
        self._ffmpeg_start_ts: Optional[float] = None
        self._first_frame_ts: Optional[float] = None
        self._warmup_frames = 0
        self._counting_frames = 0
        self._inference_times: list = []

    # ── Public API (called from main.py) ───────────────────────────────
    def attach_round(self, round_info: RoundInfo) -> None:
        """Called on round:opened. Queue or activate the round."""
        if not round_info.camera_image_url or not round_info.roi_geometry:
            logger.warning(
                "round=%s missing camera/roi — ignoring", round_info.round_id
            )
            return
        if round_info.bet_type_slug != "car-count":
            logger.debug(
                "round=%s bet_type=%s — ignoring",
                round_info.round_id,
                round_info.bet_type_slug,
            )
            return

        with self._lock:
            if self._current_round is None:
                # Idle: activate immediately
                self._activate_round_locked(round_info)
            else:
                # Already serving a round — queue this one
                if self._pending_round is not None:
                    logger.warning(
                        "round=%s overwriting pending round %s",
                        round_info.round_id,
                        self._pending_round.round_id,
                    )
                self._pending_round = round_info
                logger.info(
                    "round=%s queued as pending (current=%s)",
                    round_info.round_id,
                    self._current_round.round_id,
                )

    def begin_counting(self, round_id: str) -> None:
        """Called on round:locked. Start counting on the current counter."""
        with self._lock:
            # If round_id matches the PENDING round, mark it as already-locked
            # so that when it gets promoted to current we enable counting.
            if self._pending_round is not None and self._pending_round.round_id == round_id:
                self._pending_is_locked = True
                logger.info(
                    "round=%s is pending but locked — will begin counting on promotion",
                    round_id,
                )
                return

            if self._current_round is None or self._current_round.round_id != round_id:
                logger.debug("begin_counting(%s) no matching current round", round_id)
                return
            if self._current_counter is None:
                return
            self._current_counter.enable_counting()
            self._counting_start_ts = time.monotonic()
            # Reset counting-phase instrumentation
            self._counting_frames = 0
            self._inference_times = []
            self._detection_frames_with_vehicles = 0
            self._total_detections = 0

    def finalize(self, round_id: str) -> None:
        """Scheduled to fire at lock + duration. Publish settlement, swap to pending."""
        with self._lock:
            if self._current_round is None or self._current_round.round_id != round_id:
                logger.debug("finalize(%s) no matching current round", round_id)
                return
            round_info = self._current_round
            counter = self._current_counter
            counting_start_ts = self._counting_start_ts
            warmup_frames = self._warmup_frames
            counting_frames = self._counting_frames
            inference_times = list(self._inference_times)
            first_frame_ts = self._first_frame_ts
            ffmpeg_start_ts = self._ffmpeg_start_ts
            total_detections = self._total_detections
            frames_with_vehicles = self._detection_frames_with_vehicles

        if counter is None:
            logger.warning("round=%s finalize called but counter is None", round_id)
            return

        publish_start_ts = time.monotonic()
        car_count = counter.total()
        events = counter.events()

        if car_count == 0:
            outcome = "zero"
        elif car_count % 2 == 0:
            outcome = "even"
        else:
            outcome = "odd"

        inf_sorted = sorted(inference_times) if inference_times else []
        inf_fps_p50 = round(1.0 / inf_sorted[len(inf_sorted) // 2], 1) if inf_sorted else 0.0
        inf_fps_p95 = (
            round(1.0 / inf_sorted[int(len(inf_sorted) * 0.95)], 1) if inf_sorted else 0.0
        )

        payload = {
            "feed_id": round_info.feed_id,
            "bet_type_slug": round_info.bet_type_slug,
            "round_id": round_info.round_id,
            "outcome": outcome,
            "confidence": 0.99 if car_count > 0 else 0.95,
            "detection_data": {
                "car_count": car_count,
                "counted_classes": COUNTED_CLASSES,
                "tracker": "bytetrack",
                "detection_method": "cv_line_crossing",
                "camera_external_id": round_info.camera_external_id,
                "window_seconds": round_info.round_duration_seconds,
                "warmup_frames": warmup_frames,
                "counting_frames": counting_frames,
                "count_events": events,
                "inference_fps_p50": inf_fps_p50,
                "inference_fps_p95": inf_fps_p95,
            },
            "frame_url": "",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        }

        try:
            self.redis.publish("settlement", json.dumps(payload))
        except Exception as e:
            logger.error("round=%s failed to publish settlement: %s", round_id, e)

        publish_ms = (time.monotonic() - publish_start_ts) * 1000.0
        lock_to_publish_overhead_ms = 0.0
        if counting_start_ts is not None:
            wall = (time.monotonic() - counting_start_ts) * 1000.0
            lock_to_publish_overhead_ms = wall - round_info.round_duration_seconds * 1000.0

        slow_flag = "" if lock_to_publish_overhead_ms < 500 else " [SLOW]"
        first_frame_ms = (
            int((first_frame_ts - ffmpeg_start_ts) * 1000.0)
            if first_frame_ts and ffmpeg_start_ts
            else -1
        )
        logger.info(
            "round=%s camera=%s first_frame_ms=%d warmup_frames=%d counting_frames=%d "
            "inf_fps_p50=%.1f inf_fps_p95=%.1f total_detections=%d frames_with_vehicles=%d "
            "car_count=%d outcome=%s publish_ms=%.0f overhead_ms=%.0f%s",
            round_info.round_id,
            round_info.camera_external_id,
            first_frame_ms,
            warmup_frames,
            counting_frames,
            inf_fps_p50,
            inf_fps_p95,
            total_detections,
            frames_with_vehicles,
            car_count,
            outcome,
            publish_ms,
            lock_to_publish_overhead_ms,
            slow_flag,
        )

        # Transition: promote pending round, or go idle
        with self._lock:
            self._current_round = None
            self._current_counter = None
            self._counting_start_ts = None
            if self._pending_round is not None:
                next_round = self._pending_round
                was_locked = self._pending_is_locked
                self._pending_round = None
                self._pending_is_locked = False
                self._activate_round_locked(next_round)
                if was_locked:
                    # Its lock event already fired while it was pending;
                    # enable counting now.
                    if self._current_counter is not None:
                        self._current_counter.enable_counting()
                        self._counting_start_ts = time.monotonic()
                        self._counting_frames = 0
                        self._inference_times = []
                        self._detection_frames_with_vehicles = 0
                        self._total_detections = 0
                        logger.info(
                            "round=%s promoted with already-locked flag — counting enabled",
                            next_round.round_id,
                        )
            else:
                logger.info("no pending round; stopping ffmpeg")
                self._stop_ffmpeg_locked()

    def stop(self) -> None:
        """Service shutdown."""
        with self._lock:
            self._stop_ffmpeg_locked()

    # ── Internal: activation & ffmpeg lifecycle ────────────────────────
    def _activate_round_locked(self, round_info: RoundInfo) -> None:
        """Caller must hold self._lock."""
        self._current_round = round_info
        self._current_counter = LineCrossingCounter(
            roi_geometry=round_info.roi_geometry,
            frame_w=FRAME_W,
            frame_h=FRAME_H,
        )
        self._warmup_frames = 0
        self._counting_frames = 0
        self._inference_times = []

        # Start or reuse ffmpeg on the right camera
        if (
            self._ffmpeg is None
            or self._ffmpeg.poll() is not None
            or self._ffmpeg_camera_url != round_info.camera_image_url
        ):
            self._stop_ffmpeg_locked()
            self._start_ffmpeg_locked(round_info.camera_image_url)
        else:
            logger.info(
                "round=%s reusing warm ffmpeg (camera=%s)",
                round_info.round_id,
                round_info.camera_external_id,
            )
        logger.info(
            "round=%s activated (camera=%s)",
            round_info.round_id,
            round_info.camera_external_id,
        )

    def _start_ffmpeg_locked(self, hls_url: str) -> None:
        cmd = [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel", "error",
            "-fflags", "nobuffer",
            "-flags", "low_delay",
            "-i", hls_url,
            "-vf", f"fps={FRAME_FPS},scale={FRAME_W}:{FRAME_H}",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "-an",
            "-",
        ]
        logger.info("starting ffmpeg: %s", hls_url)
        self._ffmpeg_start_ts = time.monotonic()
        self._first_frame_ts = None
        self._ffmpeg = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=FRAME_W * FRAME_H * 3,
        )
        self._ffmpeg_camera_url = hls_url
        self._stop_flag.clear()
        self._reader_thread = threading.Thread(
            target=self._reader_loop, name="cv-reader", daemon=True
        )
        self._reader_thread.start()

    def _stop_ffmpeg_locked(self) -> None:
        self._stop_flag.set()
        if self._ffmpeg is not None:
            try:
                self._ffmpeg.kill()
            except Exception:
                pass
            self._ffmpeg = None
        self._ffmpeg_camera_url = None
        # Leave _reader_thread; it's daemon and will exit on next read

    # ── Internal: frame reader loop ────────────────────────────────────
    def _reader_loop(self) -> None:
        ff = self._ffmpeg
        if ff is None or ff.stdout is None:
            return
        frame_size = FRAME_W * FRAME_H * 3

        while not self._stop_flag.is_set():
            try:
                raw = ff.stdout.read(frame_size)
            except Exception as e:
                logger.warning("ffmpeg read error: %s", e)
                break
            if not raw or len(raw) < frame_size:
                logger.warning(
                    "ffmpeg short read (%d bytes); ending reader loop",
                    len(raw) if raw else 0,
                )
                break

            if self._first_frame_ts is None:
                self._first_frame_ts = time.monotonic()
                logger.info(
                    "first frame in %.0fms",
                    (self._first_frame_ts - self._ffmpeg_start_ts) * 1000.0,
                )

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((FRAME_H, FRAME_W, 3))
            try:
                self._process_frame(frame)
            except Exception as e:
                logger.error("process_frame error: %s\n%s", e, traceback.format_exc())

        logger.info(
            "reader loop exiting (warmup=%d counting=%d)",
            self._warmup_frames,
            self._counting_frames,
        )

    def _process_frame(self, frame: np.ndarray) -> None:
        # Snapshot the current counter under the lock (cheap)
        with self._lock:
            counter = self._current_counter
            counting = counter.counting_enabled if counter is not None else False

        if counting:
            self._counting_frames += 1
        else:
            self._warmup_frames += 1

        t0 = time.monotonic()
        results = self.model.track(
            frame,
            persist=True,
            tracker=BYTETRACK_CFG,
            classes=COUNTED_CLASSES,
            conf=CV_CONF_THRESHOLD,
            iou=CV_IOU_THRESHOLD,
            imgsz=CV_IMGSZ,
            agnostic_nms=True,
            device=CV_DEVICE,
            verbose=False,
        )
        if counting:
            self._inference_times.append(time.monotonic() - t0)

        if counter is None or not results:
            return
        r = results[0]
        if r.boxes is None or r.boxes.id is None:
            # Detections may exist without track IDs on early frames
            if r.boxes is not None and len(r.boxes) > 0 and counting:
                self._total_detections += len(r.boxes)
                if self._counting_frames % 15 == 1:
                    logger.debug(
                        "frame %d: %d detections but no tracker IDs yet",
                        self._counting_frames,
                        len(r.boxes),
                    )
            # Still publish an empty frame so the viewer knows we're alive
            self._publish_tracks([], counter, counting)
            return

        ids = r.boxes.id.cpu().numpy().astype(int)
        classes = r.boxes.cls.cpu().numpy().astype(int) if r.boxes.cls is not None else None
        xyxy = r.boxes.xyxy.cpu().numpy()

        if counting:
            self._total_detections += len(ids)
            self._detection_frames_with_vehicles += 1
            # Periodic debug log every ~2 seconds of counting
            if self._counting_frames % 12 == 1:
                logger.info(
                    "frame %d: tracking %d vehicles, ids=%s",
                    self._counting_frames,
                    len(ids),
                    ids.tolist()[:10],
                )

        track_snapshots = []
        for i in range(len(ids)):
            track_id = int(ids[i])
            cls = int(classes[i]) if classes is not None else 2
            x1, y1, x2, y2 = xyxy[i]
            cx = (x1 + x2) / 2.0
            cy = (y1 + y2) / 2.0
            counter.observe(track_id, cls, cx, cy)
            track_snapshots.append({
                "id": track_id,
                "cx": float(cx),
                "cy": float(cy),
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
                "cls": cls,
            })

        # Broadcast live tracks + count to the frontend via Redis pub/sub
        self._publish_tracks(track_snapshots, counter, counting)

    def _publish_tracks(self, raw_tracks: list, counter, counting: bool) -> None:
        """Publish the current frame's tracks + running count to Redis.

        Runs on every processed frame. Clients (FeedPlayer) subscribe via
        WebSocket to draw live centroid dots and a live count overlay.
        """
        with self._lock:
            current = self._current_round
        if current is None:
            return
        # For each track, annotate which lines (A/B) it has crossed so far
        # so the client can colour them.
        tracks_out = []
        for t in raw_tracks:
            hist = counter.tracks.get(t["id"]) if counter is not None else None
            crossed = list(hist.cross_sequence) if hist is not None else []
            counted = bool(hist.counted) if hist is not None else False
            tracks_out.append({
                "id": t["id"],
                "cx": round(t["cx"] / FRAME_W, 4),  # normalised 0..1
                "cy": round(t["cy"] / FRAME_H, 4),
                "x1": round(t["x1"] / FRAME_W, 4),
                "y1": round(t["y1"] / FRAME_H, 4),
                "x2": round(t["x2"] / FRAME_W, 4),
                "y2": round(t["y2"] / FRAME_H, 4),
                "cls": t["cls"],
                "crossed": crossed,
                "counted": counted,
            })
        payload = {
            "round_id": current.round_id,
            "feed_id": current.feed_id,
            "frame_w": FRAME_W,
            "frame_h": FRAME_H,
            "counting": counting,
            "count": counter.total() if counter is not None else 0,
            "tracks": tracks_out,
        }
        try:
            self.redis.publish("cv_tracks", json.dumps(payload))
        except Exception:
            # Don't let a broken redis publish break the main loop
            pass
