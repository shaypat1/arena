"""
Clip-based CV counter service.

Listens for round:opened events, downloads clips, counts cars,
publishes settlements. Simpler than the frame-streaming pipeline.
"""

import json
import logging
import os
import sys
import threading

import psycopg2
import redis as redispy
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from clip_processor import process_round

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("cv-counter")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena")
YOLO_MODEL = os.environ.get("YOLO_MODEL", "yolov8n.pt")

# Load model once
logger.info(f"Loading YOLO model: {YOLO_MODEL}")
model = YOLO(YOLO_MODEL)
# Warm up
import numpy as np
model(np.zeros((540, 960, 3), dtype=np.uint8), verbose=False)
logger.info("Model loaded and warmed up")

# Redis connections
redis_pub = redispy.Redis.from_url(REDIS_URL, decode_responses=True)
redis_sub = redispy.Redis.from_url(REDIS_URL, decode_responses=True)

# Track active processing to avoid double-processing
processing_lock = threading.Lock()
currently_processing = None


def get_camera_info(round_id):
    """Fetch camera URL and ROI from the database for a round."""
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT c.image_url, c.roi_geometry, c.name
                FROM rounds r
                JOIN cameras c ON r.camera_id = c.id
                WHERE r.id = %s
            """, (round_id,))
            row = cur.fetchone()
            if row:
                return {"url": row[0], "roi": row[1], "name": row[2]}
    finally:
        conn.close()
    return None


def handle_round(round_data):
    """Process a round in a background thread."""
    global currently_processing

    round_id = round_data.get("round_id")
    camera = round_data.get("camera", {})
    camera_url = camera.get("image_url")
    roi = camera.get("roi_geometry")

    if not round_id or not camera_url:
        return

    with processing_lock:
        if currently_processing == round_id:
            return
        currently_processing = round_id

    def _process():
        global currently_processing
        try:
            # If no ROI from the event, fetch from DB
            if not roi:
                info = get_camera_info(round_id)
                roi_geom = info["roi"] if info else None
            else:
                roi_geom = roi

            process_round(model, round_id, camera_url, roi_geom, redis_pub)
        except Exception as e:
            logger.error(f"Failed to process round {round_id[:8]}: {e}")
        finally:
            with processing_lock:
                currently_processing = None

    thread = threading.Thread(target=_process, daemon=True)
    thread.start()


def main():
    logger.info("Clip-based CV counter starting")
    logger.info(f"Clips will be saved to: {os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'api', 'clips'))}")

    # Process any locked rounds that need settlement
    conn = psycopg2.connect(DATABASE_URL)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT r.id, c.image_url, c.roi_geometry
            FROM rounds r
            JOIN cameras c ON r.camera_id = c.id
            WHERE r.status = 'locked'
            ORDER BY r.created_at DESC
            LIMIT 1
        """)
        row = cur.fetchone()
        if row:
            logger.info(f"Found locked round {row[0][:8]}, processing...")
            process_round(model, row[0], row[1], row[2], redis_pub)
    conn.close()

    # Subscribe to round events
    pubsub = redis_sub.pubsub()
    pubsub.subscribe("round_state")
    logger.info("Listening for round events...")

    for message in pubsub.listen():
        if message["type"] != "message":
            continue
        try:
            data = json.loads(message["data"])
            if data.get("event") == "round:opened":
                logger.info(f"Round opened: {data.get('round_id', '?')[:8]} camera={data.get('camera', {}).get('name', '?')}")
                handle_round(data)
        except Exception as e:
            logger.error(f"Error handling message: {e}")


if __name__ == "__main__":
    main()
