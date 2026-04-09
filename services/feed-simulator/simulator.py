import redis
import psycopg2
import json
import random
import time
import datetime
import os
import numpy as np
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("feed-simulator")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://arena:arena_dev@localhost:5432/arena"
)

# Realistic car-color distribution
COLOR_WEIGHTS = {
    "white":  0.30,
    "black":  0.25,
    "silver": 0.20,
    "red":    0.12,
    "blue":   0.08,
    "green":  0.03,
    "yellow": 0.01,
    "other":  0.01,
}

COLOR_RGB_MAP = {
    "white":  [240, 240, 240],
    "black":  [20, 20, 20],
    "silver": [192, 192, 192],
    "red":    [200, 30, 30],
    "blue":   [30, 60, 200],
    "green":  [30, 160, 50],
    "yellow": [230, 220, 40],
    "other":  [128, 128, 128],
}

VEHICLE_CLASSES = ["sedan", "suv", "truck", "hatchback", "coupe", "van", "minivan"]

PEDESTRIAN_COUNT_MEAN = 12
OVER_UNDER_THRESHOLD = 12.5


def connect_redis():
    """Establish a connection to Redis."""
    logger.info("Connecting to Redis at %s", REDIS_URL)
    client = redis.Redis.from_url(REDIS_URL, decode_responses=True)
    client.ping()
    logger.info("Redis connection established")
    return client


def connect_postgres():
    """Establish a connection to PostgreSQL."""
    logger.info("Connecting to PostgreSQL at %s", DATABASE_URL)
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    logger.info("PostgreSQL connection established")
    return conn


def fetch_locked_rounds(pg_conn):
    """Query all rounds currently in 'locked' status."""
    query = """
        SELECT
            r.id        AS round_id,
            r.feed_id   AS feed_id,
            bt.slug     AS bet_type_slug,
            bt.settlement_method AS settlement_method
        FROM rounds r
        JOIN bet_types bt ON r.bet_type_id = bt.id
        WHERE r.status = 'locked'
        ORDER BY r.created_at ASC;
    """
    with pg_conn.cursor() as cur:
        cur.execute(query)
        columns = [desc[0] for desc in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def generate_color_settlement(round_info):
    """Generate a settlement event for cv_color bet type."""
    colors = list(COLOR_WEIGHTS.keys())
    weights = list(COLOR_WEIGHTS.values())
    chosen_color = random.choices(colors, weights=weights, k=1)[0]

    confidence = round(random.uniform(0.85, 0.99), 2)
    vehicle_class = random.choice(VEHICLE_CLASSES)
    vehicle_confidence = round(random.uniform(0.88, 0.99), 2)

    return {
        "feed_id": round_info["feed_id"],
        "bet_type_slug": round_info["bet_type_slug"],
        "round_id": round_info["round_id"],
        "outcome": chosen_color,
        "confidence": confidence,
        "detection_data": {
            "color_rgb": COLOR_RGB_MAP[chosen_color],
            "vehicle_class": vehicle_class,
            "vehicle_confidence": vehicle_confidence,
        },
        "frame_url": f"https://placeholder.com/frames/settlement_{round_info['round_id']}.jpg",
        "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }


def generate_count_settlement(round_info):
    """Generate a settlement event for cv_count bet type."""
    count = int(np.random.poisson(lam=PEDESTRIAN_COUNT_MEAN))
    outcome = "over" if count > OVER_UNDER_THRESHOLD else "under"

    confidence = round(random.uniform(0.82, 0.97), 2)

    return {
        "feed_id": round_info["feed_id"],
        "bet_type_slug": round_info["bet_type_slug"],
        "round_id": round_info["round_id"],
        "outcome": outcome,
        "confidence": confidence,
        "detection_data": {
            "pedestrian_count": count,
            "threshold": OVER_UNDER_THRESHOLD,
            "counted_objects": count,
        },
        "frame_url": f"https://placeholder.com/frames/settlement_{round_info['round_id']}.jpg",
        "timestamp": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z"),
    }


SETTLEMENT_GENERATORS = {
    "cv_color": generate_color_settlement,
    "cv_count": generate_count_settlement,
}


def process_round(redis_client, round_info):
    """Generate and publish a settlement event for a single locked round."""
    method = round_info["settlement_method"]
    generator = SETTLEMENT_GENERATORS.get(method)

    if generator is None:
        logger.warning(
            "Unknown settlement method '%s' for round %s — skipping",
            method,
            round_info["round_id"],
        )
        return

    event = generator(round_info)

    payload = json.dumps(event)
    redis_client.publish("settlement", payload)

    logger.info(
        "Published settlement for round %s  method=%s  outcome=%s  confidence=%.2f",
        round_info["round_id"],
        method,
        event["outcome"],
        event["confidence"],
    )


def main():
    logger.info("Feed simulator starting up")

    redis_client = connect_redis()
    pg_conn = connect_postgres()

    logger.info("Entering main loop — polling for locked rounds")

    while True:
        try:
            rounds = fetch_locked_rounds(pg_conn)

            if rounds:
                logger.info("Found %d locked round(s) to settle", len(rounds))
                for round_info in rounds:
                    process_round(redis_client, round_info)
            else:
                logger.debug("No locked rounds found")

        except psycopg2.OperationalError:
            logger.exception("Lost PostgreSQL connection — reconnecting")
            try:
                pg_conn = connect_postgres()
            except Exception:
                logger.exception("PostgreSQL reconnect failed")

        except redis.ConnectionError:
            logger.exception("Lost Redis connection — reconnecting")
            try:
                redis_client = connect_redis()
            except Exception:
                logger.exception("Redis reconnect failed")

        except Exception:
            logger.exception("Unexpected error in main loop")

        delay = random.uniform(2, 5)
        logger.debug("Sleeping %.1fs before next poll", delay)
        time.sleep(delay)


if __name__ == "__main__":
    main()
