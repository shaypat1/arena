"""
cv-counter main service.

Subscribes to the Redis `round_state` channel and drives a single persistent
Pipeline that counts cars crossing each round's ROI line. One round at a
time is "counting"; rounds that open while another is counting are queued
as pending.

Env:
  REDIS_URL           (default redis://localhost:6379)
  DATABASE_URL        (default postgresql://arena:arena_dev@localhost:5432/arena)
  YOLO_MODEL          (default yolov8s.pt)
  CV_DEVICE           (default "mps" on Apple Silicon)
"""

from __future__ import annotations

import json
import logging
import os
import sys
import threading
import time
from datetime import datetime, timezone
from typing import Optional

# Allow MPS to fall back to CPU for any op that isn't MPS-implemented yet.
# Safer than crashing mid-round on a rare fallback. Set BEFORE importing torch.
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

import numpy as np
import psycopg2
import redis

# Make local imports (pipeline, counter) work when run via `python main.py`
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pipeline import Pipeline, fetch_round_info  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cv-counter")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena"
)
YOLO_MODEL = os.environ.get("YOLO_MODEL", "yolov8n.pt")
YOLO_DEVICE = os.environ.get("CV_DEVICE", "mps")


class CvCounterService:
    def __init__(self):
        self.redis = redis.Redis.from_url(REDIS_URL, decode_responses=True)
        self.redis.ping()
        logger.info("connected to Redis at %s", REDIS_URL)

        self.pg = psycopg2.connect(DATABASE_URL)
        self.pg.autocommit = True
        logger.info("connected to PostgreSQL")

        self.model = self._load_and_warm_model()
        self.pipeline = Pipeline(model=self.model, redis_client=self.redis)

    def _load_and_warm_model(self):
        logger.info("loading YOLO model: %s (device=%s)", YOLO_MODEL, YOLO_DEVICE)
        from ultralytics import YOLO  # noqa: WPS433

        t0 = time.monotonic()
        model = YOLO(YOLO_MODEL)
        # Explicitly move to target device — Ultralytics does NOT auto-select
        # MPS on Apple Silicon. Benchmark: yolov8s @ imgsz=960 on MPS runs
        # ~60-150ms/frame (real frames), vs ~500ms/frame on CPU.
        try:
            model.to(YOLO_DEVICE)
        except Exception as e:
            logger.warning(
                "failed to move model to %s: %s — falling back to cpu", YOLO_DEVICE, e
            )
        load_ms = (time.monotonic() - t0) * 1000.0
        logger.info("model loaded in %.0fms", load_ms)

        # Warm the device kernels with two dummy inferences so the first real
        # inference doesn't pay the JIT tax.
        dummy = np.zeros((540, 960, 3), dtype=np.uint8)
        for i in (1, 2):
            t0 = time.monotonic()
            _ = model.predict(dummy, imgsz=960, verbose=False, device=YOLO_DEVICE)
            warm_ms = (time.monotonic() - t0) * 1000.0
            logger.info("model warm-up inference %d took %.0fms", i, warm_ms)
        return model

    # ── Round event handlers ───────────────────────────────────────────
    def _schedule_finalize(self, round_info) -> None:
        """
        Schedule the finalize callback to fire at locks_at + duration
        (absolute time). This is the only correct way — timers based on
        relative delays drift when rounds are received late or promoted
        from pending.
        """
        if round_info.locks_at is None:
            # Fallback: relative timer
            t = threading.Timer(
                round_info.round_duration_seconds,
                self._finalize_round,
                args=(round_info.round_id,),
            )
            t.daemon = True
            t.start()
            return
        deadline_ts = round_info.locks_at.timestamp() + round_info.round_duration_seconds
        delay = max(0.0, deadline_ts - datetime.now(timezone.utc).timestamp())
        t = threading.Timer(delay, self._finalize_round, args=(round_info.round_id,))
        t.daemon = True
        t.start()
        logger.info(
            "round=%s finalize scheduled in %.2fs (absolute deadline)",
            round_info.round_id,
            delay,
        )

    def _on_round_opened(self, event: dict) -> None:
        round_id = event.get("round_id")
        if not round_id:
            return
        if event.get("bet_type_slug") != "car-count":
            return

        info = fetch_round_info(self.pg, round_id)
        if info is None:
            logger.warning("round %s not found in DB", round_id)
            return
        if info.roi_geometry is None:
            logger.warning("round %s camera has no roi_geometry — skipping", round_id)
            return

        self.pipeline.attach_round(info)
        logger.info(
            "round=%s opened (camera=%s locks_at=%s)",
            round_id,
            info.camera_external_id,
            info.locks_at.isoformat() if info.locks_at else "unknown",
        )

    def _on_round_locked(self, event: dict) -> None:
        round_id = event.get("round_id")
        if not round_id:
            return
        # Check if this round is one we're tracking (current or pending).
        # The round_state channel carries events for ALL feeds/bet_types,
        # but we only care about car-count rounds our pipeline has attached.
        with self.pipeline._lock:
            is_ours = (
                (self.pipeline._current_round is not None
                 and self.pipeline._current_round.round_id == round_id)
                or (self.pipeline._pending_round is not None
                    and self.pipeline._pending_round.round_id == round_id)
            )
        if not is_ours:
            return
        self.pipeline.begin_counting(round_id)
        info = fetch_round_info(self.pg, round_id)
        if info is None:
            return
        logger.info(
            "round=%s locked — counting for %ds", round_id, info.round_duration_seconds
        )
        self._schedule_finalize(info)

    def _finalize_round(self, round_id: str) -> None:
        try:
            self.pipeline.finalize(round_id)
        except Exception as e:
            logger.error("round=%s finalize error: %s", round_id, e)

    def _safety_finalize(self, round_id: str) -> None:
        """Fallback: if we missed round:locked, still finalize this round."""
        with self.pipeline._lock:
            current = self.pipeline._current_round
            if current is None or current.round_id != round_id:
                return
            counter = self.pipeline._current_counter
            if counter is None:
                return
            if not counter.counting_enabled:
                logger.warning("round=%s safety-net enabling counter", round_id)
                counter.enable_counting()
                self.pipeline._counting_start_ts = time.monotonic()
        try:
            self.pipeline.finalize(round_id)
        except Exception as e:
            logger.error("round=%s safety finalize error: %s", round_id, e)

    # ── Startup state sync ──────────────────────────────────────────────
    def _sync_active_rounds(self) -> None:
        """
        On startup (or restart), pick up any in-flight rounds that we would
        otherwise miss. Queries the DB for rounds in status open/locked on
        the car-count bet_type and attaches them to the pipeline.

        If a round is already locked, we enable counting immediately AND
        schedule finalize based on how much of the counting window remains
        at locks_at + round_duration_seconds.
        """
        query = """
            SELECT r.id, r.status, r.locks_at, bt.round_duration_seconds
              FROM rounds r
              JOIN bet_types bt ON r.bet_type_id = bt.id
             WHERE bt.slug = 'car-count'
               AND r.status IN ('open', 'locked')
             ORDER BY r.opens_at ASC
        """
        with self.pg.cursor() as cur:
            cur.execute(query)
            rows = cur.fetchall()

        if not rows:
            return

        logger.info("sync: found %d in-flight round(s)", len(rows))
        now = datetime.now(timezone.utc)
        for row in rows:
            round_id, status, locks_at, duration = row
            round_id = str(round_id)
            info = fetch_round_info(self.pg, round_id)
            if info is None or info.roi_geometry is None:
                continue

            # attach_round handles queueing if another round is already active
            self.pipeline.attach_round(info)

            if status == "locked":
                self.pipeline.begin_counting(round_id)
                # Check if already past deadline
                if info.locks_at is not None:
                    deadline = info.locks_at.timestamp() + info.round_duration_seconds
                    if deadline <= now.timestamp():
                        logger.warning(
                            "sync: round %s already past deadline, finalizing now",
                            round_id,
                        )
                        self._finalize_round(round_id)
                        continue
                self._schedule_finalize(info)

    # ── Main loop ───────────────────────────────────────────────────────
    def run(self) -> None:
        # Catch up on in-flight rounds before subscribing
        try:
            self._sync_active_rounds()
        except Exception as e:
            logger.error("startup sync failed: %s", e)

        pubsub = self.redis.pubsub()
        pubsub.subscribe("round_state")
        logger.info("subscribed to round_state channel; waiting for events")

        for message in pubsub.listen():
            if message is None:
                continue
            if message.get("type") != "message":
                continue
            try:
                event = json.loads(message["data"])
            except Exception:
                logger.warning("bad message on round_state: %s", message)
                continue

            evt_type = event.get("event")
            if evt_type == "round:opened":
                try:
                    self._on_round_opened(event)
                except Exception as e:
                    logger.error("round:opened error: %s", e)
            elif evt_type == "round:locked":
                try:
                    self._on_round_locked(event)
                except Exception as e:
                    logger.error("round:locked error: %s", e)


def main():
    service = CvCounterService()
    try:
        service.run()
    except KeyboardInterrupt:
        logger.info("shutting down")
        service.pipeline.stop()


if __name__ == "__main__":
    main()
