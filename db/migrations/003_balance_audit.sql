-- 003_balance_audit.sql
-- Add balance_audit table and updated_at column to balances
-- Required by wallet service ledger operations

BEGIN;

-- Add updated_at to balances (referenced by balance.js)
ALTER TABLE balances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Audit trail for every balance mutation
CREATE TABLE IF NOT EXISTS balance_audit (
    id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation       VARCHAR(20) NOT NULL,  -- credit, debit, lock, unlock, settle
    amount          BIGINT      NOT NULL,
    reason          TEXT,
    balance_after   BIGINT      NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_audit_user_id ON balance_audit(user_id);
CREATE INDEX idx_balance_audit_created ON balance_audit(created_at DESC);

COMMIT;
