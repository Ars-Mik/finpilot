-- Existing transactions retain their dates, amounts and categories. The new default
-- account has an opening balance of zero, preserving the historical net balance.
CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    name VARCHAR(60) NOT NULL CHECK (length(btrim(name)) > 0),
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('checking', 'savings', 'cash')),
    opening_balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (opening_balance_cents BETWEEN 0 AND 1000000000000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_accounts_name ON accounts (lower(name));

INSERT INTO accounts (id, name, kind, opening_balance_cents)
VALUES ('00000000-0000-4000-8000-000000000001', 'Основной счёт', 'checking', 0);

ALTER TABLE transactions
    ADD COLUMN account_id UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'
    REFERENCES accounts (id) ON DELETE RESTRICT;

CREATE INDEX idx_transactions_account ON transactions (account_id, date DESC);

CREATE TABLE account_transfers (
    id UUID PRIMARY KEY,
    from_account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    to_account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000000),
    note VARCHAR(80) NOT NULL DEFAULT '',
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT account_transfers_different_accounts CHECK (from_account_id <> to_account_id)
);

CREATE INDEX idx_transfers_from ON account_transfers (from_account_id, date DESC);
CREATE INDEX idx_transfers_to ON account_transfers (to_account_id, date DESC);
