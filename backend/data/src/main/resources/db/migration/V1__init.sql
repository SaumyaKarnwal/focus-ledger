-- The schema from docs/schema.md. Runs as focusledger_migrate, which owns the ledger and account
-- schemas. The role script creates the schemas and the citext extension (docs/setup.md).
-- Every name is schema-qualified, because Flyway sets search_path to ledger and account only.

-- Default privileges come first, so that they reach every table below.
GRANT USAGE ON SCHEMA ledger  TO ledger_reader;
GRANT USAGE ON SCHEMA account TO account_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT SELECT ON TABLES TO ledger_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT INSERT, UPDATE ON TABLES TO ledger_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger  GRANT USAGE ON SEQUENCES TO ledger_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT SELECT ON TABLES TO account_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT INSERT, UPDATE ON TABLES TO account_writer;
ALTER DEFAULT PRIVILEGES IN SCHEMA account GRANT USAGE ON SEQUENCES TO account_writer;

CREATE TYPE ledger.focus_mode AS ENUM ('deep_focus', 'execution', 'shallow');

CREATE FUNCTION ledger.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- account.app_user
-- ---------------------------------------------------------------------------

CREATE TABLE account.app_user (
  id         uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  email      public.citext NOT NULL UNIQUE,
  created_at timestamptz   NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- account.user_settings
-- ---------------------------------------------------------------------------

CREATE TABLE account.user_settings (
  user_id               uuid        PRIMARY KEY REFERENCES account.app_user (id) ON DELETE CASCADE,
  deep_focus_minutes    int         NOT NULL DEFAULT 90 CHECK (deep_focus_minutes BETWEEN 1 AND 480),
  execution_minutes     int         NOT NULL DEFAULT 50 CHECK (execution_minutes BETWEEN 1 AND 480),
  shallow_minutes       int         NOT NULL DEFAULT 25 CHECK (shallow_minutes BETWEEN 1 AND 480),
  break_minutes         int         NOT NULL DEFAULT 5  CHECK (break_minutes BETWEEN 1 AND 60),
  sound_enabled         boolean     NOT NULL DEFAULT true,
  notifications_enabled boolean     NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER user_settings_updated_at BEFORE UPDATE ON account.user_settings
  FOR EACH ROW EXECUTE FUNCTION ledger.set_updated_at();

-- ---------------------------------------------------------------------------
-- ledger.node
-- ---------------------------------------------------------------------------

CREATE TABLE ledger.node (
  user_id    uuid        NOT NULL REFERENCES account.app_user (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid        NOT NULL,
  parent_id  uuid,
  name       text        NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, parent_id) REFERENCES ledger.node (user_id, id),
  UNIQUE (user_id, request_id),
  CHECK (parent_id <> id)
);

CREATE INDEX node_children ON ledger.node (user_id, parent_id, created_at);

CREATE FUNCTION ledger.node_reject_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT n.id, n.parent_id FROM ledger.node n
      WHERE n.user_id = NEW.user_id AND n.id = NEW.parent_id
      UNION ALL
      SELECT n.id, n.parent_id FROM ledger.node n
      JOIN ancestors a ON n.user_id = NEW.user_id AND n.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'node % cannot move under its own descendant', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER node_reject_cycle BEFORE UPDATE OF parent_id ON ledger.node
  FOR EACH ROW EXECUTE FUNCTION ledger.node_reject_cycle();

CREATE TRIGGER node_updated_at BEFORE UPDATE ON ledger.node
  FOR EACH ROW EXECUTE FUNCTION ledger.set_updated_at();

-- ---------------------------------------------------------------------------
-- ledger.cycle
-- ---------------------------------------------------------------------------

CREATE TABLE ledger.cycle (
  user_id         uuid              NOT NULL REFERENCES account.app_user (id) ON DELETE CASCADE,
  id              uuid              NOT NULL DEFAULT gen_random_uuid(),
  request_id      uuid              NOT NULL,
  node_id         uuid,
  mode            ledger.focus_mode NOT NULL,
  started_at      timestamptz       NOT NULL,
  planned_minutes int               NOT NULL CHECK (planned_minutes BETWEEN 1 AND 1440),
  -- NULL while the cycle runs.
  minutes         int               CHECK (minutes BETWEEN 1 AND 1440),
  created_at      timestamptz       NOT NULL DEFAULT now(),
  updated_at      timestamptz       NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, node_id) REFERENCES ledger.node (user_id, id),
  UNIQUE (user_id, request_id)
);

CREATE INDEX cycle_rollup ON ledger.cycle (user_id, started_at)
  INCLUDE (node_id, mode, minutes, planned_minutes)
  WHERE minutes IS NOT NULL;

CREATE UNIQUE INDEX cycle_one_running ON ledger.cycle (user_id) WHERE minutes IS NULL;

CREATE INDEX cycle_node ON ledger.cycle (user_id, node_id);

-- A cycle allows exactly three changes: Stop sets minutes once, an extension adds minutes, and
-- filing sets node_id once on an Inbox cycle.
CREATE FUNCTION ledger.cycle_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.user_id, NEW.id, NEW.request_id, NEW.mode, NEW.started_at, NEW.planned_minutes, NEW.created_at)
     IS DISTINCT FROM
     (OLD.user_id, OLD.id, OLD.request_id, OLD.mode, OLD.started_at, OLD.planned_minutes, OLD.created_at) THEN
    RAISE EXCEPTION 'cycle % is immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.node_id IS NOT NULL AND NEW.node_id IS DISTINCT FROM OLD.node_id THEN
    RAISE EXCEPTION 'cycle % is already filed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.minutes IS NOT NULL AND (NEW.minutes IS NULL OR NEW.minutes < OLD.minutes) THEN
    RAISE EXCEPTION 'cycle % minutes can only grow', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER cycle_guard BEFORE UPDATE ON ledger.cycle
  FOR EACH ROW EXECUTE FUNCTION ledger.cycle_guard();

-- A cycle is never deleted. The one exception is the cascade from an account delete, which runs
-- inside the foreign-key trigger, so the trigger depth is above 1.
CREATE FUNCTION ledger.cycle_reject_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'cycle % cannot be deleted', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;

CREATE TRIGGER cycle_reject_delete BEFORE DELETE ON ledger.cycle
  FOR EACH ROW EXECUTE FUNCTION ledger.cycle_reject_delete();

-- ---------------------------------------------------------------------------
-- ledger.estimate
-- ---------------------------------------------------------------------------

CREATE TABLE ledger.estimate (
  user_id       uuid              NOT NULL,
  node_id       uuid              NOT NULL,
  mode          ledger.focus_mode NOT NULL,
  cycle_minutes int               NOT NULL CHECK (cycle_minutes BETWEEN 1 AND 480),
  cycle_count   int               NOT NULL CHECK (cycle_count >= 0),
  updated_at    timestamptz       NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, node_id, mode),
  FOREIGN KEY (user_id, node_id) REFERENCES ledger.node (user_id, id) ON DELETE CASCADE
);

CREATE TRIGGER estimate_updated_at BEFORE UPDATE ON ledger.estimate
  FOR EACH ROW EXECUTE FUNCTION ledger.set_updated_at();
