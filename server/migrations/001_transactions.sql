CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY,
    title VARCHAR(80) NOT NULL CHECK (length(btrim(title)) > 0),
    amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
    type VARCHAR(7) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(60) NOT NULL CHECK (length(btrim(category)) > 0),
    date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions (type, date DESC);
