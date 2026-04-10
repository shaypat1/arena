-- 006_car_count_and_roi.sql
-- Schema fix, new car-count bet_type, ROI geometry for ca-i405-carson.
--
-- Fixes:
--   1. Ensures `cameras.timezone` and `cameras.roi_geometry` columns exist
--      (004_cameras.sql forgot both; 005_seed_cameras.sql added timezone via
--      ad-hoc inserts. This makes fresh clones work without manual patching.)
--
--   2. Replaces the mismatched `pedestrian-count` (over/under) and
--      `next-car-color` (colors) bet_types on the traffic feed with a new
--      `car-count` bet_type (even/odd/zero) that matches what the
--      CarCountBetting UI actually sends.
--
--   3. Seeds ROI geometry for `ca-i405-carson` so the CV counter knows
--      where to count vehicles crossing the freeway.

BEGIN;

-- ─── 1. Schema fix ──────────────────────────────────────────────────
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS timezone VARCHAR(64);
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS roi_geometry JSONB;

-- ─── 2. Deactivate old traffic bet_types ────────────────────────────
-- Keep the rows for history; the scheduler only opens rounds for
-- is_active=true.
UPDATE bet_types
   SET is_active = false
 WHERE feed_id = '10000000-0000-0000-0000-000000000001'
   AND slug IN ('next-car-color', 'pedestrian-count');

-- ─── 3. Insert the new car-count bet_type ───────────────────────────
INSERT INTO bet_types (
    feed_id,
    name,
    slug,
    description,
    category,
    settlement_method,
    options,
    seed_distribution,
    seed_amount,
    round_duration_seconds,
    min_bet,
    max_bet,
    is_active
)
VALUES (
    '10000000-0000-0000-0000-000000000001',
    'Car Count',
    'car-count',
    'How many cars will cross the counting zone in 15 seconds?',
    'traffic',
    'cv_car_count',
    '["even","odd","zero"]'::jsonb,
    '{"even":0.48,"odd":0.48,"zero":0.04}'::jsonb,
    100000000,   -- $100 house seed
    15,          -- 15-second rounds
    100000,      -- $0.10 min
    100000000,   -- $100 max
    true
)
ON CONFLICT (feed_id, slug) DO UPDATE
   SET is_active           = true,
       settlement_method   = EXCLUDED.settlement_method,
       options             = EXCLUDED.options,
       seed_distribution   = EXCLUDED.seed_distribution,
       seed_amount         = EXCLUDED.seed_amount,
       round_duration_seconds = EXCLUDED.round_duration_seconds,
       min_bet             = EXCLUDED.min_bet,
       max_bet             = EXCLUDED.max_bet,
       description         = EXCLUDED.description,
       category            = EXCLUDED.category;

-- ─── 4. Seed ROI for ca-i405-carson ─────────────────────────────────
-- Initial guess: box covering the middle-right lanes, count line along
-- the bottom edge, direction = "down" (southbound toward camera).
-- Will be refined with a snapshot + sql UPDATE after calibration.
UPDATE cameras
   SET roi_geometry = '{
         "box": { "x": 0.15, "y": 0.55, "w": 0.70, "h": 0.15 },
         "count_edge": "bottom",
         "direction": "down"
       }'::jsonb
 WHERE external_id = 'ca-i405-carson';

COMMIT;
