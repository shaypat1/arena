"""
main.py -- Entry point for the Arena CV Pipeline service.

Responsibilities:
  1. Load active feed configurations from the database.
  2. Load the shared YOLOv8 model once.
  3. Spawn a FeedWorker thread per active feed.
  4. Gracefully shut down on SIGTERM / SIGINT.
"""

import logging
import os
import signal
import sys
import threading
import time

import psycopg2

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("cv-pipeline")

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena"
)
POLL_INTERVAL = int(os.environ.get("FEED_POLL_INTERVAL", "60"))


# ------------------------------------------------------------------
# Database helpers
# ------------------------------------------------------------------

def connect_postgres() -> psycopg2.extensions.connection:
    """Connect to PostgreSQL with retries."""
    max_retries = 10
    for attempt in range(1, max_retries + 1):
        try:
            logger.info("Connecting to PostgreSQL (attempt %d/%d)", attempt, max_retries)
            conn = psycopg2.connect(DATABASE_URL)
            conn.autocommit = True
            logger.info("PostgreSQL connection established")
            return conn
        except psycopg2.OperationalError:
            if attempt == max_retries:
                raise
            delay = min(2 ** attempt, 30)
            logger.warning("PostgreSQL not ready -- retrying in %ds", delay)
            time.sleep(delay)


def fetch_active_feeds(conn) -> list[dict]:
    """Return all active feeds from the database."""
    query = """
        SELECT id, name, slug, stream_url, category, timezone
        FROM feeds
        WHERE is_active = true
        ORDER BY name;
    """
    with conn.cursor() as cur:
        cur.execute(query)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


# ------------------------------------------------------------------
# Model loading
# ------------------------------------------------------------------

def load_model():
    """Load the YOLOv8 nano model.

    On first run this downloads ~6 MB to ~/.cache/ultralytics.
    """
    logger.info("Loading YOLOv8 nano model ...")
    from ultralytics import YOLO
    model = YOLO("yolov8n.pt")
    logger.info("Model loaded successfully")
    return model


# ------------------------------------------------------------------
# Worker management
# ------------------------------------------------------------------

def spawn_workers(feeds: list[dict], model, stop_event: threading.Event) -> list[threading.Thread]:
    """Create and start a FeedWorker thread for each feed."""
    from feed_worker import FeedWorker

    threads = []
    for feed in feeds:
        worker = FeedWorker(feed=feed, model=model, stop_event=stop_event)
        t = threading.Thread(
            target=worker.run,
            name=f"feed-{feed['slug']}",
            daemon=True,
        )
        t.start()
        threads.append(t)
        logger.info("Spawned worker thread for feed: %s", feed["name"])
    return threads


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("Arena CV Pipeline starting")
    logger.info("=" * 60)

    stop_event = threading.Event()

    # -- Signal handling for graceful shutdown ----------------------
    def _shutdown(signum, _frame):
        sig_name = signal.Signals(signum).name
        logger.info("Received %s -- initiating graceful shutdown", sig_name)
        stop_event.set()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # -- Connect to database and load feeds ------------------------
    pg_conn = connect_postgres()
    feeds = fetch_active_feeds(pg_conn)

    if not feeds:
        logger.warning("No active feeds found in the database -- exiting")
        sys.exit(0)

    logger.info("Found %d active feed(s):", len(feeds))
    for f in feeds:
        logger.info("  - %s  [%s]  %s", f["name"], f["slug"], f["stream_url"][:80])

    # -- Load YOLO model once (shared across threads) ---------------
    model = load_model()

    # -- Spawn worker threads --------------------------------------
    threads = spawn_workers(feeds, model, stop_event)

    # -- Main thread: monitor and refresh feeds periodically --------
    logger.info("CV Pipeline running -- %d worker(s) active", len(threads))

    try:
        while not stop_event.is_set():
            stop_event.wait(timeout=POLL_INTERVAL)

            if stop_event.is_set():
                break

            # Check for new / removed feeds
            try:
                current_feeds = fetch_active_feeds(pg_conn)
            except psycopg2.OperationalError:
                logger.warning("DB connection lost during poll -- reconnecting")
                try:
                    pg_conn = connect_postgres()
                    current_feeds = fetch_active_feeds(pg_conn)
                except Exception:
                    logger.exception("Failed to reconnect to DB")
                    continue

            current_ids = {str(f["id"]) for f in current_feeds}
            running_ids = {str(f["id"]) for f in feeds}

            new_feeds = [f for f in current_feeds if str(f["id"]) not in running_ids]
            if new_feeds:
                logger.info("Detected %d new feed(s) -- spawning workers", len(new_feeds))
                new_threads = spawn_workers(new_feeds, model, stop_event)
                threads.extend(new_threads)
                feeds.extend(new_feeds)

            # Check for dead threads
            alive_count = sum(1 for t in threads if t.is_alive())
            if alive_count < len(threads):
                logger.warning(
                    "%d of %d worker threads have died",
                    len(threads) - alive_count,
                    len(threads),
                )

    except Exception:
        logger.exception("Fatal error in main loop")
    finally:
        logger.info("Shutting down -- signalling all workers to stop")
        stop_event.set()

        # Wait for threads to finish
        for t in threads:
            t.join(timeout=10)
            if t.is_alive():
                logger.warning("Thread %s did not stop in time", t.name)

        logger.info("CV Pipeline shut down cleanly")


if __name__ == "__main__":
    main()
