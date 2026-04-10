"""
Offline calibration harness.

Usage:
  # 1. Capture N 15-second clips from a live HLS stream
  ./venv/bin/python calibrate.py capture <hls_url> 10

  # 2. Open each clip (in calibration_clips/), watch, and fill in a manual
  #    count in calibration_clips/ground_truth.json. Format:
  #      { "clip_01.mp4": { "count": 14 } }

  # 3. Run the counter against each clip and compare to ground truth
  ./venv/bin/python calibrate.py run

The `run` command loads the ROI for `ca-i405-carson` from the DB by default,
or accepts --roi-json to override.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from counter import LineCrossingCounter  # noqa: E402
from pipeline import (  # noqa: E402
    BYTETRACK_CFG,
    COUNTED_CLASSES,
    CV_CONF_THRESHOLD,
    CV_IMGSZ,
    CV_IOU_THRESHOLD,
    FFMPEG_BIN,
    FRAME_H,
    FRAME_W,
    FRAME_FPS,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cv-counter.calibrate")

CLIPS_DIR = Path(os.path.dirname(os.path.abspath(__file__))) / "calibration_clips"
GROUND_TRUTH_PATH = CLIPS_DIR / "ground_truth.json"
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena"
)


def cmd_capture(hls_url: str, count: int, clip_seconds: int = 15) -> None:
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    logger.info("capturing %d x %ds clips from %s", count, clip_seconds, hls_url)
    for i in range(1, count + 1):
        out_path = CLIPS_DIR / f"clip_{i:02d}.mp4"
        logger.info("[%d/%d] → %s", i, count, out_path.name)
        cmd = [
            FFMPEG_BIN,
            "-hide_banner",
            "-loglevel", "error",
            "-y",
            "-i", hls_url,
            "-t", str(clip_seconds),
            "-c:v", "libx264",
            "-preset", "fast",
            "-an",
            str(out_path),
        ]
        rc = subprocess.call(cmd)
        if rc != 0:
            logger.warning("ffmpeg exit %d on clip %d — continuing", rc, i)
        # Wait a bit between captures so we don't grab the same segment
        time.sleep(1)

    # Ensure ground_truth.json exists
    if not GROUND_TRUTH_PATH.exists():
        GROUND_TRUTH_PATH.write_text("{}\n")

    # Populate ground_truth.json with empty entries for each clip
    try:
        gt = json.loads(GROUND_TRUTH_PATH.read_text() or "{}")
    except Exception:
        gt = {}
    # Strip comment/example keys
    gt = {k: v for k, v in gt.items() if not k.startswith("_")}
    for p in sorted(CLIPS_DIR.glob("clip_*.mp4")):
        gt.setdefault(p.name, {"count": None})
    GROUND_TRUTH_PATH.write_text(json.dumps(gt, indent=2) + "\n")
    logger.info("ground_truth.json updated — fill in 'count' values then run: calibrate.py run")


def load_roi_from_db(external_id: str = "ca-i405-carson") -> dict:
    pg = psycopg2.connect(DATABASE_URL)
    try:
        with pg.cursor() as cur:
            cur.execute(
                "SELECT roi_geometry FROM cameras WHERE external_id = %s", (external_id,)
            )
            row = cur.fetchone()
            if not row or not row[0]:
                raise RuntimeError(
                    f"camera {external_id} has no roi_geometry — run migration 006"
                )
            roi = row[0]
            if isinstance(roi, str):
                roi = json.loads(roi)
            return roi
    finally:
        pg.close()


def process_clip(clip_path: Path, roi: dict, model) -> int:
    """Run ffmpeg on the clip, pipe frames, run YOLO+tracker, return counted total."""
    counter = LineCrossingCounter(
        roi_geometry=roi, frame_w=FRAME_W, frame_h=FRAME_H
    )
    counter.enable_counting()

    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-i", str(clip_path),
        "-vf", f"fps={FRAME_FPS},scale={FRAME_W}:{FRAME_H}",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "-an",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_size = FRAME_W * FRAME_H * 3

    try:
        while True:
            raw = proc.stdout.read(frame_size)
            if not raw or len(raw) < frame_size:
                break
            frame = np.frombuffer(raw, dtype=np.uint8).reshape((FRAME_H, FRAME_W, 3))
            results = model.track(
                frame,
                persist=True,
                tracker=BYTETRACK_CFG,
                classes=COUNTED_CLASSES,
                conf=CV_CONF_THRESHOLD,
                iou=CV_IOU_THRESHOLD,
                imgsz=CV_IMGSZ,
                agnostic_nms=True,
                verbose=False,
            )
            if not results:
                continue
            r = results[0]
            if r.boxes is None or r.boxes.id is None:
                continue
            ids = r.boxes.id.cpu().numpy().astype(int)
            classes = r.boxes.cls.cpu().numpy().astype(int) if r.boxes.cls is not None else None
            xyxy = r.boxes.xyxy.cpu().numpy()
            for i in range(len(ids)):
                cx = (xyxy[i][0] + xyxy[i][2]) / 2.0
                cy = (xyxy[i][1] + xyxy[i][3]) / 2.0
                counter.observe(
                    int(ids[i]),
                    int(classes[i]) if classes is not None else 2,
                    cx,
                    cy,
                )
    finally:
        try:
            proc.kill()
        except Exception:
            pass

    # Reset Ultralytics tracker state between clips so track IDs don't leak
    try:
        if hasattr(model, "predictor") and model.predictor is not None:
            if hasattr(model.predictor, "trackers") and model.predictor.trackers:
                for t in model.predictor.trackers:
                    if hasattr(t, "reset"):
                        t.reset()
    except Exception:
        pass

    return counter.total()


def cmd_run() -> int:
    if not GROUND_TRUTH_PATH.exists():
        logger.error(
            "ground_truth.json not found — run `calibrate.py capture <url> N` first"
        )
        return 2

    gt = json.loads(GROUND_TRUTH_PATH.read_text())
    gt = {k: v for k, v in gt.items() if not k.startswith("_")}
    if not gt:
        logger.error("ground_truth.json has no clip entries")
        return 2

    # Verify that all ground truth counts are filled in
    missing = [name for name, info in gt.items() if info.get("count") is None]
    if missing:
        logger.error(
            "these clips have no manual count in ground_truth.json: %s",
            ", ".join(missing),
        )
        return 2

    roi = load_roi_from_db()
    logger.info("ROI loaded from DB: %s", roi)

    logger.info("loading YOLO model")
    from ultralytics import YOLO  # noqa: WPS433

    model = YOLO(os.environ.get("YOLO_MODEL", "yolov8s.pt"))
    # warm
    _ = model.predict(np.zeros((FRAME_H, FRAME_W, 3), dtype=np.uint8), imgsz=CV_IMGSZ, verbose=False)

    errors = []
    print()
    print(f"{'clip':<22} {'predicted':>10} {'actual':>8} {'error':>7}")
    print("-" * 52)
    for name in sorted(gt.keys()):
        path = CLIPS_DIR / name
        if not path.exists():
            logger.warning("missing clip file: %s", path)
            continue
        actual = int(gt[name]["count"])
        predicted = process_clip(path, roi, model)
        err = predicted - actual
        errors.append(abs(err))
        print(f"{name:<22} {predicted:>10} {actual:>8} {err:>+7}")

    n = len(errors)
    if n == 0:
        logger.error("no clips processed")
        return 2
    mae = sum(errors) / n
    max_error = max(errors)
    within_one = sum(1 for e in errors if e <= 1)
    print("-" * 52)
    print(
        f"MAE={mae:.2f}  max_error={max_error}  clips_within_±1={within_one}/{n}"
    )
    passing = mae <= 0.5 and max_error <= 1
    print("✓ PASS" if passing else "✗ FAIL — tune ROI or gate thresholds and retry")
    return 0 if passing else 1


def main():
    parser = argparse.ArgumentParser(prog="calibrate")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_capture = sub.add_parser("capture", help="capture clips from a live HLS url")
    p_capture.add_argument("hls_url")
    p_capture.add_argument("count", type=int)
    p_capture.add_argument("--seconds", type=int, default=15)

    sub.add_parser("run", help="run counter over captured clips and report MAE")

    args = parser.parse_args()
    if args.cmd == "capture":
        cmd_capture(args.hls_url, args.count, args.seconds)
    elif args.cmd == "run":
        sys.exit(cmd_run())


if __name__ == "__main__":
    main()
