-- Saved scenarios are virtual changes, not ledger transactions.
CREATE TABLE forecast_scenarios (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL DEFAULT NULLIF(current_setting('finpilot.workspace_id', true), '')::uuid
    REFERENCES workspaces(id) ON DELETE CASCADE,
  title VARCHAR(80) NOT NULL CHECK (length(btrim(title)) > 0),
  months SMALLINT NOT NULL CHECK (months IN (3, 6, 12)),
  changes JSONB NOT NULL CHECK (
    jsonb_typeof(changes) = 'array'
    AND jsonb_array_length(changes) BETWEEN 1 AND 5
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_forecast_scenarios_workspace ON forecast_scenarios (workspace_id, updated_at DESC);
ALTER TABLE forecast_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_scenarios FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_isolation ON forecast_scenarios
  USING (workspace_id::text = current_setting('finpilot.workspace_id', true))
  WITH CHECK (workspace_id::text = current_setting('finpilot.workspace_id', true));
