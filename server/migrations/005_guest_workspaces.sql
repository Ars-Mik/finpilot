-- Keep historical records in a private legacy workspace. Guest sessions never
-- receive this UUID. No historical records are deleted or rewritten.
CREATE TABLE workspaces (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('legacy', 'guest')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO workspaces (id, kind) VALUES ('11111111-1111-4111-8111-111111111111', 'legacy');
CREATE TABLE guest_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces (id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_guest_sessions_expiration ON guest_sessions (expires_at);

-- First backfill old rows, then use a transaction-local default for new ones.
ALTER TABLE accounts ADD COLUMN workspace_id UUID NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES workspaces (id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN workspace_id UUID NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES workspaces (id) ON DELETE CASCADE;
ALTER TABLE account_transfers ADD COLUMN workspace_id UUID NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES workspaces (id) ON DELETE CASCADE;
ALTER TABLE monthly_budgets ADD COLUMN workspace_id UUID NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES workspaces (id) ON DELETE CASCADE;
ALTER TABLE recurring_rules ADD COLUMN workspace_id UUID NOT NULL DEFAULT '11111111-1111-4111-8111-111111111111' REFERENCES workspaces (id) ON DELETE CASCADE;

ALTER TABLE accounts ALTER COLUMN workspace_id SET DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid;
ALTER TABLE transactions ALTER COLUMN workspace_id SET DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid;
ALTER TABLE account_transfers ALTER COLUMN workspace_id SET DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid;
ALTER TABLE monthly_budgets ALTER COLUMN workspace_id SET DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid;
ALTER TABLE recurring_rules ALTER COLUMN workspace_id SET DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid;

-- Uniqueness is per workspace, rather than per whole application.
DROP INDEX uq_accounts_name;
CREATE UNIQUE INDEX uq_accounts_name ON accounts (workspace_id, lower(name));
ALTER TABLE monthly_budgets DROP CONSTRAINT uq_monthly_budgets_month_category;
ALTER TABLE monthly_budgets ADD CONSTRAINT uq_monthly_budgets_month_category UNIQUE (workspace_id, month, category);

-- Composite foreign keys prevent cross-workspace references even when a caller
-- somehow learns another visitor's UUID.
ALTER TABLE accounts ADD CONSTRAINT uq_account_workspace_id UNIQUE (workspace_id, id);
ALTER TABLE recurring_rules ADD CONSTRAINT uq_recurring_workspace_id UNIQUE (workspace_id, id);
ALTER TABLE transactions DROP CONSTRAINT transactions_account_id_fkey;
ALTER TABLE transactions ADD CONSTRAINT fk_transaction_account_workspace FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE transactions DROP CONSTRAINT transactions_recurring_rule_id_fkey;
ALTER TABLE transactions ADD CONSTRAINT fk_transaction_rule_workspace FOREIGN KEY (workspace_id, recurring_rule_id) REFERENCES recurring_rules (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE account_transfers DROP CONSTRAINT account_transfers_from_account_id_fkey;
ALTER TABLE account_transfers DROP CONSTRAINT account_transfers_to_account_id_fkey;
ALTER TABLE account_transfers ADD CONSTRAINT fk_transfer_from_workspace FOREIGN KEY (workspace_id, from_account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE account_transfers ADD CONSTRAINT fk_transfer_to_workspace FOREIGN KEY (workspace_id, to_account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT;
ALTER TABLE recurring_rules DROP CONSTRAINT recurring_rules_account_id_fkey;
ALTER TABLE recurring_rules ADD CONSTRAINT fk_recurring_account_workspace FOREIGN KEY (workspace_id, account_id) REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT;

CREATE INDEX idx_transactions_workspace_date ON transactions (workspace_id, date DESC);
CREATE INDEX idx_transfers_workspace_date ON account_transfers (workspace_id, date DESC);
CREATE INDEX idx_rules_workspace_enabled ON recurring_rules (workspace_id, enabled);
CREATE INDEX idx_budgets_workspace_month ON monthly_budgets (workspace_id, month);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['accounts','transactions','account_transfers','monthly_budgets','recurring_rules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY workspace_isolation ON %I USING (workspace_id::text = current_setting(''finpilot.workspace_id'', true)) WITH CHECK (workspace_id::text = current_setting(''finpilot.workspace_id'', true))', t);
  END LOOP;
END $$;
