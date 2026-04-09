-- 002_seed_feeds.sql
-- Seed: house account, live-cam feeds, bet types, and house balance

BEGIN;

-- ============================================================
-- House user
-- ============================================================
INSERT INTO users (id, username, email, password_hash, is_house)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'house',
    'house@arena.gg',
    -- bcrypt placeholder; the house account is not login-accessible
    '$2a$12$000000000000000000000000000000000000000000000000000000',
    true
);

-- House balance: $10,000 = 10,000,000,000 micro-USD
INSERT INTO balances (user_id, currency, available, locked)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'USD',
    10000000000,
    0
);

-- ============================================================
-- Feeds
-- ============================================================
INSERT INTO feeds (id, name, slug, description, stream_url, thumbnail_url, category, timezone, is_active)
VALUES
(
    '10000000-0000-0000-0000-000000000001',
    'Times Square Crosswalk',
    'times-square-crosswalk',
    'Live view of the Times Square crosswalk at Broadway and 7th Avenue, New York City.',
    'https://www.youtube.com/embed/rnXIjl_Rzy4?autoplay=1&mute=1',
    'https://img.youtube.com/vi/rnXIjl_Rzy4/hqdefault.jpg',
    'traffic',
    'America/New_York',
    true
),
(
    '10000000-0000-0000-0000-000000000002',
    'Rome Piazza Venezia',
    'rome-piazza-venezia',
    'Live view of Piazza Venezia in Rome, Italy — one of the busiest intersections in the city.',
    'https://www.youtube.com/embed/0bjlTofpCLE?autoplay=1&mute=1',
    'https://img.youtube.com/vi/0bjlTofpCLE/hqdefault.jpg',
    'traffic',
    'Europe/Rome',
    true
),
(
    '10000000-0000-0000-0000-000000000003',
    'Rome Prati Street',
    'rome-prati-street',
    'Live street view of the Prati neighborhood in Rome, Italy.',
    'https://www.youtube.com/embed/VzPbcndoD40?autoplay=1&mute=1',
    'https://img.youtube.com/vi/VzPbcndoD40/hqdefault.jpg',
    'traffic',
    'Europe/Rome',
    true
),
(
    '10000000-0000-0000-0000-000000000004',
    'Narvik Harbour',
    'narvik-harbour',
    'Live view of Narvik harbour and city in northern Norway.',
    'https://www.youtube.com/embed/OJneSeFqaaw?autoplay=1&mute=1',
    'https://img.youtube.com/vi/OJneSeFqaaw/hqdefault.jpg',
    'traffic',
    'Europe/Oslo',
    true
);

-- ============================================================
-- Bet Types
-- ============================================================

-- ----------------------------------------------------------
-- Times Square: Next Car Color + Pedestrian Count
-- ----------------------------------------------------------
INSERT INTO bet_types (feed_id, name, slug, description, category, settlement_method, options, seed_distribution, seed_amount, round_duration_seconds, min_bet, max_bet)
VALUES
(
    '10000000-0000-0000-0000-000000000001',
    'Next Car Color',
    'next-car-color',
    'Predict the dominant color of the next car to cross the frame.',
    'vehicle',
    'cv_color',
    '["white","black","silver","red","blue","green","yellow","other"]',
    '{"white": 0.24, "black": 0.22, "silver": 0.18, "red": 0.10, "blue": 0.09, "green": 0.04, "yellow": 0.03, "other": 0.10}',
    100000000,   -- $100 seed
    60,
    100000,      -- $0.10 min
    100000000    -- $100 max
),
(
    '10000000-0000-0000-0000-000000000001',
    'Pedestrian Count',
    'pedestrian-count',
    'Will the number of pedestrians crossing in the next 60 seconds be over or under the line?',
    'pedestrian',
    'cv_count',
    '["over","under"]',
    '{"over": 0.50, "under": 0.50}',
    100000000,
    60,
    100000,
    100000000
);

-- ----------------------------------------------------------
-- Abbey Road: Next Car Color + Pedestrian Count
-- ----------------------------------------------------------
INSERT INTO bet_types (feed_id, name, slug, description, category, settlement_method, options, seed_distribution, seed_amount, round_duration_seconds, min_bet, max_bet)
VALUES
(
    '10000000-0000-0000-0000-000000000002',
    'Next Car Color',
    'next-car-color',
    'Predict the dominant color of the next car to pass the crossing.',
    'vehicle',
    'cv_color',
    '["white","black","silver","red","blue","green","yellow","other"]',
    '{"white": 0.22, "black": 0.24, "silver": 0.20, "red": 0.08, "blue": 0.10, "green": 0.03, "yellow": 0.02, "other": 0.11}',
    100000000,
    60,
    100000,
    100000000
),
(
    '10000000-0000-0000-0000-000000000002',
    'Pedestrian Count',
    'pedestrian-count',
    'Will the number of pedestrians crossing Abbey Road in the next 60 seconds be over or under the line?',
    'pedestrian',
    'cv_count',
    '["over","under"]',
    '{"over": 0.50, "under": 0.50}',
    100000000,
    60,
    100000,
    100000000
);

-- ----------------------------------------------------------
-- Jackson Hole: Next Car Color + Pedestrian Count
-- ----------------------------------------------------------
INSERT INTO bet_types (feed_id, name, slug, description, category, settlement_method, options, seed_distribution, seed_amount, round_duration_seconds, min_bet, max_bet)
VALUES
(
    '10000000-0000-0000-0000-000000000003',
    'Next Car Color',
    'next-car-color',
    'Predict the dominant color of the next vehicle to cross the town square frame.',
    'vehicle',
    'cv_color',
    '["white","black","silver","red","blue","green","yellow","other"]',
    '{"white": 0.28, "black": 0.18, "silver": 0.16, "red": 0.10, "blue": 0.08, "green": 0.05, "yellow": 0.03, "other": 0.12}',
    100000000,
    60,
    100000,
    100000000
),
(
    '10000000-0000-0000-0000-000000000003',
    'Pedestrian Count',
    'pedestrian-count',
    'Will the number of pedestrians in the Jackson Hole square in the next 60 seconds be over or under the line?',
    'pedestrian',
    'cv_count',
    '["over","under"]',
    '{"over": 0.50, "under": 0.50}',
    100000000,
    60,
    100000,
    100000000
);

-- ----------------------------------------------------------
-- Nampo Port Fish Market: Next Car Color + Pedestrian Count
-- ----------------------------------------------------------
INSERT INTO bet_types (feed_id, name, slug, description, category, settlement_method, options, seed_distribution, seed_amount, round_duration_seconds, min_bet, max_bet)
VALUES
(
    '10000000-0000-0000-0000-000000000004',
    'Next Car Color',
    'next-car-color',
    'Predict the dominant color of the next vehicle near the Nampo Port market.',
    'vehicle',
    'cv_color',
    '["white","black","silver","red","blue","green","yellow","other"]',
    '{"white": 0.30, "black": 0.16, "silver": 0.20, "red": 0.08, "blue": 0.08, "green": 0.04, "yellow": 0.02, "other": 0.12}',
    100000000,
    60,
    100000,
    100000000
),
(
    '10000000-0000-0000-0000-000000000004',
    'Pedestrian Count',
    'pedestrian-count',
    'Will the number of pedestrians near the Nampo fish market in the next 60 seconds be over or under the line?',
    'pedestrian',
    'cv_count',
    '["over","under"]',
    '{"over": 0.50, "under": 0.50}',
    100000000,
    60,
    100000,
    100000000
);

COMMIT;
