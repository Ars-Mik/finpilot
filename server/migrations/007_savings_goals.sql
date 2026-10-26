-- Allocations reserve existing account funds; they are not cash movements.
CREATE TABLE savings_goals (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  account_id UUID NOT NULL,
  name VARCHAR(80) NOT NULL CHECK (length(btrim(name)) > 0),
  target_cents BIGINT NOT NULL CHECK (target_cents BETWEEN 1 AND 1000000000000),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_goal_workspace UNIQUE (workspace_id, id),
  CONSTRAINT fk_goal_account_workspace FOREIGN KEY (workspace_id, account_id)
    REFERENCES accounts (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_goals_workspace ON savings_goals (workspace_id, status, created_at);

CREATE TABLE goal_allocations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL,
  delta_cents BIGINT NOT NULL CHECK (delta_cents BETWEEN -1000000000000 AND 1000000000000 AND delta_cents <> 0),
  note VARCHAR(100) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_allocation_goal_workspace FOREIGN KEY (workspace_id, goal_id)
    REFERENCES savings_goals (workspace_id, id) ON DELETE RESTRICT
);
CREATE INDEX idx_goal_allocations_goal ON goal_allocations (workspace_id, goal_id, created_at);

ALTER TABLE savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_goals FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON savings_goals
  USING (workspace_id::text = current_setting('finpilot.workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('finpilot.workspace_id', true));
ALTER TABLE goal_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON goal_allocations
  USING (workspace_id::text = current_setting('finpilot.workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('finpilot.workspace_id', true));
