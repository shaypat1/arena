-- 004_cameras.sql
-- Camera pool for random rotation per round

BEGIN;

-- Individual cameras within a feed category
CREATE TABLE IF NOT EXISTS cameras (
    id          SERIAL PRIMARY KEY,
    feed_id     UUID NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    external_id VARCHAR(50) NOT NULL,           -- e.g. "60" for 511ny camera #60
    name        VARCHAR(200),
    image_url   VARCHAR(500) NOT NULL,          -- snapshot URL that refreshes
    source      VARCHAR(100) DEFAULT '511ny',   -- source system
    is_active   BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(feed_id, external_id)
);

-- Add current_camera_id to rounds so each round knows which camera it's showing
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS camera_id INT REFERENCES cameras(id);

COMMIT;
