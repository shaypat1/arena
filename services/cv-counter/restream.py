#!/usr/bin/env python3
"""
Restream pipeline: HLS in → YOLO → annotated HLS out.

Reads stencil (trapezoid + tint) from the database per camera.

Usage:
  python restream.py --camera-id <external_id> [--model yolov8n.pt] [--conf 0.25] [--fps 15]
  python restream.py --url <hls_url> [--stencil '{"green_line":...}']
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import threading
import time

import cv2
import numpy as np
import psycopg2
from ultralytics import YOLO

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("restream")

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "api", "stream")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena")
VEHICLE_CLASSES = {2: "car", 3: "moto", 5: "bus", 7: "truck"}
GREEN = (52, 211, 153)
RED = (68, 68, 239)
AMBER = (21, 204, 250)
WHITE = (255, 255, 255)

# Default stencil if none in DB
DEFAULT_STENCIL = {
    "green_line": {"y": 0.40, "left": 0.10, "right": 0.90},
    "amber_line": {"y": 0.65, "left": 0.10, "right": 0.90},
    "dark_tint": 0.3,
}


def load_camera_from_db(camera_id):
    """Load camera URL and stencil from database."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT image_url, roi_geometry, name FROM cameras WHERE external_id = %s",
                (camera_id,),
            )
            row = cur.fetchone()
            if row:
                roi = row[1]
                if isinstance(roi, str):
                    roi = json.loads(roi)
                return {"url": row[0], "stencil": roi or DEFAULT_STENCIL, "name": row[2]}
    finally:
        conn.close()
    return None


class Tracker:
    def __init__(self, max_gone=45, max_dist=200):
        self.next_id = 0
        self.tracks = {}
        self.max_gone = max_gone
        self.max_dist = max_dist

    def update(self, dets):
        for tid in list(self.tracks):
            self.tracks[tid]["gone"] += 1
            if self.tracks[tid]["gone"] > self.max_gone:
                del self.tracks[tid]
        if not dets:
            return
        used = set()
        for tid in list(self.tracks):
            t = self.tracks[tid]
            best_j, best_d = -1, self.max_dist
            for j, d in enumerate(dets):
                if j in used:
                    continue
                dist = ((t["cx"] - d["cx"]) ** 2 + (t["cy"] - d["cy"]) ** 2) ** 0.5
                if dist < best_d:
                    best_d = dist
                    best_j = j
            if best_j >= 0:
                d = dets[best_j]
                self.tracks[tid]["prev_cy"] = self.tracks[tid]["cy"]
                self.tracks[tid].update(**d, gone=0)
                used.add(best_j)
        for j, d in enumerate(dets):
            if j not in used:
                self.tracks[self.next_id] = {
                    **d, "prev_cy": d["cy"], "gone": 0,
                    "crossed_green": False, "crossed_amber": False, "counted": False,
                }
                self.next_id += 1

    def check_gate(self, stencil, w, h, frame_idx=0):
        """Count when a car is first seen inside the trapezoid. Once per track."""
        gl = stencil.get("green_line", {"y": 0.40, "left": 0.10, "right": 0.90})
        al = stencil.get("amber_line", {"y": 0.65, "left": 0.10, "right": 0.90})

        g_y = int(h * gl["y"])
        g_left = int(w * gl["left"])
        g_right = int(w * gl["right"])
        a_y = int(h * al["y"])
        a_left = int(w * al["left"])
        a_right = int(w * al["right"])

        trap = np.array([[g_left, g_y], [g_right, g_y], [a_right, a_y], [a_left, a_y]])

        counted = []
        for tid, t in self.tracks.items():
            if t["counted"] or t["gone"] > 3:
                continue

            cx, cy = int(t["cx"]), int(t["cy"])

            if cv2.pointPolygonTest(trap, (cx, cy), False) >= 0:
                t["counted"] = True
                counted.append(tid)
                logger.info(f"  COUNT t={tid} cx={cx} cy={cy}")

        return counted


def get_trap(stencil, w, h):
    """Compute trapezoid pixel coordinates from a stencil."""
    gl = stencil.get("green_line", DEFAULT_STENCIL["green_line"])
    al = stencil.get("amber_line", DEFAULT_STENCIL["amber_line"])
    g_y = int(h * gl["y"])
    g_left = int(w * gl["left"])
    g_right = int(w * gl["right"])
    a_y = int(h * al["y"])
    a_left = int(w * al["left"])
    a_right = int(w * al["right"])
    tint = stencil.get("dark_tint", 0.3)
    return g_y, g_left, g_right, a_y, a_left, a_right, tint


cumulative_in_view = set()

def annotate(frame, tracker, count, stencil):
    h, w = frame.shape[:2]
    g_y, g_left, g_right, a_y, a_left, a_right, tint = get_trap(stencil, w, h)

    trap_pts = np.array([[g_left, g_y], [g_right, g_y], [a_right, a_y], [a_left, a_y]])

    # Dark tint outside
    mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(mask, [trap_pts], 255)
    dark = frame.copy()
    dark[mask == 0] = (dark[mask == 0] * tint).astype(np.uint8)
    frame[:] = dark

    # Lines
    cv2.line(frame, (g_left, g_y), (g_right, g_y), GREEN, 2)
    cv2.line(frame, (a_left, a_y), (a_right, a_y), AMBER, 2)
    cv2.line(frame, (g_left, g_y), (a_left, a_y), GREEN, 2)
    cv2.line(frame, (g_right, g_y), (a_right, a_y), GREEN, 2)

    # Bounding boxes — only inside trapezoid, track cumulative
    global cumulative_in_view
    for tid, t in tracker.tracks.items():
        if t["gone"] > 3:
            continue
        cx, cy = int(t["cx"]), int(t["cy"])
        if cv2.pointPolygonTest(trap_pts, (cx, cy), False) < 0:
            continue
        cumulative_in_view.add(tid)
    in_view = len(cumulative_in_view)
        color = RED if t.get("counted") else GREEN
        cv2.rectangle(frame, (int(t["x1"]), int(t["y1"])), (int(t["x2"]), int(t["y2"])), color, 2)
        lbl = f"#{tid} {VEHICLE_CLASSES.get(t['cls'], '?')}"
        cv2.putText(frame, lbl, (int(t["x1"]), int(t["y1"]) - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)

    # Count badge — top right
    cv2.rectangle(frame, (w - 160, 5), (w - 5, 70), (0, 0, 0), -1)
    cv2.rectangle(frame, (w - 160, 5), (w - 5, 70), GREEN, 2)
    cv2.putText(frame, "COUNTED", (w - 150, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.4, WHITE, 1)
    cv2.putText(frame, str(count), (w - 60, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.5, GREEN, 2)
    cv2.putText(frame, "IN VIEW", (w - 150, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.4, WHITE, 1)
    cv2.putText(frame, str(in_view), (w - 60, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.5, AMBER, 2)

    return frame, in_view


def run(url, stencil, model_path, conf, out_fps, out_w, out_h):
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    logger.info(f"Loading {model_path}...")
    model = YOLO(model_path)
    model(np.zeros((out_h, out_w, 3), dtype=np.uint8), verbose=False)
    logger.info("Model ready")

    hls_path = os.path.join(OUTPUT_DIR, "stream.m3u8")
    out_proc = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-pix_fmt", "bgr24", "-s", f"{out_w}x{out_h}", "-r", str(out_fps),
        "-i", "pipe:0",
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-g", str(out_fps * 2),
        "-b:v", "2000k", "-maxrate", "2500k", "-bufsize", "4000k",
        "-pix_fmt", "yuv420p",
        "-f", "hls",
        "-hls_time", "2",
        "-hls_list_size", "6",
        "-hls_flags", "delete_segments+append_list",
        "-hls_segment_filename", os.path.join(OUTPUT_DIR, "seg_%05d.ts"),
        hls_path,
    ], stdin=subprocess.PIPE)

    in_proc = subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "warning",
        "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "-i", url,
        "-vf", f"scale={out_w}:{out_h},fps={out_fps}",
        "-pix_fmt", "bgr24",
        "-f", "rawvideo",
        "pipe:1",
    ], stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def log_stderr():
        for line in in_proc.stderr:
            msg = line.decode().strip()
            if msg:
                logger.warning(f"[input] {msg}")
    threading.Thread(target=log_stderr, daemon=True).start()

    tracker = Tracker()
    count = 0
    frame_size = out_w * out_h * 3
    frame_idx = 0
    t_start = time.time()

    logger.info(f"Stencil: {json.dumps(stencil)}")
    logger.info(f"Processing at {out_w}x{out_h} @ {out_fps}fps, conf={conf}")
    logger.info(f"Counting: car must cross BOTH green and amber lines within trapezoid bounds")

    try:
        while True:
            raw = in_proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                logger.warning("Input ended")
                break

            frame = np.frombuffer(raw, dtype=np.uint8).reshape((out_h, out_w, 3))

            results = model(frame, verbose=False, conf=conf)
            dets = []
            for box in results[0].boxes:
                cls = int(box.cls[0])
                if cls not in VEHICLE_CLASSES:
                    continue
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                dets.append({"cx": (x1 + x2) / 2, "cy": (y1 + y2) / 2,
                             "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                             "cls": cls, "conf": float(box.conf[0])})

            tracker.update(dets)
            newly_counted = tracker.check_gate(stencil, out_w, out_h)
            count += len(newly_counted)

            annotated, in_view = annotate(frame.copy(), tracker, count, stencil)

            try:
                out_proc.stdin.write(annotated.tobytes())
            except BrokenPipeError:
                break

            frame_idx += 1
            if frame_idx % (out_fps * 10) == 0:
                elapsed = time.time() - t_start
                logger.info(f"frame={frame_idx} count={count} in_view={in_view} fps={frame_idx / elapsed:.1f}")

    except KeyboardInterrupt:
        logger.info("Interrupted")
    finally:
        in_proc.kill()
        out_proc.stdin.close()
        out_proc.wait()
        logger.info(f"Done. frames={frame_idx} cars={count}")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--camera-id", help="Load URL + stencil from DB by external_id")
    p.add_argument("--url", help="Direct HLS URL (if not using --camera-id)")
    p.add_argument("--stencil", help="JSON stencil (if not using --camera-id)")
    p.add_argument("--model", default="yolov8n.pt")
    p.add_argument("--conf", type=float, default=0.25)
    p.add_argument("--fps", type=int, default=15)
    p.add_argument("--width", type=int, default=960)
    p.add_argument("--height", type=int, default=540)
    args = p.parse_args()

    if args.camera_id:
        cam = load_camera_from_db(args.camera_id)
        if not cam:
            print(f"Camera '{args.camera_id}' not found in DB")
            sys.exit(1)
        logger.info(f"Camera: {cam['name']}")
        run(cam["url"], cam["stencil"], args.model, args.conf, args.fps, args.width, args.height)
    elif args.url:
        stencil = json.loads(args.stencil) if args.stencil else DEFAULT_STENCIL
        run(args.url, stencil, args.model, args.conf, args.fps, args.width, args.height)
    else:
        print("Provide --camera-id or --url")
        sys.exit(1)
