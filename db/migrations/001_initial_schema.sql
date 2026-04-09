-- 001_initial_schema.sql
-- Arena platform: full PostgreSQL schema
-- Money stored as BIGINT micro-USD (1 USD = 1,000,000)

BEGIN;

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Custom ENUM types
-- ============================================================
CREATE TYPE transaction_type   AS ENUM ('deposit', 'withdrawal');
CREATE TYPE transaction_status AS ENUM ('pending', 'confirming', 'completed', 'failed');
CREATE TYPE round_status       AS ENUM ('open', 'locked', 'settled', 'cancelled', 'disputed');
CREATE TYPE bet_status         AS ENUM ('active', 'won', 'lost', 'cancelled', 'refunded');
CREATE TYPE dispute_status     AS ENUM ('open', 'under_review', 'resolved', 'rejected');

-- ============================================================
-- 1. users
-- ============================================================
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    username        VARCHAR(32) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_banned       BOOLEAN     NOT NULL DEFAULT false,
    is_house        BOOLEAN     NOT NULL DEFAULT false,
    total_wagered   BIGINT      NOT NULL DEFAULT 0,
    total_won       BIGINT      NOT NULL DEFAULT 0,
    total_profit    BIGINT      NOT NULL DEFAULT 0,
    win_count       INT         NOT NULL DEFAULT 0,
    loss_count      INT         NOT NULL DEFAULT 0,
    current_streak  INT         NOT NULL DEFAULT 0,
    best_streak     INT         NOT NULL DEFAULT 0
);

-- ============================================================
-- 2. balances
-- ============================================================
CREATE TABLE balances (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency    VARCHAR(10) NOT NULL DEFAULT 'USD',
    available   BIGINT      NOT NULL DEFAULT 0,
    locked      BIGINT      NOT NULL DEFAULT 0,
    CONSTRAINT  balances_available_non_negative CHECK (available >= 0),
    CONSTRAINT  balances_locked_non_negative    CHECK (locked >= 0),
    UNIQUE (user_id, currency)
);

CREATE INDEX idx_balances_user_id ON balances(user_id);

-- ============================================================
-- 3. transactions
-- ============================================================
CREATE TABLE transactions (
    id               UUID               PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID               NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type             transaction_type   NOT NULL,
    crypto_currency  VARCHAR(10),
    crypto_amount    VARCHAR(40),
    usd_amount       BIGINT,
    conversion_rate  NUMERIC(20, 8),
    tx_hash          VARCHAR(255),
    from_address     VARCHAR(255),
    to_address       VARCHAR(255),
    chain            VARCHAR(20),
    status           transaction_status NOT NULL DEFAULT 'pending',
    confirmations    INT                NOT NULL DEFAULT 0,
    created_at       TIMESTAMPTZ        NOT NULL DEFAULT now(),
    confirmed_at     TIMESTAMPTZ
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_status  ON transactions(status);
CREATE INDEX idx_transactions_tx_hash ON transactions(tx_hash);

-- ============================================================
-- 4. feeds
-- ============================================================
CREATE TABLE feeds (
    id             UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    name           VARCHAR(100) NOT NULL,
    slug           VARCHAR(100) UNIQUE NOT NULL,
    description    TEXT,
    stream_url     VARCHAR(500) NOT NULL,
    thumbnail_url  VARCHAR(500),
    category       VARCHAR(50),
    timezone       VARCHAR(50)  NOT NULL DEFAULT 'UTC',
    is_active      BOOLEAN      NOT NULL DEFAULT true,
    is_premium     BOOLEAN      NOT NULL DEFAULT false,
    viewer_count   INT          NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_feeds_category  ON feeds(category);
CREATE INDEX idx_feeds_is_active ON feeds(is_active);

-- ============================================================
-- 5. bet_types
-- ============================================================
CREATE TABLE bet_types (
    id                      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_id                 UUID         NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    name                    VARCHAR(100) NOT NULL,
    slug                    VARCHAR(100) NOT NULL,
    description             TEXT,
    category                VARCHAR(50),
    settlement_method       VARCHAR(50)  NOT NULL,
    options                 JSONB        NOT NULL,
    seed_distribution       JSONB        NOT NULL,
    seed_amount             BIGINT       NOT NULL DEFAULT 100000000,  -- $100
    round_duration_seconds  INT          NOT NULL DEFAULT 60,
    min_bet                 BIGINT       NOT NULL DEFAULT 100000,      -- $0.10
    max_bet                 BIGINT       NOT NULL DEFAULT 100000000,   -- $100
    is_active               BOOLEAN      NOT NULL DEFAULT true,
    UNIQUE (feed_id, slug)
);

CREATE INDEX idx_bet_types_feed_id ON bet_types(feed_id);

-- ============================================================
-- 6. rounds
-- ============================================================
CREATE TABLE rounds (
    id                      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_id                 UUID         NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    bet_type_id             UUID         NOT NULL REFERENCES bet_types(id) ON DELETE CASCADE,
    round_number            BIGINT,
    status                  round_status NOT NULL DEFAULT 'open',
    opens_at                TIMESTAMPTZ,
    locks_at                TIMESTAMPTZ,
    settled_at              TIMESTAMPTZ,
    winning_outcome         VARCHAR(100),
    settlement_data         JSONB,
    settlement_frame_url    VARCHAR(500),
    settlement_confidence   FLOAT,
    total_pool              BIGINT       NOT NULL DEFAULT 0,
    pool_state              JSONB        NOT NULL DEFAULT '{}',
    seed_amount             BIGINT       NOT NULL DEFAULT 0,
    rake_amount             BIGINT       NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_rounds_status           ON rounds(status);
CREATE INDEX idx_rounds_feed_bet_status  ON rounds(feed_id, bet_type_id, status);
CREATE INDEX idx_rounds_bet_type_id      ON rounds(bet_type_id);

-- ============================================================
-- 7. bets
-- ============================================================
CREATE TABLE bets (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round_id         UUID        NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    bet_type_id      UUID        NOT NULL REFERENCES bet_types(id) ON DELETE CASCADE,
    chosen_outcome   VARCHAR(100) NOT NULL,
    amount           BIGINT      NOT NULL,
    odds             FLOAT       NOT NULL,
    potential_payout BIGINT      NOT NULL,
    actual_payout    BIGINT      NOT NULL DEFAULT 0,
    status           bet_status  NOT NULL DEFAULT 'active',
    bet_hash         VARCHAR(64) NOT NULL,
    placed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    settled_at       TIMESTAMPTZ
);

CREATE INDEX idx_bets_user_status ON bets(user_id, status);
CREATE INDEX idx_bets_round_id    ON bets(round_id);
CREATE INDEX idx_bets_bet_type_id ON bets(bet_type_id);

-- ============================================================
-- 8. settlement_log
-- ============================================================
CREATE TABLE settlement_log (
    id                    UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id              UUID         NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    feed_id               UUID         NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    bet_type_slug         VARCHAR(100) NOT NULL,
    round_number          BIGINT,
    winning_outcome       VARCHAR(100) NOT NULL,
    detection_method      VARCHAR(50)  NOT NULL,
    detection_confidence  FLOAT        NOT NULL,
    detection_data        JSONB        NOT NULL,
    frame_url             VARCHAR(500) NOT NULL,
    clip_url              VARCHAR(500),
    settled_at            TIMESTAMPTZ  NOT NULL,
    total_bets            INT          NOT NULL,
    total_pool            BIGINT       NOT NULL,
    total_payout          BIGINT       NOT NULL,
    rake_amount           BIGINT       NOT NULL,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlement_log_round_id ON settlement_log(round_id);
CREATE INDEX idx_settlement_log_feed_id  ON settlement_log(feed_id);

-- ============================================================
-- 9. chat_messages
-- ============================================================
CREATE TABLE chat_messages (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    feed_id     UUID        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_feed_created ON chat_messages(feed_id, created_at DESC);

-- ============================================================
-- 10. disputes
-- ============================================================
CREATE TABLE disputes (
    id           UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_id     UUID           NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    user_id      UUID           NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason       TEXT           NOT NULL,
    status       dispute_status NOT NULL DEFAULT 'open',
    resolution   TEXT,
    resolved_by  UUID           REFERENCES users(id),
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX idx_disputes_round_id ON disputes(round_id);
CREATE INDEX idx_disputes_status   ON disputes(status);

COMMIT;
