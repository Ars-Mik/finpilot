-- A recurring rule is a schedule, not a movement of money.
-- Posting is an explicit action; generated transactions participate in existing balances and budgets.
CREATE TABLE recurring_rules (
    id UUID PRIMARY KEY,
    title VARCHAR(80) NOT NULL CHECK (length(btrim(title)) > 0),
    type VARCHAR(7) NOT NULL CHECK (type IN ('income', 'expense')),
    category VARCHAR(60) NOT NULL CHECK (length(btrim(category)) > 0),
    amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 1000000000000),
    account_id UUID NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
    frequency VARCHAR(7) NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
    start_date DATE NOT NULL,
    end_date DATE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT recurring_dates_check CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_recurring_rules_enabled ON recurring_rules (enabled, start_date);

ALTER TABLE transactions
    ADD COLUMN recurring_rule_id UUID REFERENCES recurring_rules (id) ON DELETE RESTRICT,
    ADD COLUMN recurring_occurrence_date DATE,
    ADD CONSTRAINT recurring_occurrence_pair CHECK (
      (recurring_rule_id IS NULL AND recurring_occurrence_date IS NULL)
      OR (recurring_rule_id IS NOT NULL AND recurring_occurrence_date IS NOT NULL)
    );

CREATE UNIQUE INDEX uq_recurring_transaction_occurrence
    ON transactions (recurring_rule_id, recurring_occurrence_date)
    WHERE recurring_rule_id IS NOT NULL;
