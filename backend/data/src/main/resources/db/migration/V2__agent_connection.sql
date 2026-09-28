-- One row per agent app that a user connected through OAuth (docs/mcp.md, "Agent sign-in").
-- The default privileges from V1 give the app role SELECT, INSERT, and UPDATE on this table.

CREATE TABLE account.agent_connection (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid        NOT NULL REFERENCES account.app_user (id) ON DELETE CASCADE,
  client_id          text        NOT NULL CHECK (length(client_id) BETWEEN 1 AND 2048),
  -- The SHA-256 of the current refresh token's secret. Each refresh replaces it.
  refresh_token_hash bytea       NOT NULL CHECK (length(refresh_token_hash) = 32),
  created_at         timestamptz NOT NULL DEFAULT now(),
  -- Null means the connection is active.
  revoked_at         timestamptz
);

CREATE INDEX agent_connection_user_id ON account.agent_connection (user_id);
