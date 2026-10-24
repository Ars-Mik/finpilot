-- Shared rate-limit budget for NEW guest sessions. Hash is HMAC(secret, IP),
-- not a raw IP. Only the runtime API may SELECT/INSERT/UPDATE these rows.
-- Admin cleanup removes expired buckets; no RLS required because the table
-- is never queried through per-guest repositories or exposed via the API.
CREATE TABLE guest_session_rate_limits (
  client_key CHAR(64) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts SMALLINT NOT NULL CHECK (attempts BETWEEN 1 AND 10)
);
CREATE INDEX idx_guest_session_rate_limits_window ON guest_session_rate_limits (window_start);
